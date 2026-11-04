# SIMS frontend

React and Vite frontend for the Student Information Management System.

## Requirements

- Node.js 20 or newer
- npm
- A running SIMS API for interactive use

## Local development

Create `client/.env` from the example when the API is not at its default local URL:

```powershell
Copy-Item .env.example .env
```

Install dependencies and run Vite:

```powershell
npm ci
npm run dev
```

The default API base is `http://localhost:5000/api`. Set `VITE_API_URL` to override it. This value is public browser configuration; never put database, Redis, session, or Supabase secret values in frontend environment variables.

## Validate

```powershell
npm ci
$env:VITE_API_URL = "http://localhost:5000/api"
npm run build
```

GitHub Actions runs the production build on Node.js 20 and 22 for pushes and pull requests. The CI URL is only a build-time placeholder.

## Deployment

For the configured Netlify deployment, set the frontend environment variable `VITE_API_URL` to `/api` (not the Render URL). The root `netlify.toml` proxies `/api/*` to the Render backend before applying the SPA fallback. This makes browser requests same-origin with the frontend, so the session cookie is handled as a first-party cookie instead of relying on third-party cookie support.

If the backend URL changes, update the proxy target in `netlify.toml` and redeploy the frontend. Keep the backend CORS allowlist configured with the exact deployed frontend origin.
