import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createRateLimiter } from '../src/middleware/rateLimit.js';

class SharedStore {
  localKeys = false;
  constructor(counters = new Map()) {
    this.counters = counters;
    this.windowMs = 100;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  increment(key) {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.resetTime.getTime() <= now) {
      const current = { totalHits: 1, resetTime: new Date(now + this.windowMs) };
      this.counters.set(key, current);
      return current;
    }
    existing.totalHits += 1;
    return existing;
  }

  decrement(key) {
    const current = this.counters.get(key);
    if (current) current.totalHits = Math.max(0, current.totalHits - 1);
  }

  resetKey(key) {
    this.counters.delete(key);
  }
}

async function startApp(t, limiter) {
  const app = express();
  app.use(limiter);
  app.get('/', (req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/`;
}

test('allows requests within the configured limit and returns 429 headers after it', async t => {
  const url = await startApp(t, createRateLimiter({
    windowMs: 5_000,
    limit: 2,
    store: new SharedStore(),
    category: 'test'
  }));
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await fetch(url)).status, 200);
  const limited = await fetch(url);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
  assert.ok(limited.headers.has('ratelimit'));
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
});

test('separate application instances share counters through the same distributed store', async t => {
  const counters = new Map();
  const firstUrl = await startApp(t, createRateLimiter({
    windowMs: 5_000, limit: 1, store: new SharedStore(counters), category: 'test'
  }));
  const secondUrl = await startApp(t, createRateLimiter({
    windowMs: 5_000, limit: 1, store: new SharedStore(counters), category: 'test'
  }));
  assert.equal((await fetch(firstUrl)).status, 200);
  assert.equal((await fetch(secondUrl)).status, 429);
});

test('rate-limit windows reset after their expiry', async t => {
  const url = await startApp(t, createRateLimiter({
    windowMs: 100,
    limit: 1,
    store: new SharedStore(),
    category: 'test'
  }));
  assert.equal((await fetch(url)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal((await fetch(url)).status, 200);
});
