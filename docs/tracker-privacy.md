# t.js – ce salvează și ce trimite (pentru politicile de cookies ale site-urilor)

Versiunea din 26.09.2026. Sursa: `lib/tracking/script.ts` (scriptul servit la `https://mydashboard.ro/t.js`),
`app/api/t/route.ts` + `lib/tracking/collect.ts` (serverul care primește datele).

Operator: CULOAREA DIN VIAȚA SA S.R.L. (aceeași societate care deține site-urile care folosesc scriptul), contact
`contact@mydashboard.ro`. Instrument propriu de statistici, fără terți; datele stau pe serverele Hetzner din UE.
Nota de confidențialitate completă: https://mydashboard.ro/confidentialitate

## Categorie

**Analitice / statistici** (nu sunt strict necesare) → pe site-urile cu banner de cookies se încarcă doar după acord sau
în modul „cu consimțământ” (mai jos).

## Ce salvează în browser (first-party, pe domeniul site-ului vizitat)

| Nume | Tip | Conținut | Durată |
|---|---|---|---|
| `_md_vid` | cookie (`path=/`, `SameSite=Lax`, `Secure` pe https, nu e HttpOnly) | ID aleator al vizitatorului (32 caractere hex) | 12 luni (`max-age=31536000`), reînnoit la fiecare pagină |
| `_md_vid` | localStorage | același ID | până la ștergerea datelor site-ului |
| `_md_sid` | localStorage | ID aleator al vizitei (sesiunii) | până la ștergere; o vizită nouă începe după 30 min de pauză sau la venirea din altă sursă |
| `_md_last` | localStorage | momentul ultimei activități (timestamp) | până la ștergere |

Cookie-ul `_md_vid` poate fi citit și de serverul site-ului, care îl pune în `metadata.md_vid` la Stripe Checkout (legarea
plății de vizită). Nu setează alte cookie-uri; `window.__mdTrack` / `window.mdTrack` sunt doar variabile în pagină.

## Ce trimite

Cereri `POST https://mydashboard.ro/api/t` (sendBeacon, `text/plain`; mydashboard.ro nu setează și nu folosește cookie-uri pentru aceste cereri):

- la fiecare pagină: `site` (codul public al proiectului), `vid`, `sid`, `url` (adresa paginii), `t` = `pageview`,
  `ns` (vizită nouă 0/1), `ref` (referrer, doar la începutul unei vizite și nu pentru întoarcerile de la procesatorii de
  plăți), `sw` (lățimea ecranului – **nu se salvează**);
- la comenzi: `t` = `purchase`, `value`, `currency`, `order` (numărul comenzii) – preluate din `dataLayer` (evenimentul GA4
  `purchase`) sau din `mdTrack("purchase", {...})`;
- evenimente proprii: `mdTrack("nume", {...})` → `t` = `event`, `name`, opțional `value`/`currency`/`order`;
- navigarea în aplicațiile single-page (`history.pushState`, `popstate`) trimite o nouă `pageview`.

Pe lângă asta, scriptul adaugă `client_reference_id=<_md_vid>` la linkurile de plată `buy.stripe.com` de pe pagină.

## Ce se salvează pe server

- din adresa paginii: domeniul, calea și **doar** parametrii de campanie `utm_*`, `gclid`, `fbclid`, `ttclid`, `gbraid`,
  `wbraid`, `msclkid`, `ref`; ceilalți parametri și fragmentul `#...` sunt eliminați înainte de salvare;
- din referrer: doar domeniul (ex. `google.com`), plus sursa/mediul/campania deduse;
- din user-agent: doar categoria de dispozitiv (desktop / mobil / tabletă); user-agentul complet nu se salvează;
  roboții sunt ignorați;
- **adresa IP nu este salvată** în baza de date (este văzută tehnic de server/proxy la primirea cererii);
- `vid`, `sid`, data, evenimentele și, pentru comenzi, valoarea / moneda / numărul comenzii;
- păstrare: vizitele și evenimentele mai vechi de 26 de luni (790 de zile) se șterg automat.

Linkurile scurte `https://mydashboard.ro/l/<cod>` numără doar click-ul (fără cookie-uri sau identificatori).

## Modul „cu consimțământ” (opțional)

```html
<script defer src="https://mydashboard.ro/t.js" data-site="COD" data-consent="required"></script>
<script>
  // la „Accept analitice”:          window.mdConsent = true; window.mdTrack && mdTrack.consent(true);
  // la „Refuz” / retragerea acordului: window.mdConsent = false; window.mdTrack && mdTrack.consent(false);
</script>
```

- Cu `data-consent="required"`, scriptul **nu citește, nu scrie și nu trimite nimic** până la `mdTrack.consent(true)` sau
  până când `window.mdConsent === true` (alias `window.__mdConsent`) este setat înainte de încărcarea scriptului.
- `mdTrack.consent(false)` (în orice mod) oprește trimiterea, nu mai marchează linkurile Stripe și șterge `_md_vid`,
  `_md_sid`, `_md_last`. Un acord dat din nou pornește cu identificatori noi.
- `window.mdConsent === false` înainte de încărcare: scriptul șterge identificatorii și nu pornește.
- Fără atribut și fără `window.mdConsent`, comportamentul este cel vechi (pornește imediat) – site-urile existente nu se
  schimbă. Alternativ, site-ul poate injecta tagul `<script>` doar după acord.
- Serverul site-ului ar trebui să pună `metadata.md_vid` la Stripe Checkout doar dacă există cookie-ul `_md_vid`
  (adică doar cu acord); checkout-ul funcționează la fel și fără el.

## Text scurt pentru politica de cookies a unui site

> **_md_vid** (cookie, 12 luni) și **_md_vid / _md_sid / _md_last** (localStorage) – statistici proprii de trafic
> (MyDashboard, operat de CULOAREA DIN VIAȚA SA S.R.L.): identificatori aleatori ai vizitatorului și ai vizitei, folosiți ca
> să numărăm vizitele, să aflăm sursa lor (căutare, rețele sociale, reclame) și ce vizite au dus la o comandă. Categoria:
> analitice; se folosesc numai cu acordul dumneavoastră. Datele nu sunt transmise terților.
