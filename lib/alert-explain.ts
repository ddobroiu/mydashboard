// Explicatia pe intelesul proprietarului pentru fiecare alerta (romana simpla, fara jargon).
// Fisier „pur” (fara Prisma / fetch / importuri @/): ruleaza si in testele cu node (scripts/test-alert-explain.mjs).
// Stratul 1 = regulile de aici; stratul 2 = AI (lib/alert-ai.ts) doar pentru mesajele pe care regulile nu le recunosc.

export type Severity = "Urgent" | "Important" | "Mic";
export type Who = "programator" | "tu" | "amândoi" | "nimeni";

export type AlertExplanation = {
  title: string; // fraza scurta pentru subiectul e-mailului: „pagina de facturi nu se deschide”
  what: string; // Ce s-a întâmplat
  customers: string; // Îi afectează pe clienți? (începe cu „Da” / „Nu” / „Puțin”)
  severity: Severity;
  action: string; // Ce trebuie făcut
  who: Who;
  source: "reguli" | "generic" | "ai";
  local?: boolean; // eroare venita de pe calculatorul unui programator: test local — ignorat
};

export type AlertInput = { kind: string; project?: string | null; message: string };

export const SEVERITY_ORDER: Record<Severity, number> = { Urgent: 0, Important: 1, Mic: 2 };

// ─── Teste locale ───────────────────────────────────────────────────────────

// Erorile de pe calculatorul unui programator (next dev pe Windows / Mac): nu sunt probleme ale site-ului real.
// Atentie: „127.0.0.1” / „localhost” NU inseamna local (pe server baza de date chiar e pe 127.0.0.1).
const LOCAL_RES = [
  /[A-Za-z]:\\+Users\\+/, // C:\Users\... (si varianta cu \\ din JSON)
  /[A-Za-z]:\/Users\//, // C:/Users/...
  /[\\/]\.next[\\/]+dev[\\/]/, // /.next/dev/ = serverul de dezvoltare Next
  /(^|[\s(])\/Users\/[^/\s]+\//, // macOS
  /\bNODE_ENV[=:]\s*["']?development\b/i,
  /\b(env|environment|mediu)[=:]\s*["']?(dev|development|local)\b/i,
  /\[(dev|local)\]/i,
];

// Pentru numaratori in baza (meniu, prima pagina): alertele active care NU vin de pe calculatorul unui programator.
// Alertele noi de test local se salveaza deja ca rezolvate; filtrul prinde randurile vechi.
export const NOT_LOCAL_ALERT = {
  NOT: [{ message: { contains: ":\\Users\\" } }, { message: { contains: ".next/dev/" } }, { message: { contains: ".next\\dev\\" } }],
};

export function isLocalDevAlert(message: string, env?: string | null): boolean {
  if (env && /^(dev|development|local|test)$/i.test(env.trim())) return true;
  return LOCAL_RES.some((r) => r.test(message));
}

// ─── Fara secrete in textul trimis la AI (si in subiecte) ─────────────────

export function scrubSecrets(text: string): string {
  return (
    text
      // utilizator:parola@ in URL-uri (postgres://user:pass@host)
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1***@")
      // parametri sensibili in query string
      .replace(/([?&](?:token|key|api_key|apikey|secret|password|pass|sig|signature|auth|access_token|code)=)[^&\s]+/gi, "$1***")
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 ***")
      .replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, "***")
      .replace(/\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|whsec_[A-Za-z0-9]{8,}|re_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,})/g, "***")
      .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "***") // JWT
      .replace(/\b(password|passwd|pwd|secret|token|api[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, "$1$2***")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "***@***") // adrese de e-mail
      .replace(/\b[a-f0-9]{32,}\b/gi, "***") // chei hex lungi
      .replace(/\b[A-Za-z0-9+/]{40,}={0,2}/g, "***") // base64 lung
  );
}

// ─── Ce pagina / ce job ───────────────────────────────────────────────────

