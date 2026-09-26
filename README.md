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
- `/api/cron/sync`: apelat de `.github/workflows/sync.yml` de 4 ori pe zi
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
      "today": 1, "d7": 4, "d30": 14, "total": 290 }             // zile din România; null = „–”
  ],
  "recent": [                            // opțional, max 50 (se afișează 10)
    { "at": "2026-09-26T09:12:00Z", "title": "100 firme", "detail": "client@exemplu.ro",
      "amount": 75.5, "status": "paid" }                         // paid | pending | abandoned | failed | alt text
  ]
}
```

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
