import { prisma } from "@/lib/prisma";
import { dayDate } from "@/lib/dates";

export type SiteRow = { site: string | null; revenue: number; orders: number; visits: number };

// "tablou.net" -> "tablou", la fel ca eticheta pusa de site pe platile Stripe
const siteOfHost = (h: string) => h.split(".")[0];

// Incasari, comenzi si vizite pe fiecare site, pentru proiectele cu mai multe site-uri (ex. grupul print)
export async function getSites(projectIds: string[], since: string, until: string): Promise<SiteRow[]> {
  const where = { projectId: { in: projectIds }, date: { gte: dayDate(since), lte: dayDate(until) } };
  const [tx, visits] = await Promise.all([
    prisma.transaction.groupBy({ by: ["site"], where: { ...where, amount: { gt: 0 } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.trackSession.groupBy({ by: ["host"], where: { ...where, host: { not: null } }, _count: { _all: true } }),
  ]);

  const rows = new Map<string | null, SiteRow>();
  const row = (site: string | null) => {
    if (!rows.has(site)) rows.set(site, { site, revenue: 0, orders: 0, visits: 0 });
    return rows.get(site)!;
  };
  for (const t of tx) {
    const r = row(t.site);
    r.revenue += Number(t._sum.amount ?? 0);
    r.orders += t._count._all;
  }
  for (const v of visits) row(siteOfHost(v.host!)).visits += v._count._all;

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.visits - a.visits);
}
