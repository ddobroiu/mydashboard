import { prisma } from "@/lib/prisma";
import { addDays, dayDate, eachDay } from "@/lib/dates";

// Microsoft Clarity pe proiect: totalul perioadei alese fata de perioada de aceeasi lungime dinainte.
// Timpul si derularea sunt medii ponderate cu numarul de vizite din fiecare zi.

export type ClarityTotals = {
  days: number;
  sessions: number;
  activeTime: number | null;
  scrollDepth: number | null;
  rageClicks: number;
  deadClicks: number;
  scriptErrors: number;
  // procentul de vizite cu clicuri de nervi / fara efect / erori JS
  ragePct: number | null;
  deadPct: number | null;
  errorPct: number | null;
};

export type ClarityReport = {
  // Project ID-ul din Clarity (pentru linkul spre dashboard)
  clarityId: string | null;
  lastDate: string | null;
  lastError: string | null;
  cur: ClarityTotals | null;
  prev: ClarityTotals | null;
};

type Row = {
  sessions: number;
  activeTime: number | null;
  scrollDepth: number | null;
  rageClicks: number;
  deadClicks: number;
  scriptErrors: number;
  rageSessionsPct: number | null;
  deadSessionsPct: number | null;
  scriptErrorSessionsPct: number | null;
};

function totals(rows: Row[]): ClarityTotals | null {
  if (!rows.length) return null;
  const sessions = rows.reduce((s, r) => s + r.sessions, 0);
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0);
  // Media ponderata cu vizitele; zilele fara valoare nu intra
  const avg = (f: (r: Row) => number | null) => {
    const ok = rows.filter((r) => f(r) !== null && r.sessions > 0);
    const w = ok.reduce((s, r) => s + r.sessions, 0);
    return w > 0 ? ok.reduce((s, r) => s + (f(r) as number) * r.sessions, 0) / w : null;
  };
  return {
    days: rows.length,
    sessions,
    activeTime: avg((r) => r.activeTime),
    scrollDepth: avg((r) => r.scrollDepth),
    rageClicks: sum((r) => r.rageClicks),
    deadClicks: sum((r) => r.deadClicks),
    scriptErrors: sum((r) => r.scriptErrors),
    ragePct: avg((r) => r.rageSessionsPct),
    deadPct: avg((r) => r.deadSessionsPct),
    errorPct: avg((r) => r.scriptErrorSessionsPct),
  };
}

// Randul unei zile se scrie a doua zi dimineata, deci fereastra se termina ieri (7 zile = ultimele 7 zile cu date)
export async function getClarity(projectId: string, rangeSince: string, rangeUntil: string): Promise<ClarityReport | null> {
  const since = addDays(rangeSince, -1);
  const until = addDays(rangeUntil, -1);
  const conn = await prisma.connection.findFirst({
    where: { projectId, provider: "CLARITY", status: { not: "DISABLED" } },
    select: { externalId: true, lastError: true, status: true },
    orderBy: { createdAt: "asc" },
  });
  if (!conn) return null;

  const len = eachDay(since, until).length;
  const prevSince = addDays(since, -len);
  const select = {
    date: true,
    sessions: true,
    activeTime: true,
    scrollDepth: true,
    rageClicks: true,
    deadClicks: true,
    scriptErrors: true,
    rageSessionsPct: true,
    deadSessionsPct: true,
    scriptErrorSessionsPct: true,
  } as const;
  const [rows, last] = await Promise.all([
    prisma.clarityDaily.findMany({ where: { projectId, date: { gte: dayDate(prevSince), lte: dayDate(until) } }, select }),
    prisma.clarityDaily.findFirst({ where: { projectId }, orderBy: { date: "desc" }, select: { date: true } }),
  ]);
  const start = dayDate(since).getTime();
  return {
    clarityId: conn.externalId,
    lastDate: last ? last.date.toISOString().slice(0, 10) : null,
    lastError: conn.status === "ERROR" ? conn.lastError : null,
    cur: totals(rows.filter((r) => r.date.getTime() >= start)),
    prev: totals(rows.filter((r) => r.date.getTime() < start)),
  };
}

// Pentru raportul de dimineata: ziua de ieri si media celor 7 zile dinainte, pe proiect
export async function clarityForReport(projectIds: string[], day: string) {
  const rows = await prisma.clarityDaily.findMany({
    where: { projectId: { in: projectIds }, date: { gte: dayDate(addDays(day, -7)), lte: dayDate(day) } },
    select: { projectId: true, date: true, sessions: true, rageClicks: true, scriptErrors: true },
  });
  const y = dayDate(day).getTime();
  const out = new Map<string, { sessions: number; rageClicks: number; scriptErrors: number; avgRage: number | null; avgErrors: number | null }>();
  for (const pid of projectIds) {
    const mine = rows.filter((r) => r.projectId === pid);
    const today = mine.find((r) => r.date.getTime() === y);
    if (!today) continue;
    const before = mine.filter((r) => r.date.getTime() < y);
    const mean = (f: (r: (typeof mine)[number]) => number) => (before.length ? before.reduce((s, r) => s + f(r), 0) / before.length : null);
    out.set(pid, {
      sessions: today.sessions,
      rageClicks: today.rageClicks,
      scriptErrors: today.scriptErrors,
      avgRage: mean((r) => r.rageClicks),
      avgErrors: mean((r) => r.scriptErrors),
    });
  }
  return out;
}
