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
