import { prisma } from "@/lib/prisma";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import { convert, getRates, type Rates } from "@/lib/fx";
import { apiAiUsdByProject } from "@/lib/ai-api-costs";
import { reportedUsdByProject } from "@/lib/ai-usage";
import { addAmount, negAmounts, scaleAmounts, sumAmounts, type Amounts } from "@/lib/metrics";

// Banii pe proiect: vanzari (Stripe si celelalte incasari, minus rambursari) minus costuri
// (comision Stripe, AI, reclame, costuri fixe). Totul se calculeaza in lei si se arata in moneda proiectului;
// in paralel, fiecare suma e tinuta si in moneda ei (by), pentru totalurile care amesteca monede.

export type MoneyView = "luna" | "luna-trecuta";
export const parseMoneyView = (v: string | undefined): MoneyView => (v === "luna-trecuta" ? "luna-trecuta" : "luna");

export type Period = { since: string; until: string; label: string; fixedShare: number };

const daysInMonth = (key: string) => {
  const d = dayDate(key);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
};
const monthStart = (key: string) => `${key.slice(0, 8)}01`;
const monthEnd = (key: string) => `${key.slice(0, 8)}${String(daysInMonth(key)).padStart(2, "0")}`;
const monthName = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("ro-RO", { month: "long", timeZone: "UTC" });

// Luna asta pana azi, comparata cu aceleasi zile din luna trecuta (ca sa fie corect);
// sau luna trecuta intreaga, comparata cu cea dinainte.
export function moneyPeriods(view: MoneyView, today = dayKey(new Date())): { cur: Period; prev: Period } {
  const full = (key: string): Period => ({ since: monthStart(key), until: monthEnd(key), label: monthName(key), fixedShare: 1 });
  const lastMonth = addDays(monthStart(today), -1);
  if (view === "luna-trecuta") return { cur: full(lastMonth), prev: full(addDays(monthStart(lastMonth), -1)) };
  const day = Number(today.slice(8, 10));
  const prevDays = Math.min(day, daysInMonth(lastMonth));
  return {
    cur: { since: monthStart(today), until: today, label: `${monthName(today)} (1–${day})`, fixedShare: day / daysInMonth(today) },
    prev: {
      since: monthStart(lastMonth),
      until: `${lastMonth.slice(0, 8)}${String(prevDays).padStart(2, "0")}`,
      label: `${monthName(lastMonth)} (1–${prevDays})`,
      fixedShare: prevDays / daysInMonth(lastMonth),
    },
  };
}

export type MoneyLine = {
  revenue: number;
  orders: number;
  stripeFees: number;
  // o parte din comisioane e estimata (plati fara comision citit din Stripe)
  feesEstimated: boolean;
  ai: number;
  ads: number;
  fixed: number;
  costs: number;
  profit: number;
  // aceleasi sume in moneda lor, neconvertite (vanzari in EUR raman EUR, reclame in RON raman RON, AI in USD)
  by: Record<MoneyKey, Amounts>;
};

export type MoneyKey = "revenue" | "stripeFees" | "ai" | "ads" | "fixed" | "costs" | "profit";

export type FixedCostItem = { id: string; name: string; monthly: number; currency: string; toVerify: boolean; shared: boolean; share: number };

export type ProjectMoney = {
  id: string;
  name: string;
  currency: string;
  // in lei (pentru totaluri si sortare)
  curRon: MoneyLine;
  prevRon: MoneyLine;
  // in moneda proiectului
  cur: MoneyLine;
  prev: MoneyLine;
  fixedItems: FixedCostItem[];
  fixedToVerify: boolean;
};

// Comisionul Stripe standard pentru carduri din UE: 1,5% + 0,25 EUR
const FEE_PCT = 0.015;
const FEE_FIXED_EUR = 0.25;