const PAGE_NOUNS: Record<string, string> = {
  invoices: "facturi",
  facturi: "facturi",
  billing: "abonament și plăți",
  plati: "plăți",
  payments: "plăți",
  checkout: "plată",
  cart: "coș",
  cos: "coș",
  orders: "comenzi",
  comenzi: "comenzi",
  login: "autentificare",
  signin: "autentificare",
  autentificare: "autentificare",
  register: "înregistrare",
  signup: "înregistrare",
  settings: "setări",
  setari: "setări",
  account: "cont",
  cont: "cont",
  judet: "județ",
  judete: "județ",
  localitate: "localitate",
  localitati: "localitate",
  oras: "oraș",
  ghiduri: "ghid",
  ghid: "ghid",
  blog: "blog",
  articole: "articol",
  produs: "produs",
  produse: "produs",
  product: "produs",
  products: "produs",
  firma: "firmă",
  firme: "firmă",
  companie: "firmă",
  cauta: "căutare",
  search: "căutare",
  contact: "contact",
  pricing: "prețuri",
  preturi: "prețuri",
  categorie: "categorie",
  category: "categorie",
  oferte: "oferte",
  clips: "clipuri",
};

const OG_SEGMENTS = new Set(["opengraph-image", "twitter-image", "icon", "apple-icon"]);

export type ParsedAlert = {
  method?: string;
  path?: string;
  phase?: string; // render / route / action / ...
  isOgImage: boolean;
  isApi: boolean;
  page?: string; // „pagina de facturi”, „paginile de județ”
  job?: string; // „oferte”
  jobFreq?: string; // „orar”
  detail: string; // mesajul fara prefixul „GET /x (render):”
};

