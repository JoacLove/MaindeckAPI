# Maindeck Reader

Read-only fleet and project browser for Maindeck (UniSea) Integration Hub.

Design: `docs/maindeck-ui-prototype.html`  
Rules: `docs/maindeck-cursor-instruks.md` · `.cursor/rules/maindeck.mdc`

Live: https://maindeck-api.apps.grok.bot

## Secrets

| Name | Purpose |
|------|---------|
| `MAINDECK_CLIENT_ID` | OAuth client id |
| `MAINDECK_CLIENT_SECRET` | OAuth client secret |

Optional: `MAINDECK_BASE_URL` (default `https://app.maindeck.io`).

Never commit values. Frontend never sees secrets.

## Run

```bash
export MAINDECK_CLIENT_ID=…
export MAINDECK_CLIENT_SECRET=…
npm start
# http://127.0.0.1:3000
```

## Architecture

- Browser → `POST /api/proxy` `{ path, params?, all? }` → server allowlist + token cache → `GET https://app.maindeck.io/api/v1/…`
- FX: `GET /api/rates` (Frankfurter, 6h cache)
- Economy: Excel import in the browser (not from the API)

Hard rules: GET-only to Maindeck, English UI, en-GB numbers/dates.
