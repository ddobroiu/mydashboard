# mydashboard.ro

Un singur loc pentru toate proiectele: cât cheltuim pe reclame (Meta, Google, TikTok), cât încasăm (Stripe, Oblio) și ce campanii aduc sau nu aduc rezultate.

## Cum e construit

```
Organizație (noi / mai târziu fiecare client)
 └── Proiect (tablou.net, homeprint.ro, ...)
      ├── Conexiuni: Stripe | Meta | Google Ads | TikTok | Oblio   (chei criptate AES-256-GCM)
      ├── AdSpendDaily  – cheltuială pe campanie pe zi
      ├── Transaction   – fiecare plată (sumă minus rambursări, + UTM pentru atribuire)
      └── SocialPost    – clipurile postate prin PostingClips + vizualizări/aprecieri/comentarii
```

- `lib/integrations/*`: câte un fișier pe platformă (test conexiune + extragere date)
- `lib/sync.ts`: rescrie ultimele N zile pentru fiecare conexiune (prinde rambursările și corecturile)
- `lib/metrics.ts`: ROAS, cost/comandă, profit după reclame, serii zilnice, campanii
- `lib/tracking/*` + `/t.js` + `/api/t` + `/l/<cod>`: tracking propriu. Snippet-ul se ia din proiect → „Tracking”;
  obiective după adresa paginii, comenzi din dataLayer (GA4 `purchase`), plăți Stripe legate prin `client_reference_id` /
  `metadata.md_vid`, linkuri scurte urmărite, cheltuieli manuale. Raportul „De unde vin clienții” e pe pagina proiectului.
  Consimțământ: cu `data-consent="required"` pe tag, t.js nu scrie și nu trimite nimic până la `mdTrack.consent(true)`
  (sau `window.mdConsent = true` pus înainte de script); `mdTrack.consent(false)` oprește și șterge `_md_vid`/`_md_sid`/`_md_last`.
  Datele de tracking mai vechi de 26 de luni se șterg la `/api/cron/sync` (vezi `/confidentialitate`).
- `/api/cron/sync`: apelat din crontab-ul serverului la 10 minute (`/usr/local/bin/mydashboard-sync.sh`) și de `.github/workflows/sync.yml`
- `lib/gsc.ts` + `/api/cron/gsc`: Google Search Console (clicuri, afișări, locul mediu pe zi; topul căutărilor și al paginilor pe
  28 de zile vs. cele 28 dinainte). Tabul „Google” din proiect. Alertă când clicurile scad cu peste 30% față de săptămâna trecută
  (doar peste 50 de clicuri/săptămână) sau când citirea eșuează.
- `lib/money.ts` + `/dashboard/bani` + tabul „Bani”: vânzări − costuri (comision Stripe, AI, reclame, costuri fixe) = profit,
  luna asta vs. aceleași zile din luna trecută. Sumele în alte monede se schimbă la cursul BNR (`lib/fx.ts`).
- `lib/integrations/clarity.ts` + `lib/clarity.ts`: Microsoft Clarity (conexiunea CLARITY: Project ID + token din Settings → Data
  Export). API-ul dă doar totalul ultimelor 24 de ore și maxim 10 cereri pe zi, așa că `/api/cron/sync` îl citește o singură dată
  pe zi, după ora 3 (ora României), și îl salvează ca ziua de ieri (`ClarityDaily`); după o eroare reîncearcă la 2 ore, de maxim
  4 ori în 24 de ore. Blocul „Cum se poartă vizitatorii” e în tabul „Trafic”; salturile de erori JS / clicuri de nervi apar în
  raportul de dimineață. Conexiunile se pun la deploy cu `_deploy/clarity_mydashboard.cjs`.
- `lib/integrations/ai-admin.ts` + `lib/ai-accounts.ts` + `lib/ai-api-costs.ts` + `/dashboard/ai` („Costuri AI”): costul facturat de
  Anthropic (Usage & Cost Admin API, cheie `sk-ant-admin…`) și OpenAI (Costs + Usage API, cheie `sk-admin-…`). O cheie pe organizație
  (`AiAccount`, criptată), costul pe zi UTC × workspace/proiect extern × model în `AiCostDaily`, iar `AiProjectLink` spune ce
  workspace (`wrkspc_…`) / proiect OpenAI (`proj_…`) / `default` ține de ce proiect (atribuit la citire; ce nu e legat apare
  „Neatribuit”). `/api/cron/sync` le citește o dată pe zi, după ora 5 (ultimele 7 zile; prima dată 90). Intră în „Bani” la AI.
  Replicate rămâne estimat din timpul de rulare. Cheile și legăturile se pun la deploy cu `_deploy/ai_keys_mydashboard.cjs`.
