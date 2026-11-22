# Maindeck API: instruks for Cursor

> Legg filen i repoet som `.cursor/rules/maindeck.mdc` (regel som alltid gjelder) eller `docs/maindeck.md` og referer med `@maindeck.md` i chatten.
> Legg `maindeck-ui-prototype.html` i `docs/` og referer til den når UI bygges.
>
> Alt under «Verifisert» er testet mot produksjon i appen *Maindeck Reader* (repo `Joalover/maindeck-reader`, november 2026). Det under «Ikke verifisert» skal Cursor sjekke før det tas i bruk.

---

## 1. Mål

En **read-only** app for TGS som leser prosjekter fra Maindeck (UniSea) via Maindeck Integration Hub, og viser:

- prosjektliste og ukeoversikt for flåten
- per prosjekt: oversikt, owner supplies, work orders, grupper, owners
- Gantt per work order, statusfordeling, kostnader i USD
- økonomi fra Maindecks Excel-eksport (API-et har ikke budsjett)

**All tekst i UI og eksport er på engelsk.** Datoer `5 Nov 2026`, tall `2,002,147 USD` (en-GB).

## 2. Harde regler

1. **Kun GET mot Maindeck.** OAuth-klienten har bare scope `read`. Ingen POST/PUT/PATCH/DELETE mot `/api/v1`, heller ikke «bare for å teste».
2. **Hemmeligheter kun på serveren.** `MAINDECK_CLIENT_ID` og `MAINDECK_CLIENT_SECRET` leses fra miljøvariabler i serverkode. Aldri i frontend, aldri i git, aldri i logger, aldri i feilmeldinger til klienten. `.env` skal stå i `.gitignore`.
3. **Frontend snakker kun med vår egen proxy**, aldri direkte med `app.maindeck.io` (hemmelighet + CORS).
4. **Allowlist i proxyen.** Avvis alle stier som ikke starter med en tillatt ressurs (se §4). Valider sti med regex, ingen `..`, ingen full URL.
5. **Proxyen krever innlogget bruker** (i Maindeck Reader: Supabase-auth-middleware). En åpen proxy er en åpen dør inn i Maindeck.
6. **Ikke gjett felter eller endepunkter.** Er noe ikke i denne fila, kall endepunktet, se på svaret og vis det i en rå JSON-visning før du bygger på det.

## 3. Autentisering (verifisert)

| | |
|---|---|
| Base (produksjon) | `https://app.maindeck.io` (overstyres med `MAINDECK_BASE_URL`) |
| Token | `POST {BASE}/oauth/token` |
| Grant | `client_credentials`, `scope=read` |
| Levetid | `expires_in` ≈ 7200 s. Ingen refresh token: hent nytt med samme kall |

Body (JSON, første forsøk):

```json
{ "grant_type": "client_credentials", "client_id": "…", "client_secret": "…", "scope": "read" }
```

Hvis svaret er `401`/`invalid_client`, prøv i rekkefølge: **Basic auth** (`Authorization: Basic base64(id:secret)`, body `grant_type=client_credentials&scope=read`, form-urlencoded) og deretter **form-body** med `client_id`/`client_secret`. Husk hvilken metode som virket.

Token-cache i serverminnet: gyldig til `expires_in − 300 s`. Ved `401` fra API: tøm cache, hent nytt token, prøv **én** gang til.

**Fallgruver vi har gått i:**

- `invalid_client` mot `sandbox.maindeck.io`: klienten finnes bare i **produksjon**. Bruk `app.maindeck.io`.
- I Lovable-secrets ble ID og hemmelighet byttet om / lagt i navnefeltet. Sjekk at *navnene* er `MAINDECK_CLIENT_ID` og `MAINDECK_CLIENT_SECRET`.

## 4. API-kall (verifisert)

- URL: `{BASE}/api/v1/{sti}`. **Produksjon trenger `/api/v1`**. Sandbox-dokumentasjonen viser `/v1/...` uten `/api`; det gir 500/404 i produksjon.
- Headere: `Authorization: Bearer {token}`, `Accept: application/vnd.api+json`
- Format: **JSON:API**, altså `data[]` med `id`, `type`, `attributes`, `relationships`, og noen ganger `included[]` og `meta`.
- Paginering: `?page=N&per_page=100` (maks 100). Hent til en side har færre enn 100 rader. Sett et tak (vi bruker 50 sider) og returner `truncated: true` hvis taket nås.
- `429`: vent `Retry-After` sekunder (ellers 2 s, 4 s, 6 s) og prøv igjen, maks 4 forsøk.

