import type { Provider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayDate, eachDay } from "@/lib/dates";

export type DailyPoint = { date: string; spend: number; revenue: number };

export type CampaignStat = {
  provider: Provider;
  campaignId: string;
  campaignName: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  conversionValue: number;
};

export type Metrics = {
  spend: number;
  revenue: number;
  orders: number;
  roas: number | null; // incasari / cheltuieli
  cpa: number | null; // cheltuieli / comenzi
  profitAfterAds: number;
  daily: DailyPoint[];
  byProvider: { provider: Provider; spend: number }[];
  campaigns: CampaignStat[];
  currencies: string[]; // daca e mai mult de una, sumele nu sunt comparabile direct
};

const num = (v: unknown) => Number(v ?? 0);

export async function getMetrics(projectIds: string[], since: string, until: string): Promise<Metrics> {
  const where = { projectId: { in: projectIds }, date: { gte: dayDate(since), lte: dayDate(until) } };

  const [spendByDay, revenueByDay, orders, byProvider, campaigns, spendCur, revCur] = await Promise.all([
    prisma.adSpendDaily.groupBy({ by: ["date"], where, _sum: { spend: true } }),
    prisma.transaction.groupBy({ by: ["date"], where, _sum: { amount: true } }),
    prisma.transaction.count({ where: { ...where, amount: { gt: 0 } } }),
    prisma.adSpendDaily.groupBy({ by: ["provider"], where, _sum: { spend: true } }),
    prisma.adSpendDaily.groupBy({
      by: ["provider", "campaignId", "campaignName"],
      where,
      _sum: { spend: true, clicks: true, impressions: true, conversions: true, conversionValue: true },
    }),
    prisma.adSpendDaily.findMany({ where, distinct: ["currency"], select: { currency: true } }),
    prisma.transaction.findMany({ where, distinct: ["currency"], select: { currency: true } }),
  ]);

  const spendMap = new Map(spendByDay.map((r) => [r.date.toISOString().slice(0, 10), num(r._sum.spend)]));
  const revMap = new Map(revenueByDay.map((r) => [r.date.toISOString().slice(0, 10), num(r._sum.amount)]));
  const daily = eachDay(since, until).map((date) => ({
    date,
    spend: spendMap.get(date) ?? 0,
    revenue: revMap.get(date) ?? 0,
  }));

  const spend = daily.reduce((s, d) => s + d.spend, 0);
  const revenue = daily.reduce((s, d) => s + d.revenue, 0);

  return {
    spend,
    revenue,
    orders,
    roas: spend > 0 ? revenue / spend : null,
    cpa: spend > 0 && orders > 0 ? spend / orders : null,
    profitAfterAds: revenue - spend,
    daily,
    byProvider: byProvider.map((r) => ({ provider: r.provider, spend: num(r._sum.spend) })),
    campaigns: campaigns
      .map((c) => ({
        provider: c.provider,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        spend: num(c._sum.spend),
        clicks: num(c._sum.clicks),
        impressions: num(c._sum.impressions),
        conversions: num(c._sum.conversions),
        conversionValue: num(c._sum.conversionValue),
      }))
      .sort((a, b) => b.spend - a.spend),
    currencies: [...new Set([...spendCur, ...revCur].map((c) => c.currency))],
  };
}

export function formatMoney(v: number, currency = "RON") {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
}