- `lib/daily-report.ts` + `/api/cron/report` + `/dashboard/raport`: raportul de dimineață pe e-mail (ieri vs. aceeași zi de
  săptămâna trecută), cu buton „Trimite acum raportul de test”. Secțiunea „Din aplicații – ultimele 24 h” citește în paralel
  `/api/mydashboard/stats` al fiecărui proiect (max ~6 cifre pe aplicație, `h24` sau „azi” dacă aplicația nu trimite `h24`);
  facturile neemise apar cu roșu și intră primele în „Ce s-a schimbat”.

## Joburi programate (crontab pe server, ora UTC)

```cron
*/10 * * * * /usr/local/bin/mydashboard-sync.sh >> /var/log/mydashboard-sync.log 2>&1
# Google Search Console, o dată pe zi (06:00/07:00 în România), înainte de raport
0 4 * * * CS=$(grep -E "^CRON_SECRET=" /opt/apps/mydashboard/.env | cut -d= -f2- | tr -d '"'); curl -s -o /dev/null -w "gsc \%{http_code}\n" -X POST -H "Authorization: Bearer $CS" --max-time 290 https://mydashboard.ro/api/cron/gsc >> /var/log/mydashboard-sync.log 2>&1
# Raportul de dimineață la 07:30 în România: rulează la 04:30 și 05:30 UTC, trimite doar cel care cade la ora 7 (vară/iarnă)
30 4,5 * * * CS=$(grep -E "^CRON_SECRET=" /opt/apps/mydashboard/.env | cut -d= -f2- | tr -d '"'); curl -s -o /dev/null -w "raport \%{http_code}\n" -X POST -H "Authorization: Bearer $CS" --max-time 110 https://mydashboard.ro/api/cron/report >> /var/log/mydashboard-sync.log 2>&1
```

În crontab `%` înseamnă linie nouă, de aceea e scris `\%{http_code}`; fiecare job stă pe un singur rând. Raportul se trimite
cu Resend (`RESEND_API_KEY`) la `ALERT_EMAIL`. Verificare pe server: `crontab -l | grep cron/report` și, după 07:30,
`grep raport /var/log/mydashboard-sync.log` (`raport 200` la ambele apeluri; doar cel din ora 7 trimite e-mailul).

Cheia Search Console pe server: `base64 -w0 gsc-key.json` → `GSC_SERVICE_ACCOUNT_JSON=...` în `.env` (și în secretul
`ENV_CONTENTS`). Alternativ fișierul în `/opt/apps/mydashboard/secrets/gsc-key.json`, montat în container
(`volumes: ["./secrets:/app/secrets:ro"]` în `docker-compose.yml` din `deploy.yml`) cu `GSC_SERVICE_ACCOUNT_FILE=/app/secrets/gsc-key.json`.

## Schimbări de schemă pe baza comună

Baza e comună (`toateproiectele`, schema `mydashboard`), deci **nu** rulăm `prisma db push` pe producție. Pașii:
1. `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` (doar citește) → fișier în `prisma/sql/`.
2. Verifici că are doar adăugări (tabele noi, coloane care acceptă NULL).
3. `DATABASE_URL=... node scripts/apply-sql.mjs prisma/sql/<fișier>.sql` (refuză DROP/RENAME/ALTER COLUMN/DELETE, rulează într-o tranzacție).
- `lib/app-stats.ts` + `components/AppStatsSection.tsx`: cifrele din aplicații (conturi, comenzi, ce s-a vândut), vezi mai jos

## Statistici din aplicații

Pe pagina proiectului (Prezentare), sub încasările din Stripe, apare secțiunea „Din aplicație” dacă aplicația
proiectului expune endpoint-ul de mai jos. Nu se configurează nimic în mydashboard și nu se salvează nimic în baza de date:
la deschiderea paginii citim `https://<domeniul proiectului>/api/mydashboard/stats` (cache 5 minute în memorie;
aplicațiile care răspund 404 sunt reîncercate la 30 de minute).

**Autentificare** (ca la `/api/alert`): antetul `x-stats-token` = `HMAC-SHA256(CRON_SECRET, "stats:<proiect>")`, unde
`<proiect>` e numele proiectului din mydashboard cu litere mici (`bazadate`, `postingclips`, `tiparementale`,
`constelatii`, `invitonline`). Aplicația îl primește în `.env` ca `MYDASHBOARD_STATS_TOKEN` și îl compară în timp constant;
fără variabilă răspunde 404 (endpoint dezactivat). Tokenul se calculează cu:

```bash
node -e "console.log(require('crypto').createHmac('sha256', process.env.CRON_SECRET).update('stats:bazadate').digest('hex'))"
```

**Răspunsul** (JSON, validat cu zod în `lib/app-stats.ts`; câmpurile în plus sunt ignorate):

```jsonc
{
  "project": "bazadate",                 // același nume ca în token
  "generatedAt": "2026-09-26T10:00:00Z",
  "currency": "RON",                     // opțional; implicit moneda proiectului
  "kpi": [                               // max 24 rânduri, în ordinea în care se afișează
    { "key": "conturi", "label": "Conturi noi", "unit": "count",   // count | money | percent
      "hint": "opțional, text mic sub etichetă",
      "h24": 1,                                                  // opțional: ultimele 24 de ore (fereastră mobilă)
      "today": 1, "d7": 4, "d30": 14, "total": 290 }             // zile din România; null = „–”
  ],
  "recent": [                            // opțional, max 50 (se afișează 10)
    { "at": "2026-09-26T09:12:00Z", "title": "100 firme", "detail": "Ion Pop · client@exemplu.ro · factura CDV 12",
      "amount": 75.5, "status": "paid" }                         // paid | pending | abandoned | failed | alt text
  ]
}
```

`h24` e opțional (aplicațiile care trimit doar `today/d7/d30/total` merg în continuare): dacă cel puțin un rând are `h24`,
pagina proiectului arată coloana „24 h” înaintea lui „Azi”, iar raportul de dimineață folosește `h24` (altfel `today`, marcat
„azi”). În raport intră până la ~6 rânduri pe aplicație, fără procente/medii și fără cele cu 0/null; un rând „Facturi neemise”
(cheia `facturiNeemise` sau eticheta „Facturi neemise”) apare mereu când e > 0 (inclusiv `total`), cu roșu.

`recent[].detail` poate conține clientul și starea facturii, separate prin ` · `: `"Nume · email · factura CDV 12"` sau, când
factura n-a fost emisă, `"Nume · email · FĂRĂ FACTURĂ: motiv"` (întotdeauna ultimul). Pagina arată detaliul întreg, iar partea
care începe cu „FĂRĂ FACTURĂ” apare ca etichetă roșie.

Sumele sunt în unități întregi ale monedei (lei, nu bani). Nu trimite încasări care vin deja din Stripe ca „venit” fără o
etichetă clară; secțiunea e pentru ce vede aplicația (conturi, comenzi, produse vândute). Implementare de referință:
`bazadate-main/app/api/mydashboard/stats/route.js` + `statsMydashboard()` din `bazadate-main/lib/admin.js`.

Local: `APP_STATS_URLS="bazadate=http://localhost:3000"` citește aplicația de pe alt host decât domeniul proiectului.

| Integrare | Stare |
|---|---|
| Stripe | ✅ restricted key, read-only |
| Meta Ads | ✅ System User token + `act_...` |
| Google Ads | ⏳ necesită developer token aprobat |
| TikTok Ads | ⏳ necesită aplicație Marketing API aprobată |
| PostingClips | ✅ cheie API read-only (PostingClips → Conturi → Chei API) |
| Oblio | ⏳ refolosim `bazadate-main/lib/oblio.js` |

## Pornire locală

```bash
cp .env.example .env         # completează valorile
npm install
npx prisma db push           # creează tabelele
npm run create-admin -- email@exemplu.ro "parola-sigura" "Numele agenției"
npm run dev
```

## Deploy (Hetzner, ca celelalte site-uri)

1. Creează baza `mydashboard` în Postgres pe server și rulează local `npx prisma db push` cu `DATABASE_URL` spre ea.
2. Repo GitHub, apoi secretele: `DATABASE_URL`, `SERVER_PASSWORD`, `ENV_CONTENTS` (tot `.env`-ul de producție), `CRON_SECRET`.
3. Push pe `main`: imaginea se construiește și rulează pe portul **3009**.
4. În nginx: `mydashboard.ro` → `127.0.0.1:3009` + certificat SSL.
5. `npm run create-admin` cu `DATABASE_URL` de producție.

⚠️ `ENCRYPTION_KEY` nu se schimbă după ce ai conectat conturi, altfel cheile salvate nu se mai pot decripta.