| Sti | Bruk |
|---|---|
| `me` | Tilkoblingstest |
| `teams` | Velg team (TGS) |
| `teams/{team_id}/projects` | Prosjektliste |
| `projects/{id}` | Ett prosjekt |
| `projects/{id}/owner_supplies` | Owner supplies |
| `projects/{id}/work_orders` | Work orders |
| `projects/{id}/groups` | Grupper |
| `projects/{id}/owners` | Owners |
| `teams/{team_id}/owner_supply_categories` | Kategorinavn (fallback: `owner_supply_categories`) |

Allowlist for første stisegment: `me, teams, projects, groups, ships, work_orders, owner_supplies, owner_supply_categories, owner_supplies_work_orders, inspections, inspection_templates`. Regex: `^[a-z_]+(\/[A-Za-z0-9_-]+)*$`.

**Finnes ikke i API-et:** budsjett/kostnadsoppfølging og Actions center. Se §7 for økonomi.

## 5. Datafelter (verifisert)

Alle felt ligger under `attributes`.

**Project:** `name`, `phase`, `ship_name`, `ship_id`, `slug`, `survey_type`, `period_from`, `period_to`, `deadline`, `team_id`

- `phase` er en av: `planning` → `yard_selection` → `kick_off` → `execution` → `closing` (i denne rekkefølgen).

**Owner supply:** `name`, `po_number`, `supplier`, `status`, `cost_cents`, `cost_currency`, `category_id`, `delivery_date`, `location`, `equipment`

- Kostnad = `cost_cents / 100` i `cost_currency` (NOK, EUR, USD …).
- `category_id` slås opp mot owner_supply_categories.
- Koblede work orders ligger i `relationships.owner_supplies` på work order-siden.

**Work order:** `group_name`, `name`, `content` (HTML, vask før visning), `start_date`, `end_date`, `duration`, `planning_status`, `execution_status`, `progress`

- `progress` kan komme som 0–1 **eller** 0–100. Normaliser: verdi mellom 0 og 1 ganges med 100.
- Mangler `end_date`: bruk `start_date + duration` dager.
- Mange work orders har ingen datoer. De skal vises som «no dates», ikke skjules og ikke gis falske datoer.
- Utførelse i tre bøtter: `completed` (done) / i gang (`in_progress`, `started`) / ikke startet.

**Datoformat:** `"2026-05-15 00:00:00 +0200"`. `new Date()` feiler i Safari. Parse selv: regex `^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?\s*([+-]\d{2}):?(\d{2})?` → ISO. Vis kun dato, aldri klokkeslett.

**Owner supply-statuser** (Maindeck-import/-eksport, verdien i API er snake_case): Not specified, Cancelled, Fully received, Ordered, Partially received, Prepared, Received forwarder, Received goods, Sent to agent workshop, Sent to forwarder, Confirmed, Forwarder notified, Agent notified, Ready at supplier, Prepayment, Paid pending readiness, Received agent workshop, Sent to vessel, Sent, Sent to supplier, Over supplied, Transferred to warehouse, Request made by vessel, Approved, In query.

**Kategorier:** Spare parts and consumables, Service and repairs, Class, Superintendent costs, Other, External repair, Shipments.

## 6. Valuta

- Rapporteringsvaluta er **USD**.
- Omregn med ECB-dagskurs fra `https://api.frankfurter.app/latest?from=USD` (fallback `https://open.er-api.com/v6/latest/USD`) på serveren, med 6 timers cache.
- La brukeren overstyre kurs per valuta. Lagres lokalt i nettleseren.
- Behold originalbeløpet og vis det under USD-beløpet.
- Vis alltid en kursnote: «Converted to USD · ECB rate 2026-11-05 · 1 USD = 10.12 NOK».
- Mangler kurs: vis i originalvaluta, ikke 0.
- Maindeck bruker egne kurser, så summen avviker litt fra Maindeck. Det er forventet.

## 7. Økonomi fra Excel (verifisert)

Kommer ikke fra API-et. Brukeren eksporterer i Maindeck: **Budgeting and cost → Export → Billed and actual amounts** (`.xlsx`).

- Kolonner: `WO ID`, `SFI code`, `Account code`, `Group`, `WO name`, `Estimate`, `Estimate currency`, `Owner's supply`, `Quotation`, `Variation orders`, `Total`, `Billed`, `Final`.
- Valider at `WO name`, `Group`, `Estimate`, `Owner's supply`, `Total`, `Billed` og `Final` finnes. Gi ellers en tydelig feilmelding.
- **Committed** = `Final` hvis > 0, ellers `Billed` hvis > 0, ellers `Total`.
- Flagg work orders over estimat, og work orders uten estimat som har kostnad.
- Filnavnet inneholder prosjektets slug (`…_for_seismic-air-platform_05-nov-2026.xlsx`). Advar hvis det ikke matcher.
- Les filen i nettleseren (`read-excel-file`; `openpyxl` feiler på Maindecks valideringer) og lagre per prosjekt-ID.
- Kontrolltall for Seismic air platform: estimat 3,255,000 USD, owner's supply 1,268,866 USD.

