import type { Provider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, dayDate } from "@/lib/dates";
import { channelOf, type Channel } from "./sources";

// Cat inapoi cautam vizita care a adus clientul (ca la Google Analytics)
const LOOKBACK_DAYS = 30;
const DAY = 86_400_000;

export type SourceRow = {
  channel: Channel;
  source: string;
  medium: string;
  campaign: string | null;
  sessions: number;
  visitors: number;
  goals: number;
  orders: number;
  revenue: number;
  spend: number;
};

export type ChannelRow = Omit<SourceRow, "source" | "medium" | "campaign" | "visitors"> & { visitors: number };

export type Traffic = {
  sessions: number;
  visitors: number;
  pageviews: number;
  goals: number;
  orders: number;
  revenue: number;
  // Comenzi care nu au putut fi legate de nicio vizita (ex. plata Stripe fara tracking)
  unattributedOrders: number;
  unattributedRevenue: number;
  channels: ChannelRow[];
  sources: SourceRow[];
  landingPages: { path: string; sessions: number; orders: number; revenue: number }[];
  goalsByName: { name: string; count: number }[];
  lastHitAt: Date | null;
};

type Sess = {
  id: string;
  visitorId: string;
  startedAt: Date;
  source: string;
  medium: string;
  campaign: string | null;
  clickType: string | null;
  landingPath: string;
};

const PROVIDER_CHANNEL: Partial<Record<Provider, Channel>> = {
  META: "Meta Ads",
  GOOGLE_ADS: "Google Ads",
  TIKTOK: "TikTok Ads",
};

const rowKey = (s: { source: string; medium: string; campaign: string | null }) =>
  `${s.source}\u0000${s.medium}\u0000${s.campaign ?? ""}`;

// Vizita care primeste meritul pentru o conversie: ultima vizita dintr-o sursa
// (nu „direct”) din ultimele 30 de zile; daca omul a venit mereu direct, ultima vizita.
function credit(sessions: Sess[] | undefined, at: Date): Sess | null {
  if (!sessions?.length) return null;
  const before = sessions.filter((s) => s.startedAt.getTime() <= at.getTime() + 60_000);
  if (!before.length) return null;
  const from = at.getTime() - LOOKBACK_DAYS * DAY;
  const sourced = before.find((s) => s.source !== "(direct)" && s.startedAt.getTime() >= from);
  return sourced ?? before[0];
}

