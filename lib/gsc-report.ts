import { prisma } from "@/lib/prisma";
import { addDays, dayDate, eachDay } from "@/lib/dates";

export type GscRow = { key: string; clicks: number; impressions: number; position: number; prevClicks: number | null };

export type GoogleReport = {
  siteUrl: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  lastDate: string | null;
  // ultimele 28 de zile cu date si cele 28 dinainte
  period: { start: string; end: string } | null;
  chartDays: number;
  // exista topuri si pentru cele 28 de zile dinainte (altfel nu aratam „nou” peste tot)
  hasPrevTop: boolean;
  totals: { clicks: number; impressions: number; position: number | null };
  prevTotals: { clicks: number; impressions: number; position: number | null };
  daily: { date: string; clicks: number; impressions: number }[];
  queries: GscRow[];
  newQueries: GscRow[];
  rising: GscRow[];
  pages: GscRow[];
  opportunities: GscRow[];
};

// Pozitia medie ponderata cu afisarile (asa o calculeaza si Google)
function avgPosition(rows: { impressions: number; position: number }[]): number | null {
  const imp = rows.reduce((s, r) => s + r.impressions, 0);
  return imp > 0 ? rows.reduce((s, r) => s + r.position * r.impressions, 0) / imp : null;
}

export async function getGoogleReport(projectId: string, wantedDays: number | null): Promise<GoogleReport> {
  const [site, top, first] = await Promise.all([
    prisma.gscSite.findUnique({ where: { projectId } }),
    prisma.gscTop.findMany({ where: { projectId } }),
    prisma.gscDaily.findFirst({ where: { projectId }, orderBy: { date: "asc" }, select: { date: true } }),
  ]);
  const lastDate = site?.lastDate?.toISOString().slice(0, 10) ?? null;

  const empty = { clicks: 0, impressions: 0, position: null };
  if (!lastDate) {
    return {
      siteUrl: site?.siteUrl ?? null,
      lastSyncAt: site?.lastSyncAt ?? null,
      lastError: site?.lastError ?? null,
      lastDate,
      period: null,
      chartDays: wantedDays ?? 90,
      hasPrevTop: false,
      totals: empty,
      prevTotals: empty,
      daily: [],
      queries: [],
      newQueries: [],
      rising: [],
      pages: [],
      opportunities: [],
    };
  }

  const start = addDays(lastDate, -27);
  const firstDate = first?.date.toISOString().slice(0, 10) ?? lastDate;
  const chartDays = wantedDays ?? (firstDate >= start ? 28 : 90);
  const chartStart = addDays(lastDate, -(chartDays - 1));
  const from = [chartStart, addDays(start, -28)].sort()[0];
  const days = await prisma.gscDaily.findMany({
    where: { projectId, date: { gte: dayDate(from), lte: dayDate(lastDate) } },
    orderBy: { date: "asc" },
  });
  const byDay = new Map(days.map((d) => [d.date.toISOString().slice(0, 10), d]));
  const inRange = (a: string, b: string) => days.filter((d) => {
    const k = d.date.toISOString().slice(0, 10);
    return k >= a && k <= b;
  });
  const sum = (rows: typeof days) => ({
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    impressions: rows.reduce((s, r) => s + r.impressions, 0),
    position: avgPosition(rows),
  });

  const rows = (kind: string, period: string) =>
    top.filter((t) => t.kind === kind && t.period === period);
  const withPrev = (kind: string): GscRow[] => {
    const prev = new Map(rows(kind, "prev").map((r) => [r.key, r.clicks]));
    return rows(kind, "cur")
      .map((r) => ({ key: r.key, clicks: r.clicks, impressions: r.impressions, position: r.position, prevClicks: prev.get(r.key) ?? null }))
      .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  };
  const queries = withPrev("query");
  const pages = withPrev("page");
  const hasPrev = rows("query", "prev").length > 0;

  return {
    siteUrl: site!.siteUrl,
    lastSyncAt: site!.lastSyncAt,
    lastError: site!.lastError,
    lastDate,
    period: { start, end: lastDate },
    chartDays,
    hasPrevTop: hasPrev,
    totals: sum(inRange(start, lastDate)),
    prevTotals: sum(inRange(addDays(start, -28), addDays(start, -1))),
    daily: eachDay(chartStart, lastDate).map((d) => ({ date: d, clicks: byDay.get(d)?.clicks ?? 0, impressions: byDay.get(d)?.impressions ?? 0 })),
    queries: queries.slice(0, 25),
    // Cautari noi: n-au aparut deloc in cele 28 de zile dinainte (doar daca avem acea perioada)
    newQueries: hasPrev ? queries.filter((q) => q.prevClicks === null && (q.clicks > 0 || q.impressions >= 20)).slice(0, 10) : [],
    // In crestere: cele mai multe clicuri in plus fata de perioada dinainte
    rising: queries
      .filter((q) => q.prevClicks !== null && q.clicks - q.prevClicks >= 2)
      .sort((a, b) => b.clicks - b.prevClicks! - (a.clicks - a.prevClicks!))
      .slice(0, 10),
    pages: pages.slice(0, 20),
    // Aproape de prima pagina (locul 5-20) si cu multe afisari: acolo merita imbunatatita pagina
    opportunities: queries
      .filter((q) => q.position >= 5 && q.position <= 20 && q.impressions >= 30)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 8),
  };
}

// Numeralele in romana: „1 clic”, „12 clicuri”, „20 de clicuri”, „101 clicuri”
export function roCount(n: number, one: string, many: string): string {
  const v = Math.round(n);
  const txt = v.toLocaleString("ro-RO");
  if (v === 1) return `${txt} ${one}`;
  const rest = v % 100;
  return v >= 20 && (rest === 0 || rest >= 20) ? `${txt} de ${many}` : `${txt} ${many}`;
}

// „Ești pe locul 8 la «model contract închiriere»: 1.200 de afișări, puține clicuri”
export function opportunitySentence(q: GscRow): string {
  const pos = Math.round(q.position);
  const ctr = q.impressions > 0 ? q.clicks / q.impressions : 0;
  const clicks = q.clicks === 0 ? "niciun clic" : ctr < 0.02 ? `puține clicuri (${q.clicks})` : roCount(q.clicks, "clic", "clicuri");
  return `Ești pe locul ${pos} la «${q.key}»: ${roCount(q.impressions, "afișare", "afișări")}, ${clicks}`;
}

// Clicurile din Google ale mai multor proiecte, pe zile (pentru raportul zilnic si pagina principala)
export async function gscClicksByProject(projectIds: string[], since: string, until: string) {
  const rows = await prisma.gscDaily.groupBy({
    by: ["projectId"],
    where: { projectId: { in: projectIds }, date: { gte: dayDate(since), lte: dayDate(until) } },
    _sum: { clicks: true },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.projectId, { clicks: r._sum.clicks ?? 0, days: r._count._all }]));
}
