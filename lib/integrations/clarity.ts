// Microsoft Clarity (Data Export API): cum se poarta vizitatorii pe site.
// API-ul da doar totalul ultimelor 24/48/72 de ore si permite maxim 10 cereri pe proiect pe zi,
// asa ca sync-ul il cheama o singura data pe zi (vezi clarityDue in lib/sync.ts).
// Tokenul: Clarity → Settings → Data Export → Generate new API token (unul pe proiect Clarity).
export type ClarityCredentials = { apiToken: string };

export type ClarityRow = {
  sessions: number;
  botSessions: number;
  users: number;
  pagesPerSession: number | null;
  scrollDepth: number | null;
  totalTime: number | null;
  activeTime: number | null;
  rageClicks: number;
  rageSessionsPct: number | null;
  deadClicks: number;
  deadSessionsPct: number | null;
  quickbacks: number;
  excessiveScroll: number;
  scriptErrors: number;
  scriptErrorSessionsPct: number | null;
  errorClicks: number;
};

type Metric = { metricName: string; information?: Record<string, unknown>[] };

const API_URL = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

// Clarity trimite cifrele cand ca numere, cand ca text ("9554")
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const clarityDashboardUrl = (projectId: string) =>
  `https://clarity.microsoft.com/projects/view/${encodeURIComponent(projectId)}/dashboard`;

// Totalul ultimelor 24 de ore (numOfDays=1), fara impartire pe dimensiuni: o singura cerere.
export async function fetchClarityInsights(c: ClarityCredentials): Promise<ClarityRow> {
  const res = await fetch(`${API_URL}?numOfDays=1`, {
    headers: { Authorization: `Bearer ${c.apiToken}`, "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const why =
      res.status === 401
        ? "tokenul nu e valid sau a expirat"
        : res.status === 403
          ? "tokenul nu are acces la export (generează-l din Settings → Data Export al proiectului)"
          : res.status === 429
            ? "limita de 10 cereri pe zi a fost atinsă, reîncerc mâine"
            : res.statusText;
    throw new Error(`Clarity ${res.status}: ${why}`);
  }
  const body = (await res.json()) as Metric[];
  if (!Array.isArray(body)) throw new Error("Clarity: răspuns neașteptat");

  const first = (name: string) => body.find((m) => m.metricName === name)?.information?.[0] ?? {};
  const events = (name: string) => {
    const i = first(name);
    return { count: num(i.subTotal) ?? 0, pct: num(i.sessionsWithMetricPercentage) };
  };
  const traffic = first("Traffic");
  const engagement = first("EngagementTime");
  const rage = events("RageClickCount");
  const dead = events("DeadClickCount");
  const script = events("ScriptErrorCount");

  return {
    sessions: num(traffic.totalSessionCount) ?? 0,
    botSessions: num(traffic.totalBotSessionCount) ?? 0,
    // Documentatia scrie „distantUserCount”, API-ul raspunde „distinctUserCount”
    users: num(traffic.distinctUserCount ?? traffic.distantUserCount) ?? 0,
    pagesPerSession: num(traffic.pagesPerSessionPercentage ?? traffic.PagesPerSessionPercentage),
    scrollDepth: num(first("ScrollDepth").averageScrollDepth),
    totalTime: num(engagement.totalTime),
    activeTime: num(engagement.activeTime),
    rageClicks: rage.count,
    rageSessionsPct: rage.pct,
    deadClicks: dead.count,
    deadSessionsPct: dead.pct,
    quickbacks: events("QuickbackClick").count,
    excessiveScroll: events("ExcessiveScroll").count,
    scriptErrors: script.count,
    scriptErrorSessionsPct: script.pct,
    errorClicks: events("ErrorClickCount").count,
  };
}
