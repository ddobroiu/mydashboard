import { accessToken, gscConfigured } from "@/lib/gsc";
import { statsKey } from "@/lib/app-stats";

// Google Analytics 4: vizitatori si sesiuni pe proiect, citite cu acelasi robot (service account) ca Search Console.
// Robotul trebuie adaugat in GA4 → Administrare → Gestionarea accesului la proprietate, cu rolul „Cititor”.
// Proprietatea fiecarui proiect: GA4_PROPERTIES="bazadate=553862122,oferte=123..." (cheia = numele proiectului,
// cu litere mici); fara variabila, se folosesc proprietatile cunoscute de mai jos.

const KNOWN: Record<string, string> = { bazadate: "553862122" };
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export function ga4Property(projectName: string): string | null {
  const key = statsKey(projectName);
  for (const pair of (process.env.GA4_PROPERTIES || "").split(",")) {
    const [k, v] = pair.split("=").map((s) => s?.trim());
    if (k && v && k.toLowerCase() === key) return v.replace(/^properties\//, "");
  }
  return KNOWN[key] ?? null;
}

export type Ga4Range = { since: string; until: string };
export type Ga4Numbers = { users: number; sessions: number };
export type Ga4Result =
  | { ok: true; values: Record<string, Ga4Numbers> }
  | { ok: false; reason: string; technical?: string };

const OK_MS = 15 * 60 * 1000;
const ERR_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: Ga4Result }>();

async function runReport(property: string, ranges: Record<string, Ga4Range>): Promise<Record<string, Ga4Numbers>> {
  const names = Object.keys(ranges);
  const token = await accessToken(SCOPE);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: names.map((name) => ({ name, startDate: ranges[name].since, endDate: ranges[name].until })),
      metrics: [{ name: "activeUsers" }, { name: "sessions" }],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
    error?: { status?: string; message?: string };
  };
  if (!res.ok) throw new Error(`GA4 ${res.status} ${body.error?.status ?? ""} ${body.error?.message ?? ""}`.trim());
  const out: Record<string, Ga4Numbers> = Object.fromEntries(names.map((n) => [n, { users: 0, sessions: 0 }]));
  for (const r of body.rows ?? []) {
    // cu un singur interval GA4 nu mai pune dimensiunea dateRange
    const name = names.length === 1 ? names[0] : r.dimensionValues?.[0]?.value;
    if (!name || !out[name]) continue;
    out[name] = { users: Number(r.metricValues?.[0]?.value ?? 0), sessions: Number(r.metricValues?.[1]?.value ?? 0) };
  }
  return out;
}

// Mesajul pentru proprietar cand GA4 nu da cifre
function plainReason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/403|PERMISSION_DENIED/i.test(m)) return "Google Analytics nu ne dă acces: adaugă robotul ca „Cititor” în proprietatea GA4";
  if (/Lipsește cheia/i.test(m)) return "lipsește legătura cu Google (robotul Search Console)";
  if (/timeout|TimeoutError|aborted/i.test(m)) return "Google Analytics nu a răspuns la timp";
  return "Google Analytics nu a dat cifrele acum";
}

// Vizitatori (activeUsers) si sesiuni pentru fiecare interval cerut (maxim 4 pe cerere; impartim noi)
export async function getGa4(projectName: string, ranges: Record<string, Ga4Range>): Promise<Ga4Result> {
  const property = ga4Property(projectName);
  if (!property) return { ok: false, reason: "site-ul nu e legat de Google Analytics" };
  if (!gscConfigured()) return { ok: false, reason: "lipsește legătura cu Google (robotul Search Console)" };
  const ck = `${property}|${JSON.stringify(ranges)}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  let value: Ga4Result;
  try {
    const names = Object.keys(ranges);
    const parts: Record<string, Ga4Range>[] = [];
    for (let i = 0; i < names.length; i += 4) parts.push(Object.fromEntries(names.slice(i, i + 4).map((n) => [n, ranges[n]])));
    const results = await Promise.all(parts.map((p) => runReport(property, p)));
    value = { ok: true, values: Object.assign({}, ...results) };
  } catch (e) {
    value = { ok: false, reason: plainReason(e), technical: e instanceof Error ? e.message.slice(0, 300) : String(e) };
  }
  cache.set(ck, { at: Date.now(), ttl: value.ok ? OK_MS : ERR_MS, value });
  return value;
}
