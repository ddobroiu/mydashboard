// Reguli fara API-uri platite (portate din print/shopprint-main, adaptate pentru aplicatii):
// aplicatia la care a scris clientul (din antete), categoria (oameni / notificari de platforma / newsletter / spam)
// si scorul „Posibil client” (pret, abonament, oferta, demo, factura, problema cu contul...). Functii pure.
import { isOwnAddress, MAIL_PROJECTS, PROJECT_KEYS, projectOfAddress, type MailProjectKey } from "./projects";

export type Addr = { address: string; name?: string };
export type Category = "inbox" | "system" | "bulk" | "spam";

export type MailFacts = {
  direction: "in" | "out";
  folder?: string;
  headers: Record<string, string[]>; // chei cu litere mici, valorile brute
  from: Addr | null;
  replyTo: Addr[];
  to: Addr[];
  cc: Addr[];
  subject: string;
  text: string;
  attachments: { filename: string; mime: string; size: number; inline: boolean }[];
};

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const h = (f: MailFacts, k: string) => (f.headers[k] || []).join("\n");

/** Subiectul fara Re:/Fwd:/[tag], pentru legarea raspunsurilor fara In-Reply-To. */
export function normalizeSubject(s: string | null | undefined): string {
  let out = fold(String(s || "")).trim();
  for (let i = 0; i < 6; i++) {
    const next = out.replace(/^\s*((re|fw|fwd|tr|aw|wg|sv|rv|raspuns|r)\s*(\[\d+\]|\(\d+\))?\s*:\s*)/i, "").replace(/^\[[^\]]{1,30}\]\s*/, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * Aplicatia la care a scris clientul: adresa noastra din To/Cc/X-Original-To/Delivered-To/„Received: for <…>”.
 * O adresa de pe alt domeniu decat al casutei castiga (casuta poate fi destinatia unei redirectionari).
 */
export function detectProject(f: MailFacts, mailboxProject?: MailProjectKey): MailProjectKey | undefined {
  if (f.direction === "out") return projectOfAddress(f.from?.address) || mailboxProject;
  const hay = [
    ...f.to.map((a) => a.address),
    ...f.cc.map((a) => a.address),
    ...["x-original-to", "delivered-to", "envelope-to", "x-envelope-to", "x-forwarded-to", "x-forwarded-for", "resent-to", "x-rcpt-to"].map((k) => h(f, k)),
    ...(f.headers["received"] || []).map((r) => (r.match(/\bfor\s+<?([^\s>;]+@[^\s>;]+)>?/i) || [])[1] || ""),
  ].join(" ");
  const found = [...new Set((hay.match(EMAIL_RE) || []).map((a) => projectOfAddress(a)).filter(Boolean) as MailProjectKey[])];
  const other = found.find((p) => p !== mailboxProject);
  if (other) return other;
  // formularul de contact al unei aplicatii trimis de pe adresa comuna: „Bazadate Form <contact@...>”
  if (isOwnAddress(f.from?.address)) {
    const fromName = fold(f.from?.name || "");
    const byName = PROJECT_KEYS.find((k) => fromName.includes(fold(MAIL_PROJECTS[k].name)) || fromName.includes(MAIL_PROJECTS[k].domain));
    if (byName) return byName;
  }
  return found[0] || projectOfAddress(f.from?.address) || mailboxProject;
}

/** Adresa clientului: Reply-To extern, altfel From (la primite) / primul destinatar extern (la trimise). */
export function counterpart(f: MailFacts): Addr | null {
  if (f.direction === "out") return [...f.to, ...f.cc].find((a) => !isOwnAddress(a.address)) || f.to[0] || null;
  const rt = f.replyTo.find((a) => !isOwnAddress(a.address));
  if (rt) return { address: rt.address, name: rt.name || (isOwnAddress(f.from?.address) ? undefined : f.from?.name) };
  return f.from;
}

/** Notificarile platformelor folosite de aplicatii (plati, conturi de reclame, servere, AI): domeniu → eticheta. */
const PLATFORMS: [RegExp, string][] = [
  [/(^|\.)stripe\.com$/, "Stripe"],
  [/(^|\.)(google\.com|googlemail\.com|accounts\.google\.com|youtube\.com)$/, "Google"],
  [/(^|\.)(facebookmail\.com|facebook\.com|meta\.com|instagram\.com|whatsapp\.com)$/, "Meta"],
  [/(^|\.)(tiktok\.com|tiktokv\.com|bytedance\.com)$/, "TikTok"],
  [/(^|\.)(apple\.com|icloud\.com)$/, "Apple"],
  [/(^|\.)(github\.com|githubapp\.com)$/, "GitHub"],
  [/(^|\.)cloudflare\.com$/, "Cloudflare"],
  [/(^|\.)hetzner\.(com|de|cloud)$/, "Hetzner"],
  [/(^|\.)(resend\.com|resend\.dev)$/, "Resend"],
  [/(^|\.)(openai\.com|anthropic\.com|replicate\.com|elevenlabs\.io)$/, "AI"],
  [/(^|\.)(paypal\.com|revolut\.com|wise\.com|netopia-payments\.com|netopia\.ro)$/, "Plăți"],
  [/(^|\.)(oblio\.eu|smartbill\.ro|anaf\.ro|mfinante\.gov\.ro)$/, "Facturare"],
  [/(^|\.)(cyberfolks\.ro|cyberfolks\.pl|rotld\.ro|namecheap\.com|spacemail\.com)$/, "Domenii"],
  [/(^|\.)(microsoft\.com|clarity\.ms|linkedin\.com|twitter\.com|x\.com)$/, "Platforme"],
  [/(^|\.)(zernio\.com|getlate\.dev)$/, "Zernio"],
];

export function platformOf(addr: string | null | undefined): string | null {
  const dom = String(addr || "").toLowerCase().split("@")[1] || "";
  return PLATFORMS.find(([re]) => re.test(dom))?.[1] ?? null;
}

/**
 * Scorul SpamAssassin: din „X-Spam-Status: No, score=2.3” (sigur). cPanel pune in „X-Spam-Score” scorul inmultit cu 10
 * („23” = 2,3), deci acel antet se foloseste doar cand nu exista X-Spam-Status, si atunci un intreg fara zecimale
 * langa „X-Spam-Bar” se imparte la 10.
 */
export function spamScore(f: Pick<MailFacts, "headers">): number | null {
  const st = h(f as MailFacts, "x-spam-status").match(/\bscore=(-?\d+(?:\.\d+)?)/i);
  if (st) return Number(st[1]);
  const raw = (h(f as MailFacts, "x-spam-score").match(/-?\d+(\.\d+)?/) || [])[0];
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return !raw.includes(".") && f.headers["x-spam-bar"] ? n / 10 : n;
}

export function categorize(f: MailFacts): { category: Category; tag: string | null; reason: string } {
  const folder = fold(f.folder || "");
  if (/junk|spam/.test(folder)) return { category: "spam", tag: null, reason: "folder spam" };
  if (/^\s*yes/i.test(h(f, "x-spam-flag")) || /^\s*yes/i.test(h(f, "x-spam-status")) || /^\s*[[*(]*\s*spam/i.test(f.subject)) return { category: "spam", tag: null, reason: "marcat spam de server" };
  const score = spamScore(f);
  if (score !== null && score >= 6) return { category: "spam", tag: null, reason: `scor spam ${score}` };
  if (f.direction === "out") return { category: "inbox", tag: null, reason: "" };
  const from = String(f.from?.address || "").toLowerCase();
  const platform = platformOf(from);
  if (platform) return { category: "system", tag: platform, reason: `notificare ${platform}` };
  // trimis de aplicatia noastra (cont nou, plata, eroare), fara Reply-To de client
  if (isOwnAddress(from) && !f.replyTo.some((a) => !isOwnAddress(a.address))) return { category: "system", tag: "Aplicația", reason: "trimis de aplicație" };
  if (/^(mailer-daemon|postmaster)@/.test(from)) return { category: "bulk", tag: null, reason: "notificare livrare" };
  if (f.headers["list-unsubscribe"] || f.headers["list-id"]) return { category: "bulk", tag: null, reason: "newsletter" };
  if (/^(bulk|list|junk)/i.test(h(f, "precedence").trim())) return { category: "bulk", tag: null, reason: "trimitere în masă" };
  const auto = h(f, "auto-submitted").trim().toLowerCase();
  if ((auto && auto !== "no") || f.headers["x-autoreply"] || f.headers["x-autorespond"]) return { category: "bulk", tag: null, reason: "răspuns automat" };
  if (/^(no-?reply|do-?not-?reply|noreply|newsletter|news|marketing|notifications?|notificari|alerts?|bounce[s]?)[._+-]?[^@]*@/.test(from)) return { category: "bulk", tag: null, reason: "adresă automată" };
  if (f.headers["x-campaign"] || f.headers["x-mc-user"] || f.headers["x-sib-id"] || f.headers["x-mailgun-tag"]) return { category: "bulk", tag: null, reason: "campanie" };
  return { category: "inbox", tag: null, reason: "" };
}

export const PHONE_RE = /(?:\+?4\s?0|\b0)\s?7\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/;

/** Textul nou al mesajului, fara istoricul citat („> …”, „On … wrote:”, „Pe … a scris:”). */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const isHeaderBlock = (i: number) => /^\s*(from|de la|von)\s*:\s.+/i.test(lines[i]) && lines.slice(i + 1, i + 5).some((x) => /^\s*(sent|trimis|date|data|to|către|catre|subject|subiect)\s*:/i.test(x));
  const cut = lines.findIndex(
    (l, i) =>
      /^\s*-{2,}\s*(original message|mesaj original|forwarded message|mesaj redirec\S*)\s*-{2,}/i.test(l) ||
      /^\s*(on|pe|în|in|le|am)\s.{4,160}\s(wrote|a scris|schrieb|a écrit)\s*:\s*$/i.test(l) ||
      /^_{10,}\s*$/.test(l) ||
      isHeaderBlock(i),
  );
  return (cut >= 0 ? lines.slice(0, cut) : lines).filter((l) => !/^\s*>/.test(l)).join("\n");
}

/** „Posibil client”: cerere de pret / abonament / demo / factura / problema cu contul (prag LEAD_THRESHOLD). */
export function scoreLead(f: Pick<MailFacts, "subject" | "text">): { score: number; signals: string[] } {
  const body = stripQuoted(f.text).slice(0, 20_000);
  const t = fold(`${f.subject}\n${body}`);
  const signals: string[] = [];
  let score = 0;
  const add = (n: number, label: string) => {
    score += n;
    signals.push(label);
  };
  if (/\bpret\w*|\bcat (ar )?(costa|costul|e|este)\b|\bcost(a|ul|uri)?\b|\btarif\w*|\bprice\b|\bpricing\b/.test(t)) add(2, "preț");
  if (/\babonament\w*|\bsubscri\w*|\bpachet\w*|\bplan(ul)? (pro|premium|business|anual|lunar)\b|\blicent\w*/.test(t)) add(3, "abonament");
  if (/\boferte?\w*|\bcotati\w*|\bdeviz\w*|\bquote\b/.test(t)) add(3, "ofertă");
  if (/\bcumpar\w*|\bachizit\w*|\bcomand\w*|\bvreau sa (platesc|cumpar|folosesc)|\bdoresc\b|\binteresat\w*/.test(t)) add(2, "vrea să cumpere");
  if (/\bdemo\b|\bprogramare\b|\bintalnire\b|\bun apel\b|\bsa ne (auzim|vedem)\b|\bcolaborare\b|\bparteneriat\w*|\bautomatiz\w*/.test(t)) add(3, "demo / colaborare");
  if (/\bfactur\w*|\bproforma\b|\bplata\b|\bplatit\w*|\bcard(ul)?\b|\btransfer bancar\b/.test(t)) add(2, "plată / factură");
  if (/\brambursa\w*|\brefund\w*|\bbanii inapoi\b|\banul\w* abonament\w*|\bdezabon\w*|\bchargeback\b/.test(t)) add(3, "rambursare / anulare");
  if (/\bnu (merge|functioneaza|se deschide|pot (sa )?(intra|ma loga|accesa|descarca))\b|\beroare\b|\bproblem\w*|\bbug\b|\bblocat\b/.test(t)) add(2, "problemă");
  if (/\bcont(ul)?\b|\bparol\w*|\blogare\b|\bautentific\w*|\bnu primesc (codul|e-?mailul)/.test(t)) add(1, "cont");
  if (/\bs\.?r\.?l\.?\b|\bpfa\b|\bcui\b|\bcif\b|\bfirma\b|\bcompanie\b/.test(t)) add(1, "firmă");
  if (/\burgent\w*|\bcat mai repede\b|\bastazi\b|\bazi\b/.test(t)) add(1, "urgent");
  if (PHONE_RE.test(body)) add(1, "telefon");
  return { score, signals };
}
export const LEAD_THRESHOLD = 4;

export function extractPhone(text: string): string | null {
  const m = text.match(PHONE_RE);
  if (!m) return null;
  const d = m[0].replace(/\D/g, "").replace(/^40/, "0");
  return d.length === 10 ? d : null;
}

export function preview(text: string, max = 180): string {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !/^\s*>/.test(l))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