export function pageLabel(path: string): { label: string; isOgImage: boolean; isApi: boolean } {
  const segs = path.split(/[?#]/)[0].split("/").filter((s) => s && s !== "[locale]" && s !== "[lang]" && !/^\(.*\)$/.test(s));
  const isOgImage = segs.length > 0 && OG_SEGMENTS.has(segs[segs.length - 1].replace(/\.\w+$/, ""));
  const core = isOgImage ? segs.slice(0, -1) : segs;
  const isApi = core[0] === "api";
  if (isApi) return { label: `o funcție internă a site-ului (${path})`, isOgImage, isApi };
  if (!core.length) return { label: "prima pagină", isOgImage, isApi };
  const lastDynamic = /^\[.*\]$/.test(core[core.length - 1]);
  const statics = core.filter((s) => !/^\[.*\]$/.test(s));
  const last = statics[statics.length - 1];
  if (!last) return { label: `pagina ${path}`, isOgImage, isApi };
  if (last === "dashboard" && !lastDynamic) return { label: "panoul de cont al clienților", isOgImage, isApi };
  const noun = PAGE_NOUNS[last.toLowerCase()];
  if (noun) return { label: lastDynamic ? `paginile de ${noun}` : `pagina de ${noun}`, isOgImage, isApi };
  return { label: lastDynamic ? `paginile „/${statics.join("/")}/…”` : `pagina „/${core.join("/")}”`, isOgImage, isApi };
}

export function parseAlert(message: string): ParsedAlert {
  const m = message.match(/^\s*(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(\/\S*)\s*(?:\(([^)]+)\))?\s*:\s*([\s\S]*)$/);
  if (m) {
    const { label, isOgImage, isApi } = pageLabel(m[2]);
    return { method: m[1], path: m[2], phase: m[3]?.trim(), isOgImage, isApi, page: label, detail: m[4] };
  }
  const j = message.match(/^\s*([\w.-]+):\s*jobul\s+(\S+)\s+a\s+eșuat\s*:\s*([\s\S]*)$/i) ?? message.match(/^\s*([\w.-]+):\s*job(?:ul)?\s+failed\s*:\s*([\s\S]*)$/i);
  if (j) return j.length === 4 ? { job: j[1], jobFreq: j[2], isOgImage: false, isApi: false, detail: j[3] } : { job: j[1], isOgImage: false, isApi: false, detail: j[2] };
  return { isOgImage: false, isApi: false, detail: message };
}

const jobPhrase = (p: ParsedAlert) => `actualizarea automată „${p.job}”`;
const jobFreq = (p: ParsedAlert) => (p.jobFreq === "orar" ? ", care rulează din oră în oră," : p.jobFreq === "zilnic" ? ", care rulează zilnic," : "");

const where = (p: ParsedAlert) => p.page ?? (p.job ? jobPhrase(p) : "o parte a site-ului");

const SERVICES: [RegExp, string][] = [
  [/stripe/i, "Stripe (plățile cu cardul)"],
  [/anthropic|claude/i, "Anthropic (AI)"],
  [/openai/i, "OpenAI (AI)"],
  [/replicate/i, "Replicate (AI)"],
  [/elevenlabs/i, "ElevenLabs (voce AI)"],
  [/resend/i, "Resend (trimiterea e-mailurilor)"],
  [/smartbill|fgo|oblio/i, "programul de facturare"],
  [/anaf/i, "ANAF"],
  [/googleapis|google/i, "Google"],
  [/facebook|graph\.facebook|meta/i, "Meta (Facebook / Instagram)"],
  [/trendyol/i, "Trendyol"],
  [/zernio/i, "Zernio (postarea pe rețele)"],
  [/r2\.cloudflarestorage|cloudflare/i, "Cloudflare (stocarea fișierelor)"],
  [/:5432\b|postgres|prisma|database/i, "baza de date"],
  [/redis|:6379\b/i, "memoria rapidă (Redis)"],
];
const serviceName = (text: string) => SERVICES.find(([r]) => r.test(text))?.[1];

// ─── Stratul 1: reguli ────────────────────────────────────────────────────

type Rule = (a: AlertInput, p: ParsedAlert, text: string) => Omit<AlertExplanation, "source" | "local"> | null;

const byKind: Rule = (a, _p, t) => {
  const proj = a.project || "site-ul";
  switch (a.kind) {
    case "down":
      return {
        title: "site-ul nu se deschide",
        what: `${proj} nu răspunde când îl deschidem (verificarea automată la 5 minute a eșuat de două ori la rând).`,
        customers: "Da — vizitatorii nu pot deschide site-ul deloc.",
        severity: "Urgent",
        action: "Programatorul (Claude) verifică serverul și repornește site-ul. Tu nu trebuie să faci nimic, doar anunță-l dacă nu a primit deja mesajul.",
        who: "programator",
      };
    case "credits":
    case "ai-credit": {
      const svc = serviceName(t)?.replace(/ \(.*\)$/, "");
      return {
        title: `s-au terminat creditele la ${svc ?? "un furnizor"}`,
        what: `${svc ? `Contul ${svc}` : "Un serviciu plătit"} folosit de ${proj} nu mai are bani, așa că refuză cererile.`,
        customers: "Da — funcțiile care folosesc acel serviciu (de ex. generarea cu AI) nu mai merg.",
        severity: "Urgent",
        action: `Tu: reîncarcă creditul (sau mărește limita lunară) în contul ${svc ?? "furnizorului"}. Programatorul nu poate face asta în locul tău.`,
        who: "tu",
      };
    }
    case "voice": {
      // ElevenLabs (vocea din PostingClips), din lib/elevenlabs.ts; mesajul e deja pe intelesul tuturor
      const plain = t.replace(/\s*\[[^\]]*\]\s*$/, "").trim();
      if (/cheia|cheie|HTTP 40[13]/i.test(t) && !/caractere/i.test(t)) {
        return {
          title: "ElevenLabs nu mai acceptă cheia (vocea din PostingClips)",
          what: plain,
          customers: "Da — clipurile cu voce din PostingClips probabil nu se mai pot face.",
          severity: "Urgent",
          action: "Tu faci o cheie nouă în contul ElevenLabs (Profil → API Keys), iar programatorul (Claude) o pune în setări (ELEVENLABS_API_KEY).",
          who: "amândoi",
        };
      }
      const out = /rămas fără credite/i.test(t);
      const almost = /aproape fără credite/i.test(t);
      return {
        title: out ? "ElevenLabs a rămas fără credite — vocea nu mai merge" : almost ? "ElevenLabs a rămas aproape fără credite (95%)" : "s-au folosit 80% din caracterele ElevenLabs",
        what: plain,
        customers: out
          ? "Da — clipurile cu voce din PostingClips nu se mai pot face până la resetare."
          : "Încă nu — vocea merge, dar se oprește când se termină caracterele lunii.",
        severity: out ? "Urgent" : "Important",
        action: "Tu: treci pe un plan mai mare în ElevenLabs (Subscription) sau aștepți resetarea lunară. Programatorul nu are ce repara în cod.",
        who: "tu",
      };
    }
    case "ai-auth":
      return {
        title: "cheia pentru serviciul AI nu mai e acceptată",
        what: `Furnizorul AI refuză cheia de acces folosită de ${proj} (a fost ștearsă, a expirat sau nu are drepturi).`,
        customers: "Da — funcțiile cu AI ale site-ului nu merg.",
        severity: "Urgent",
        action: "Tu creezi o cheie nouă în contul furnizorului, iar programatorul (Claude) o pune în setările site-ului.",
        who: "amândoi",
      };
    case "ai-rate":
      return {
        title: "serviciul AI respinge cererile (prea multe deodată)",
        what: `${proj} trimite prea multe cereri la AI într-un timp scurt și furnizorul le refuză temporar.`,
        customers: "Puțin — unii clienți pot primi erori sau trebuie să încerce din nou.",
        severity: "Important",
        action: "Programatorul (Claude) reduce numărul de cereri. Dacă se repetă des, poți cere furnizorului o limită mai mare.",
        who: "programator",
      };
    case "ai-budget":
      return {
        title: "costul AI a depășit bugetul stabilit",
        what: `${proj} a cheltuit pe AI mai mult decât bugetul zilnic sau lunar pus în mydashboard.`,
        customers: "Nu — site-ul merge normal, e doar o atenționare despre bani.",
        severity: "Important",
        action: "Tu decizi: mărești bugetul în mydashboard (Costuri AI) sau ceri programatorului să reducă folosirea AI.",
        who: "tu",
      };
    case "sync":
      return {
        title: "o conexiune din mydashboard nu se mai actualizează",
        what: `mydashboard nu mai poate citi datele unui cont legat (plăți, reclame, Google etc.) pentru ${proj}.`,
        customers: "Nu — site-ul merge normal; doar cifrele din mydashboard nu se mai actualizează.",
        severity: "Mic",
        action: "De obicei tu reconectezi contul în mydashboard (parola sau accesul s-a schimbat). Dacă nu merge, spune-i programatorului.",
        who: "tu",
      };
    case "traffic":
      return {
        title: "au scăzut vizitele din Google",
        what: `${proj} primește vizibil mai puține vizite din căutările Google decât de obicei.`,
        customers: "Nu direct — dar vin mai puțini clienți noi.",
        severity: "Important",
        action: "Programatorul (Claude) verifică în Search Console dacă paginile au ieșit din Google sau dacă e o eroare pe site.",
        who: "programator",
      };
  }
  return null;
};

const credits: Rule = (_a, p, t) => {
  if (!/\b402\b|insufficient[_ ](credit|funds|balance|quota)|credit balance is too low|out of credits?|quota exceeded|exceeded your current quota|billing|payment required|not enough credits?|credit(e)? terminat/i.test(t)) return null;
  const svc = serviceName(t);
  return {
    title: `s-au terminat creditele${svc ? ` la ${svc.replace(/ \(.*\)$/, "")}` : " la un furnizor"}`,
    what: `${svc ?? "Un serviciu plătit folosit de site"} nu mai are credit în cont și refuză cererile.`,
    customers: `Da — ${p.page ? `${where(p)} nu funcționează corect` : "funcțiile care folosesc acel serviciu nu mai merg"} până se reîncarcă.`,
    severity: "Urgent",
    action: `Tu: reîncarcă creditul${svc ? ` în contul ${svc.replace(/ \(.*\)$/, "")}` : " în contul furnizorului"} (sau mărește limita). Programatorul nu are ce repara în cod.`,
    who: "tu",
  };
};

const permission: Rule = (_a, p, t) => {
  const m = t.match(/permission denied for (?:table|relation|schema|sequence)\s+["']?([\w.]+)/i);
  if (!m) return null;
  const pageCase = Boolean(p.page) && !p.isApi;
  return {
    title: pageCase ? `${where(p)} nu se deschide (fără acces la date)` : `${where(p)} nu are acces la date`,
    what: `${pageCase ? "Site-ul" : `Programul automat${p.job ? ` „${p.job}”${jobFreq(p)}` : ""}`} nu mai are voie să citească un tabel din baza de date (${m[1]}) — de obicei se întâmplă după un import de date, când drepturile de acces se pierd.`,
    customers: pageCase
      ? `Da — ${where(p)} dau eroare.`
      : `Nu direct — dar datele${p.job ? ` din „${p.job}”` : ""} nu se mai actualizează până se repară.`,
    severity: pageCase ? "Urgent" : "Important",
    action: `Programatorul (Claude) redă drepturile de acces în baza de date${/remote-db\.mjs grants/.test(t) ? " (comanda e scrisă în detaliile tehnice)" : ""}. Tu nu trebuie să faci nimic.`,
    who: "programator",
  };
};

const diskFull: Rule = (_a, p, t) => {
  if (!/no space left on device|could not resize shared memory|\b53100\b|ENOSPC|disk (is )?full|out of shared memory/i.test(t)) return null;
  const pg = /prisma|query|postgres|53100|shared memory/i.test(t);
  return {
    title: p.page ? `${where(p)} se ${p.page.startsWith("paginile") ? "încarcă greu sau dau" : "încarcă greu sau dă"} eroare` : "serverul a rămas fără spațiu",
    what: pg
      ? "Serverul bazei de date a rămas fără memorie temporară / spațiu pe disc, așa că unele căutări în date eșuează."
      : "Serverul a rămas fără spațiu pe disc, așa că nu mai poate salva fișiere sau date noi.",
    customers: p.page ? `Da — ${where(p)} se încarcă foarte greu sau arată o eroare.` : "Da — paginile pot fi lente sau pot da erori.",
    severity: "Urgent",
    action: "Programatorul (Claude) eliberează spațiu pe server (fișiere temporare, copii vechi) sau mărește memoria bazei de date. Dacă se repetă, s-ar putea să trebuiască un server mai mare — asta e decizia ta.",
    who: "programator",
  };
};

const ogImage: Rule = (_a, p, t) => {
  const fontMissing = /ENOENT[\s\S]*\.(ttf|otf|woff2?)\b/i.test(t) || /\.(ttf|otf|woff2?)['"]?[\s\S]*ENOENT/i.test(t);
  if (!p.isOgImage && !fontMissing) return null;
  const page = p.page ?? "paginile site-ului";
  return {
    title: `lipsește imaginea la distribuirea ${page.replace(/^paginile de /, "paginilor de ").replace(/^pagina de /, "paginii de ")}`,
    what: `Site-ul nu poate desena poza de previzualizare pentru ${page}${fontMissing ? " pentru că lipsește un fișier de font de pe server" : ""}.`,
    customers: "Puțin — paginile merg normal, dar când cineva le distribuie pe Facebook / WhatsApp nu apare imaginea.",
    severity: "Mic",
    action: `Programatorul (Claude) ${fontMissing ? "adaugă fișierul de font în pachetul publicat pe server" : "repară generarea imaginii"}. Tu nu trebuie să faci nimic.`,
    who: "programator",
  };
};

const codeDbMismatch: Rule = (_a, p, t) => {
  const m =
    /Cannot read propert(?:y|ies) of undefined \(reading '(find\w*|create\w*|update\w*|upsert|delete\w*|count|aggregate|groupBy)'\)/i.test(t) ||
    /\bP20(21|22)\b|(?:table|relation|column) [\s\S]{0,80}does not exist|The (table|column) `[^`]+` does not exist/i.test(t) ||
    /prisma[\s\S]{0,40}(is not a function|undefined)/i.test(t);
  if (!m) return null;
  return {
    title: `${where(p)} nu se ${p.job ? "mai face" : p.page?.startsWith("paginile") ? "deschid" : "deschide"}`,
    what: "Codul nou al site-ului caută în baza de date ceva ce încă nu există acolo (codul și baza de date nu se mai potrivesc după o actualizare).",
    customers: p.page && !p.isApi ? `Da — ${where(p)} arată o eroare în loc de conținut.` : "Da — o funcție a site-ului nu merge.",
    severity: "Important",
    action: "Programatorul (Claude) aduce baza de date la zi cu codul (sau repară codul). Tu nu trebuie să faci nimic.",
    who: "programator",
  };
};

const unreachable: Rule = (_a, p, t) => {
  if (!/ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|timed? ?out|timeout|\b50[234]\b|Bad Gateway|Service Unavailable|Gateway Time-?out|Can't reach database server|P1001|P1008/i.test(t)) return null;
  const svc = serviceName(t);
  const isDb = svc === "baza de date";
  return {
    title: `${svc ?? "un serviciu extern"} nu a răspuns${p.page ? ` (${where(p)})` : p.job ? ` (${p.job})` : ""}`,
    what: `${svc ? (isDb ? "Baza de date" : svc) : "Un serviciu de care depinde site-ul"} nu a răspuns la timp sau a refuzat conexiunea.`,
    customers: p.page && !p.isApi
      ? `Da — ${where(p)} s-ar putea să nu se deschidă cât timp durează problema.`
      : p.job
        ? "Nu direct — doar actualizarea automată a fost amânată."
        : "Posibil — o funcție a site-ului poate da eroare cât timp durează problema.",
    severity: isDb && p.page ? "Urgent" : "Important",
    action: `Dacă apare o singură dată, nu e nimic de făcut (se întâmplă când un serviciu are o pauză scurtă). Dacă se repetă, programatorul (Claude) verifică ${svc ? (isDb ? "baza de date" : svc) : "serviciul"}.`,
    who: "programator",
  };
};

const notFound: Rule = (_a, p, t) => {
  if (!/\b404\b|not found|NEXT_NOT_FOUND|ENOENT/i.test(t)) return null;
  return {
    title: `${where(p)} ${/ENOENT/.test(t) ? "nu găsește un fișier" : "nu a fost găsită"}`,
    what: /ENOENT/.test(t)
      ? "Site-ul caută un fișier pe server care nu există (lipsește din pachetul publicat)."
      : "Cineva a cerut o pagină sau o resursă care nu există.",
    customers: /ENOENT/.test(t) ? `Posibil — ${where(p)} poate afișa o eroare.` : "Puțin — vizitatorul vede pagina „nu există”.",
    severity: "Mic",
    action: "Programatorul (Claude) verifică dacă e o legătură greșită sau un fișier lipsă. Tu nu trebuie să faci nimic.",
    who: "programator",
  };
};

// Erori generale de pagina / job: explicatie generica (AI o poate inlocui cu una mai precisa)
const genericPage: Rule = (_a, p, t) => {
  if (p.page && !p.isApi) {
    return {
      title: `${where(p)} ${p.page.startsWith("paginile") ? "dau" : "dă"} eroare`,
      what: `${where(p).replace(/^./, (c) => c.toUpperCase())} ${p.page.startsWith("paginile") ? "s-au oprit" : "s-a oprit"} cu o eroare în cod în loc să se afișeze.`,
      customers: `Da — ${where(p)} nu se ${p.page.startsWith("paginile") ? "deschid" : "deschide"} (vizitatorul vede o pagină de eroare).`,
      severity: "Important",
      action: "Programatorul (Claude) repară eroarea din cod. Tu nu trebuie să faci nimic.",
      who: "programator",
    };
  }
  if (p.isApi || p.method) {
    return {
      title: `o funcție internă a site-ului dă eroare`,
      what: `O funcție din spatele site-ului (${p.path}) s-a oprit cu o eroare.`,
      customers: "Posibil — un buton sau o acțiune de pe site poate să nu meargă.",
      severity: /\b500\b/.test(t) ? "Important" : "Important",
      action: "Programatorul (Claude) repară eroarea din cod. Tu nu trebuie să faci nimic.",
      who: "programator",
    };
  }
  if (p.job) {
    return {
      title: `${jobPhrase(p)} a eșuat`,
      what: `Un program care rulează singur în fundal („${p.job}”) s-a oprit cu o eroare.`,
      customers: "Nu direct — dar datele actualizate de el pot rămâne vechi.",
      severity: "Important",
      action: "Programatorul (Claude) verifică eroarea și repornește actualizarea. Tu nu trebuie să faci nimic.",
      who: "programator",
    };
  }
  return null;
};

const SPECIFIC: Rule[] = [credits, permission, diskFull, ogImage, codeDbMismatch, unreachable, notFound];

export const FALLBACK: Omit<AlertExplanation, "source"> = {
  title: "eroare raportată de site",
  what: "Site-ul a raportat o eroare pe care nu o putem descrie automat mai precis.",
  customers: "Nu știm sigur — verifică dacă site-ul merge normal.",
  severity: "Important",
  action: "Trimite-i programatorului (Claude) detaliile tehnice de mai jos.",
  who: "programator",
};

/** Explicatia din reguli. source „generic” = recunoastem doar forma (pagina / job), nu cauza: merita intrebat AI-ul. null = nimic recunoscut. */
export function explainByRules(a: AlertInput): AlertExplanation | null {
  const local = isLocalDevAlert(a.message) || undefined;
  const k = byKind(a, parseAlert(a.message), a.message);
  if (k) return { ...k, source: "reguli", local };
  const p = parseAlert(a.message);
  const text = p.detail; // fara prefixul „GET /dashboard/billing/...” (ca „billing” din adresa sa nu para lipsa de credit)
  for (const r of SPECIFIC) {
    const e = r(a, p, text);
    if (e) return { ...e, source: "reguli", local };
  }
  const g = genericPage(a, p, text);
  return g ? { ...g, source: "generic", local } : null;
}

/** Explicatia afisata: reguli specifice > AI salvat > reguli generice > text de rezerva. */
export function explainAlert(a: AlertInput & { explanation?: unknown }): AlertExplanation {
  const rules = explainByRules(a);
  const local = isLocalDevAlert(a.message) || undefined;
  if (rules?.source === "reguli") return rules;
  const stored = a.explanation as { sig?: string } | null | undefined;
  const ai = stored?.sig && stored.sig !== messageSignature(a.message) ? null : readStoredExplanation(a.explanation);
  if (ai) return { ...ai, local };
  return rules ?? { ...FALLBACK, source: "generic", local };
}

export function readStoredExplanation(v: unknown): AlertExplanation | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.source !== "ai") return null;
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const sev = s("severity");
  if (!s("title") || !s("what") || !s("customers") || !s("action") || !["Urgent", "Important", "Mic"].includes(sev)) return null;
  const who = s("who");
  return {
    title: s("title").slice(0, 120),
    what: s("what").slice(0, 400),
    customers: s("customers").slice(0, 300),
    severity: sev as Severity,
    action: s("action").slice(0, 400),
    who: (["programator", "tu", "amândoi", "nimeni"].includes(who) ? who : "programator") as Who,
    source: "ai",
  };
}

/** Semnatura mesajului (fara cifre / id-uri): explicatia AI salvata ramane valabila cat timp semnatura e aceeasi. */
export const messageSignature = (m: string) =>
  m
    .replace(/\[digest [^\]]*\]/gi, "")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** Subiectul e-mailului: „PostingClips: pagina de facturi nu se deschide (Important)” */
export function alertSubject(project: string | null | undefined, e: AlertExplanation): string {
  const t = e.title.charAt(0).toLowerCase() + e.title.slice(1);
  return `${project ? `${project}: ` : ""}${t} (${e.severity})`;
}

/** Cele 4 randuri, ca text simplu (teste, raportul de dimineata). */
export function explanationLines(e: AlertExplanation): [string, string][] {
  return [
    ["Ce s-a întâmplat", e.what],
    ["Îi afectează pe clienți?", e.customers],
    ["Gravitate", e.local ? "test local — ignorat" : e.severity],
    ["Ce trebuie făcut", e.local ? "Nimic — eroarea vine de pe calculatorul unui programator, nu de pe site-ul real." : e.action],
  ];
}
