import crypto from "crypto";
import { z } from "zod";

// Statistici din aplicatii (conturi, comenzi, ce s-a vandut): fiecare aplicatie expune
//   GET https://<domeniul proiectului>/api/mydashboard/stats   cu antetul  x-stats-token
// iar noi le citim cand se deschide pagina proiectului (cache 5 minute in memorie).
// Contractul e descris in README.md („Statistici din aplicații”). Fara baza de date, fara conexiune de configurat:
// aplicatia are endpoint-ul doar daca are MYDASHBOARD_STATS_TOKEN = statsToken(<proiect>).

const num = z.number().nullable().optional();
const Kpi = z.object({
  key: z.string().max(60),
  label: z.string().max(80),
  unit: z.enum(["count", "money", "percent"]).catch("count"),
  hint: z.string().max(200).optional(),
  today: num,
  d7: num,
  d30: num,
  total: num,
});
const Recent = z.object({
  at: z.string(),
  title: z.string().max(200),
  detail: z.string().max(200).nullable().optional(),
  amount: z.number().nullable().optional(),
  status: z.string().max(30).optional(),
});
export const AppStatsSchema = z.object({
  project: z.string().max(60),
  generatedAt: z.string(),
  currency: z.string().length(3).optional(),
  kpi: z.array(Kpi).max(24),
  recent: z.array(Recent).max(50).optional(),
});
export type AppStats = z.infer<typeof AppStatsSchema>;

// Cheia proiectului in token: numele proiectului din mydashboard, cu litere mici (ex. "bazadate", "postingclips")
export const statsKey = (projectName: string) => projectName.trim().toLowerCase();

// Tokenul unei aplicatii: HMAC(CRON_SECRET, 'stats:<proiect>') - la fel ca tokenul de alerte, alt scop
export const statsToken = (projectName: string) =>
  crypto.createHmac("sha256", process.env.CRON_SECRET || "").update(`stats:${statsKey(projectName)}`).digest("hex");

// Adresa aplicatiei: din APP_STATS_URLS (ex. "bazadate=http://localhost:3000", pentru teste locale) sau https://<domeniu>
function baseUrl(projectName: string, domain: string | null): string | null {
  const key = statsKey(projectName);
  for (const pair of (process.env.APP_STATS_URLS || "").split(",")) {
    const [k, v] = pair.split("=").map((s) => s?.trim());
    if (k && v && k.toLowerCase() === key) return v.replace(/\/+$/, "");
  }
  if (!domain) return null;
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "")}`;
}

export type AppStatsResult = { ok: true; stats: AppStats } | { ok: false; reason: "none" | "error"; error?: string };

const OK_MS = 5 * 60 * 1000;
// aplicatiile fara endpoint (404) le reincercam rar
const NONE_MS = 30 * 60 * 1000;
const ERR_MS = 60 * 1000;
const cache = new Map<string, { at: number; ttl: number; value: AppStatsResult }>();

export async function getAppStats(projectName: string, domain: string | null): Promise<AppStatsResult> {
  const base = baseUrl(projectName, domain);
  if (!base || !process.env.CRON_SECRET) return { ok: false, reason: "none" };
  const hit = cache.get(base);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  let value: AppStatsResult;
  let ttl = OK_MS;
  try {
    const res = await fetch(`${base}/api/mydashboard/stats`, {
      headers: { "x-stats-token": statsToken(projectName), "User-Agent": "mydashboard-stats/1.0" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 405) {
      value = { ok: false, reason: "none" };
      ttl = NONE_MS;
    } else if (!res.ok) {
      value = { ok: false, reason: "error", error: res.status === 401 ? "token greșit (MYDASHBOARD_STATS_TOKEN)" : `HTTP ${res.status}` };
      ttl = ERR_MS;
    } else {
      const body = await res.json().catch(() => null);
      const parsed = AppStatsSchema.safeParse(body);
      if (parsed.success && statsKey(parsed.data.project) === statsKey(projectName)) {
        value = { ok: true, stats: parsed.data };
      } else if (body === null) {
        // site fara endpoint care raspunde 200 cu o pagina HTML
        value = { ok: false, reason: "none" };
        ttl = NONE_MS;
      } else {
        value = { ok: false, reason: "error", error: "răspuns în alt format decât contractul" };
        ttl = ERR_MS;
      }
    }
  } catch (e) {
    value = { ok: false, reason: "error", error: e instanceof Error && e.name === "TimeoutError" ? "nu răspunde în 8 secunde" : "nu se poate conecta" };
    ttl = ERR_MS;
  }
  cache.set(base, { at: Date.now(), ttl, value });
  return value;
}
