# Maindeck API browser

Dark, brand-first workspace for browsing Maindeck production via **client-credentials OAuth** and the REST Integration Hub.

Cursor MCP OAuth failed (`No sign-in link`), so this app uses the REST API instead.

Live app: https://maindeck-api.apps.grok.bot

## Secrets (never hardcode)

| Name | Purpose |
|------|---------|
| `MAINDECK_CLIENT_ID` | OAuth application client id |
| `MAINDECK_CLIENT_SECRET` | OAuth application client secret |

Use **Cursor Secrets** / `bind-app-secrets`. Do not paste values into chat or commit them.

If either secret is missing, the API returns a clear configuration error. Secrets are never printed or sent to the browser.

## OAuth token

- **URL:** `https://app.maindeck.io/oauth/token`
- **Grant:** `client_credentials`
- **Scope:** `read` (add `write` later if needed)
- **Expiry:** typically **7200** seconds — cached in memory and refreshed early

## REST

Base: `https://app.maindeck.io/api/v1`  
Docs: https://developers.maindeck.io/llms.txt

This helper proxies read endpoints for:

- Me, teams
- All projects (every accessible team)
- Work orders (jobs), groups, owners, owner supplies
- Ships, inspections (+ items), inspection templates, offices, owner supply categories
- Work order detail + work-done report

## Run locally

```bash
export MAINDECK_CLIENT_ID=…
export MAINDECK_CLIENT_SECRET=…
npm start
# → http://127.0.0.1:3000
```

CLI:

```bash
npm run me
npm run teams
npm run projects
node cli.js work-orders <projectId>
```

## Publish-app

Project root is the app root. Bound secret names: `MAINDECK_CLIENT_ID`, `MAINDECK_CLIENT_SECRET`. Start: `npm start`.
