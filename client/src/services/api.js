import { useSyncExternalStore } from 'react';
import { API_PREFIX, apiRoutes } from './apiRoutes.js';

const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
if (import.meta.env.PROD && !configuredApiUrl) {
  throw new Error('VITE_API_URL must be set before building for production (use /api for the Netlify same-origin proxy)');
}
export const apiBase = (configuredApiUrl || `http://localhost:5000${API_PREFIX}`).replace(/\/+$/, '');

export function apiAssetUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiBase}${path}`;
}

const activeMutations = new Map();
let nextMutationId = 0;
const mutationListeners = new Set();

function mutationLabel(path, method) {
  const route = path.split('?')[0].replace(/\/+$/, '');
  if (route.endsWith(apiRoutes.auth.login)) return 'Signing in…';
  if (route.endsWith(apiRoutes.auth.logout)) return 'Signing out…';
  if (route.endsWith(apiRoutes.auth.password)) return 'Changing password…';
  if (/\/users\/[^/]+\/reset-password$/.test(route) || /\/teachers\/[^/]+\/generate-account$/.test(route)) {
    return 'Regenerating account credentials…';
  }
  if (route === apiRoutes.attendance.collection) return 'Saving attendance…';
  if (route === apiRoutes.scores) return 'Saving student scores…';
  if (/\/trash\/[^/]+\/[^/]+\/restore$/.test(route) || /\/[^/]+\/[^/]+\/restore$/.test(route)) {
    return 'Restoring record…';
  }
  if (/\/trash\/[^/]+\/[^/]+$/.test(route) || /\/[^/]+\/[^/]+\/delete$/.test(route)) {
    return 'Moving record to Trash…';
  }
  if (method === 'DELETE') return 'Deleting record…';

  const collectionMatch = route.match(/^\/([a-z-]+)$/);
  const itemMatch = route.match(/^\/([a-z-]+)\/[^/]+$/);
  const resource = (itemMatch?.[1] || collectionMatch?.[1] || 'record')
    .replace(/s$/, '')
    .replaceAll('-', ' ');
  if (method === 'POST') return `Creating ${resource}…`;
  if (method === 'PATCH' || method === 'PUT') return `Updating ${resource}…`;
  return 'Processing request…';
}

function updateMutationState() {
  const isPending = activeMutations.size > 0;
  const root = document.getElementById('root');
  if (root) {
    root.inert = isPending;
    root.setAttribute('aria-busy', String(isPending));
  }
  mutationListeners.forEach(listener => listener());
}

function subscribeToMutations(listener) {
  mutationListeners.add(listener);
  return () => mutationListeners.delete(listener);
}

function getMutationSnapshot() {
  const pending = [...activeMutations.values()];
  return pending.length ? pending[pending.length - 1] : '';
}

export function useMutationPending() {
  return Boolean(useMutationMessage());
}

export function useMutationMessage() {
  return useSyncExternalStore(subscribeToMutations, getMutationSnapshot, () => '');
}

export async function api(path, options = {}) {
  const { suppressSessionExpired = false, ...requestOptions } = options;
  const method = (requestOptions.method || 'GET').toUpperCase();
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const mutationId = isMutation ? ++nextMutationId : null;
  if (mutationId !== null) {
    activeMutations.set(mutationId, mutationLabel(path, method));
    updateMutationState();
  }
  try {
    const response = await fetch(apiAssetUrl(path), {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...requestOptions
    });
    let body = null;
    if (response.status !== 204) {
      const contentType = response.headers.get('content-type') || '';
      const rawBody = await response.text();
      if (contentType.includes('application/json') && rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          if (response.ok) throw new Error('The API returned an invalid response.');
        }
      } else if (response.ok) {
        throw new Error('The API returned an unexpected response.');
      }
    }
    if (!response.ok) {
      if (body?.code === 'ACCOUNT_DISABLED') {
        window.dispatchEvent(new CustomEvent('sims:account-disabled', { detail: body.error }));
      } else if (response.status === 401 && !path.endsWith(apiRoutes.auth.login) && !suppressSessionExpired) {
        window.dispatchEvent(new CustomEvent('sims:session-expired'));
      }
      const retryAfter = Number(response.headers.get('retry-after')) || body?.retry_after_seconds || null;
      const fallbackMessages = {
        401: 'Your session has expired. Please sign in again.',
        403: 'You do not have permission to complete this action.',
        404: 'The requested record or page could not be found.',
        422: 'Some submitted information is invalid. Review the form and try again.',
        500: 'The service could not complete the request. Please try again later.'
      };
      const message = response.status === 429
        ? `Too many requests. Please try again${retryAfter ? ` in ${retryAfter} seconds` : ' later'}.`
        : body?.error || fallbackMessages[response.status] || `Request failed (${response.status})`;
      const error = new Error(message);
      error.status = response.status;
      error.retryAfter = retryAfter;
      error.code = body?.code;
      throw error;
    }
    return body;
  } finally {
    if (mutationId !== null) {
      activeMutations.delete(mutationId);
      updateMutationState();
    }
  }
}