## 8. Arkitektur

```
Browser (React) ──POST {path, params, all}──▶ Server proxy (auth-sjekk, allowlist, token-cache, paginering, 429-retry)
                                                   │ GET /api/v1/...
                                                   ▼
                                           app.maindeck.io
```

- Proxy-input: `{ path: string, params?: Record<string,string|number>, all?: boolean }`
- Proxy-output: `{ status, body, url }`. Med `all: true` blir body `{ data, included, meta, truncated }`.
- Frontend: TanStack Query, `staleTime` 60 s, manuell «Refresh».
- Hent fanedata for prosjektet parallelt, så teller og KPI-er er klare med en gang.

## 9. UI

Design etter `maindeck-ui-prototype.html` (mørkt tema). Prinsipper:

- **Tre nivåer:** Fleet (dashboard) → Project → detalj i sidepanel. Aldri mer enn to klikk til en owner supply.
- **Fasefarger** (faste, brukes overalt):
  - planning `#8B7CF6`
  - yard_selection `#F5B83D`
  - kick_off `#4C9AFF`
  - execution `#2ED39A`
  - closing `#F28DB2`
- **Statusfarger:**
  - grønn = levert/ferdig
  - blå = bestilt/i gang
  - gul = venter/forespurt
  - grå = ikke spesifisert
  - rød = forsinket/over estimat
- Tall høyrejustert med `tabular-nums`. Valuta alltid synlig.
- Tomme verdier vises som `—`, aldri `0`. Manglende datoer vises som «no dates».
- Hver liste har søk, og tabeller kan sorteres. CSV-eksport per tabell.
- Tilkoblingsstatus synlig i toppfeltet (Connected / Not connected).
- Last-tilstander med skjelett, og feil vises med Maindeck-statuskode og en kort forklaring.
- Fungerer på 1280 px laptop og på storskjerm i møterom (Present-modus i fullskjerm).

Mørkt tema, tokens:

```css
--bg:#0B1220; --surface:#111A2C; --surface-2:#16223A; --line:#22314F;
--text:#E6EDF7; --muted:#8A9BB8; --accent:#4C9AFF; --accent-2:#2ED39A;
--warn:#F5B83D; --danger:#F2577A; --radius:14px;
font: Inter / system-ui; tall: font-variant-numeric: tabular-nums;
```

## 10. Rekkefølge

1. Proxy + `me`-kall. Vis «Connected to Maindeck» eller feilen.
2. `teams` → teamvalg → `teams/{id}/projects` → prosjektliste med fase og periode.
3. Prosjektside: hent prosjekt, owner supplies, work orders, grupper og owners parallelt. Start med rå JSON-fane.
4. Owner supplies-tabell + statusfordeling + USD-omregning.
5. Work orders: Gantt per gruppe, «no dates»-liste, fremdrift.
6. Fleet-dashboard: KPI-er, fasefordeling, tidslinje per skip.
7. Økonomi-import fra Excel.
8. Eksport (PowerPoint, én-sides PDF A3–A0) hvis ønsket.

## 11. Akseptansesjekk

- [ ] Søk i bygget frontend-bundle etter `client_secret` og `MAINDECK_` gir ingen treff.
- [ ] Proxyen avviser `POST`-forsøk og stier utenfor allowlist (400).
- [ ] Proxyen avviser kall uten innlogging (401).
- [ ] Prosjektlisten viser samme antall prosjekter som Maindeck.
- [ ] Owner supply-sum stemmer med Maindeck (innen kursavvik) og viser originalvaluta.
- [ ] Datoer vises riktig i Safari.
- [ ] Work orders uten dato vises, med «no dates».
- [ ] Alle tekster er på engelsk.

## Ikke verifisert

- Hvilken av de tre token-metodene produksjon faktisk bruker. Behold fallback-rekkefølgen.
- `ships`, `inspections`, `inspection_templates` og `owner_supplies_work_orders` står i allowlisten, men er ikke tatt i bruk.
- Om `teams/{id}/owner_supply_categories` eller `owner_supply_categories` er riktig sti. Behold begge.
- Om API-et støtter filtrering (f.eks. `filter[...]`). Ikke anta det.
