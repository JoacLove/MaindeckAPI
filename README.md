# Maindeck API helper

Minimal Node helper for **client-credentials OAuth** against Maindeck production, then REST calls with a Bearer token.

Cursor MCP OAuth failed (`No sign-in link`), so this repo talks to the REST API instead.

## Secrets (never hardcode)

| Name | Purpose |
|------|---------|
| `MAINDECK_CLIENT_ID` | OAuth application client id |
| `MAINDECK_CLIENT_SECRET` | OAuth application client secret |

Use **Cursor Secrets** (and `bind-app-secrets` for publish-app). Do not paste values into chat or commit them.

Local optional file: copy `.env.example` → `.env` (gitignored). The app reads `process.env` only.

If either secret is missing, HTTP/CLI returns a clear configuration error (local fallback). Secrets are never printed.

## OAuth token

- **URL:** `https://app.maindeck.io/oauth/token`
- **Grant:** `client_credentials`
- **Scope:** `read` (add `write` later if needed)
- **Auth methods:** `client_secret_post` (body) or `client_secret_basic`
- **Expiry:** access tokens typically expire in **7200 seconds** (2 hours). This helper caches the token in memory and refreshes before expiry.

## REST base

Authenticated calls use:

`Authorization: Bearer <access_token>`

against `https://app.maindeck.io/api/v1/…`

Useful routes exposed by this app:

| Local route | Maindeck |
|-------------|----------|
| `GET /api/me` | `GET /api/v1/me` |
| `GET /api/teams` | `GET /api/v1/teams` |
| `GET /api/projects` | teams → `GET /api/v1/teams/:id/projects` |
| `GET /health` | config/status (no secrets leaked) |

## Run locally

```bash
# Node 18+
export MAINDECK_CLIENT_ID=…      # from Cursor Secrets / your OAuth app
export MAINDECK_CLIENT_SECRET=…

npm start
# → http://127.0.0.1:3000
```

CLI (same env vars):

```bash
npm run me
npm run teams
npm run projects
```

Port: set `PORT` (default `3000`).

## Publish-app

Project root **is** the app root (`package.json` + `server.js` + `public/`). Bind secret names:

- `MAINDECK_CLIENT_ID`
- `MAINDECK_CLIENT_SECRET`

Start command: `npm start`.