export async function getTraffic(projectIds: string[], since: string, until: string): Promise<Traffic> {
  const where = { projectId: { in: projectIds }, date: { gte: dayDate(since), lte: dayDate(until) } };

  const [sessions, events, payments, spend, last] = await Promise.all([
    prisma.trackSession.findMany({
      where,
      select: { id: true, visitorId: true, startedAt: true, source: true, medium: true, campaign: true, clickType: true, landingPath: true, pageviews: true },
    }),
    prisma.trackEvent.findMany({
      where: { ...where, type: { in: ["goal", "purchase"] } },
      select: { type: true, name: true, visitorId: true, sessionId: true, value: true, at: true },
    }),
    prisma.transaction.findMany({
      where: { ...where, amount: { gt: 0 } },
      select: { visitorId: true, amount: true, occurredAt: true },
    }),
    prisma.adSpendDaily.groupBy({ by: ["provider", "campaignName"], where, _sum: { spend: true } }),
    prisma.trackSession.findFirst({ where: { projectId: { in: projectIds } }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
  ]);

  // Comenzile: cele trimise de site (purchase) + platile Stripe legate de un vizitator.
  // O plata Stripe a unui vizitator care are deja o comanda in aceeasi zi nu se numara de doua ori.
  type Order = { visitorId: string | null; at: Date; value: number };
  const orders: Order[] = events
    .filter((e) => e.type === "purchase")
    .map((e) => ({ visitorId: e.visitorId, at: e.at, value: Number(e.value ?? 0) }));
  for (const p of payments) {
    if (!p.visitorId) continue;
    const dup = orders.some((o) => o.visitorId === p.visitorId && Math.abs(o.at.getTime() - p.occurredAt.getTime()) < DAY);
    if (!dup) orders.push({ visitorId: p.visitorId, at: p.occurredAt, value: Number(p.amount) });
  }
  const goals = events.filter((e) => e.type === "goal");

  // Vizitele (si cele de dinainte de perioada) ale celor care au convertit
  const converters = [...new Set([...orders, ...goals].map((o) => o.visitorId).filter((v): v is string => !!v))];
  const history = converters.length
    ? await prisma.trackSession.findMany({
        where: {
          projectId: { in: projectIds },
          visitorId: { in: converters },
          date: { gte: dayDate(addDays(since, -LOOKBACK_DAYS)), lte: dayDate(until) },
        },
        select: { id: true, visitorId: true, startedAt: true, source: true, medium: true, campaign: true, clickType: true, landingPath: true },
        orderBy: { startedAt: "desc" },
      })
    : [];
  const byVisitor = new Map<string, Sess[]>();
  for (const s of history) byVisitor.set(s.visitorId, [...(byVisitor.get(s.visitorId) ?? []), s]);

  const rows = new Map<string, SourceRow & { vset: Set<string> }>();
  const row = (s: Sess) => {
    const k = rowKey(s);
    let r = rows.get(k);
    if (!r) {
      r = {
        channel: channelOf(s.source, s.medium, s.clickType),
        source: s.source,
        medium: s.medium,
        campaign: s.campaign,
        sessions: 0,
        visitors: 0,
        goals: 0,
        orders: 0,
        revenue: 0,
        spend: 0,
        vset: new Set(),
      };
      rows.set(k, r);
    }
    return r;
  };
  const pages = new Map<string, { path: string; sessions: number; orders: number; revenue: number }>();
  const page = (path: string) => {
    const p = path.split("?")[0] || "/";
    const r = pages.get(p) ?? { path: p, sessions: 0, orders: 0, revenue: 0 };
    pages.set(p, r);
    return r;
  };

  for (const s of sessions) {
    const r = row(s);
    r.sessions += 1;
    r.vset.add(s.visitorId);
    page(s.landingPath).sessions += 1;
  }

  let unattributedOrders = 0;
  let unattributedRevenue = 0;
  for (const o of orders) {
    const s = o.visitorId ? credit(byVisitor.get(o.visitorId), o.at) : null;
    if (!s) {
      unattributedOrders += 1;
      unattributedRevenue += o.value;
      continue;
    }
    const r = row(s);
    r.orders += 1;
    r.revenue += o.value;
    const pg = page(s.landingPath);
    pg.orders += 1;
    pg.revenue += o.value;
  }
  const goalNames = new Map<string, number>();
  for (const g of goals) {
    goalNames.set(g.name ?? "Obiectiv", (goalNames.get(g.name ?? "Obiectiv") ?? 0) + 1);
    const s = g.visitorId ? credit(byVisitor.get(g.visitorId), g.at) : null;
    if (s) row(s).goals += 1;
  }

  // Cheltuielile: pe canal dupa platforma; pe campanie cand utm_campaign are
  // acelasi nume ca in platforma (ex. {{campaign.name}} in Meta) sau ca cheltuiala manuala.
  const channelSpend = new Map<Channel, number>();
  const all = [...rows.values()];
  for (const sp of spend) {
    const amount = Number(sp._sum.spend ?? 0);
    const name = sp.campaignName.trim().toLowerCase();
    const matches = all.filter((r) => r.campaign?.trim().toLowerCase() === name);
    let channel = PROVIDER_CHANNEL[sp.provider];
    if (matches.length) {
      // Daca mai multe surse au aceeasi campanie, cheltuiala merge la cea cu cele mai multe vizite
      const target = matches.sort((a, b) => b.sessions - a.sessions)[0];
      target.spend += amount;
      channel ??= target.channel;
    } else if (sp.provider === "MANUAL") {
      const r = row({ id: "", visitorId: "", startedAt: new Date(), source: "(manual)", medium: "cheltuială", campaign: sp.campaignName, clickType: null, landingPath: "/" });
      r.channel = "Alte reclame";
      r.spend += amount;
      channel = "Alte reclame";
    }
    channel ??= "Alte reclame";
    channelSpend.set(channel, (channelSpend.get(channel) ?? 0) + amount);
  }

  const sources: SourceRow[] = [...rows.values()].map(({ vset, ...r }) => ({ ...r, visitors: vset.size }));

  const channels = new Map<Channel, ChannelRow & { vset: Set<string> }>();
  for (const r of rows.values()) {
    const c = channels.get(r.channel) ?? { channel: r.channel, sessions: 0, visitors: 0, goals: 0, orders: 0, revenue: 0, spend: 0, vset: new Set<string>() };
    c.sessions += r.sessions;
    c.goals += r.goals;
    c.orders += r.orders;
    c.revenue += r.revenue;
    for (const v of r.vset) c.vset.add(v);
    channels.set(r.channel, c);
  }
  for (const [ch, amount] of channelSpend) {
    const c = channels.get(ch) ?? { channel: ch, sessions: 0, visitors: 0, goals: 0, orders: 0, revenue: 0, spend: 0, vset: new Set<string>() };
    c.spend = amount;
    channels.set(ch, c);
  }

  return {
    sessions: sessions.length,
    visitors: new Set(sessions.map((s) => s.visitorId)).size,
    pageviews: sessions.reduce((n, s) => n + s.pageviews, 0),
    goals: goals.length,
    orders: orders.length,
    revenue: orders.reduce((n, o) => n + o.value, 0),
    unattributedOrders,
    unattributedRevenue,
    channels: [...channels.values()]
      .map(({ vset, ...c }) => ({ ...c, visitors: vset.size }))
      .sort((a, b) => b.revenue - a.revenue || b.spend - a.spend || b.sessions - a.sessions),
    sources: sources.sort((a, b) => b.revenue - a.revenue || b.sessions - a.sessions).slice(0, 50),
    landingPages: [...pages.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 15),
    goalsByName: [...goalNames].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    lastHitAt: last?.lastSeenAt ?? null,
  };
}