const emptyBy = (): Record<MoneyKey, Amounts> => ({ revenue: {}, stripeFees: {}, ai: {}, ads: {}, fixed: {}, costs: {}, profit: {} });
const emptyLine = (): MoneyLine => ({ revenue: 0, orders: 0, stripeFees: 0, feesEstimated: false, ai: 0, ads: 0, fixed: 0, costs: 0, profit: 0, by: emptyBy() });

const scale = (l: MoneyLine, f: number): MoneyLine => ({
  ...l,
  revenue: l.revenue * f,
  stripeFees: l.stripeFees * f,
  ai: l.ai * f,
  ads: l.ads * f,
  fixed: l.fixed * f,
  costs: l.costs * f,
  profit: l.profit * f,
});

type P = { id: string; name: string; currency: string; organizationId: string };

async function linesFor(projects: P[], period: Period, rates: Rates, fixedMonthlyRon: Map<string, number>, fixedMonthlyBy: Map<string, Amounts>) {
  const ids = projects.map((p) => p.id);
  const where = { projectId: { in: ids }, date: { gte: dayDate(period.since), lte: dayDate(period.until) } };
  const [tx, noFee, ai, ads, apiAi, reportedAi] = await Promise.all([
    prisma.transaction.groupBy({ by: ["projectId", "currency"], where, _sum: { amount: true, fee: true } }),
    prisma.transaction.groupBy({
      by: ["projectId", "currency"],
      where: { ...where, provider: "STRIPE", fee: null, amount: { gt: 0 } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.aiUsageDaily.groupBy({ by: ["projectId"], where, _sum: { costUsd: true } }),
    prisma.adSpendDaily.groupBy({ by: ["projectId", "currency"], where, _sum: { spend: true } }),
    // Anthropic / OpenAI, prin workspace-urile / proiectele legate de fiecare proiect
    apiAiUsdByProject(ids, period.since, period.until),
    // Consumul raportat de aplicatii, doar pentru furnizorii fara cost facturat la acel proiect (fara dublare)
    reportedUsdByProject(ids, period.since, period.until),
  ]);
  const orders = await prisma.transaction.groupBy({ by: ["projectId"], where: { ...where, amount: { gt: 0 } }, _count: { _all: true } });

  const lines = new Map(ids.map((id) => [id, emptyLine()]));
  const ron = (v: unknown, cur: string) => convert(rates, Number(v ?? 0), cur, "RON");
  for (const r of tx) {
    const l = lines.get(r.projectId)!;
    l.revenue += ron(r._sum.amount, r.currency);
    l.stripeFees += ron(r._sum.fee, r.currency);
    addAmount(l.by.revenue, r.currency, Number(r._sum.amount ?? 0));
    addAmount(l.by.stripeFees, r.currency, Number(r._sum.fee ?? 0));
  }
  for (const r of noFee) {
    const l = lines.get(r.projectId)!;
    l.stripeFees += ron(Number(r._sum.amount ?? 0) * FEE_PCT, r.currency) + convert(rates, FEE_FIXED_EUR * r._count._all, "EUR", "RON");
    l.feesEstimated = true;
    addAmount(l.by.stripeFees, r.currency, Number(r._sum.amount ?? 0) * FEE_PCT);
    addAmount(l.by.stripeFees, "EUR", FEE_FIXED_EUR * r._count._all);
  }
  for (const r of orders) lines.get(r.projectId)!.orders = r._count._all;
  const addAi = (pid: string, usd: unknown) => {
    const l = lines.get(pid)!;
    l.ai += ron(usd, "USD");
    addAmount(l.by.ai, "USD", Number(usd ?? 0));
  };
  for (const r of ai) addAi(r.projectId, r._sum.costUsd);
  for (const [pid, usd] of apiAi) addAi(pid, usd);
  for (const [pid, usd] of reportedAi) addAi(pid, usd);
  for (const r of ads) {
    const l = lines.get(r.projectId)!;
    l.ads += ron(r._sum.spend, r.currency);
    addAmount(l.by.ads, r.currency, Number(r._sum.spend ?? 0));
  }
  for (const [id, l] of lines) {
    l.fixed = (fixedMonthlyRon.get(id) ?? 0) * period.fixedShare;
    l.costs = l.stripeFees + l.ai + l.ads + l.fixed;
    l.profit = l.revenue - l.costs;
    l.by.fixed = scaleAmounts(fixedMonthlyBy.get(id) ?? {}, period.fixedShare);
    l.by.costs = sumAmounts(l.by.stripeFees, l.by.ai, l.by.ads, l.by.fixed);
    l.by.profit = sumAmounts(l.by.revenue, negAmounts(l.by.costs));
  }
  return lines;
}

export async function getMoney(projects: P[], view: MoneyView) {
  const { cur, prev } = moneyPeriods(view);
  const rates = await getRates();
  const orgIds = [...new Set(projects.map((p) => p.organizationId))];
  const [fixed, orgProjects] = await Promise.all([
    prisma.fixedCost.findMany({ where: { organizationId: { in: orgIds } }, orderBy: [{ createdAt: "asc" }] }),
    prisma.project.groupBy({ by: ["organizationId"], where: { organizationId: { in: orgIds } }, _count: { _all: true } }),
  ]);
  const perOrg = new Map(orgProjects.map((o) => [o.organizationId, o._count._all]));

  // Costurile fixe lunare ale fiecarui proiect: ale lui + partea egala din cele comune
  const items = new Map<string, FixedCostItem[]>();
  const monthlyRon = new Map<string, number>();
  const monthlyBy = new Map<string, Amounts>();
  for (const p of projects) {
    const n = perOrg.get(p.organizationId) ?? 1;
    const list = fixed
      .filter((f) => f.organizationId === p.organizationId && (f.projectId === null || f.projectId === p.id))
      .map((f) => ({
        id: f.id,
        name: f.name,
        monthly: Number(f.monthly),
        currency: f.currency,
        toVerify: f.toVerify,
        shared: f.projectId === null,
        share: f.projectId === null ? Number(f.monthly) / n : Number(f.monthly),
      }));
    items.set(p.id, list);
    monthlyRon.set(p.id, list.reduce((s, f) => s + convert(rates, f.share, f.currency, "RON"), 0));
    monthlyBy.set(p.id, list.reduce((a, f) => addAmount(a, f.currency, f.share), {} as Amounts));
  }

  const [curL, prevL] = await Promise.all([linesFor(projects, cur, rates, monthlyRon, monthlyBy), linesFor(projects, prev, rates, monthlyRon, monthlyBy)]);
  const rows: ProjectMoney[] = projects.map((p) => {
    const f = convert(rates, 1, "RON", p.currency);
    const c = curL.get(p.id)!;
    const pr = prevL.get(p.id)!;
    const fi = items.get(p.id) ?? [];
    return { id: p.id, name: p.name, currency: p.currency, curRon: c, prevRon: pr, cur: scale(c, f), prev: scale(pr, f), fixedItems: fi, fixedToVerify: fi.some((x) => x.toVerify) };
  });

  const sum = (key: "curRon" | "prevRon"): MoneyLine => {
    const t = emptyLine();
    for (const r of rows) {
      const l = r[key];
      t.revenue += l.revenue;
      t.orders += l.orders;
      t.stripeFees += l.stripeFees;
      t.feesEstimated ||= l.feesEstimated;
      t.ai += l.ai;
      t.ads += l.ads;
      t.fixed += l.fixed;
      t.costs += l.costs;
      t.profit += l.profit;
      for (const k of Object.keys(t.by) as MoneyKey[]) t.by[k] = sumAmounts(t.by[k], l.by[k]);
    }
    return t;
  };

  return { cur, prev, rows, total: sum("curRon"), prevTotal: sum("prevRon"), ratesLive: rates.live, eur: rates.rates.EUR };
}

export type Money = Awaited<ReturnType<typeof getMoney>>;
