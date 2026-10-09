import type { Provider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayDate } from "@/lib/dates";
import { convert, type Rates } from "@/lib/fx";

// Prima pagina, partea „ce s-a intamplat”: ultimele plati, reclamele pe platforme si postarile cele mai vazute.
// Toate sumele in lei.

export type RecentPayment = {
  id: string;
  projectId: string;
  projectName: string;
  at: Date;
  amount: number;
  customer: string | null;
  site: string | null;
  from: string;
};

// De unde a venit plata, din ce a salvat site-ul la comanda (utm / cod de click)
function paymentSource(utmSource: string | null, clickId: string | null): string {
  const s = (utmSource ?? "").toLowerCase();
  if (/google|gads|adwords/.test(s) || (clickId && /^(gclid|gbraid|wbraid)[:=]/i.test(clickId))) return "Google Ads";
  if (/facebook|fb|instagram|ig|meta/.test(s) || (clickId && /^fbclid[:=]/i.test(clickId))) return "Facebook / Instagram";
  if (/tiktok/.test(s)) return "TikTok";
  if (/chatgpt|openai|perplexity|gemini|copilot/.test(s)) return "ChatGPT / AI";
  if (/whatsapp/.test(s)) return "WhatsApp";
  if (/mail|newsletter/.test(s)) return "Email";
  if (s) return utmSource!;
  return "";
}

export async function recentPayments(projects: { id: string; name: string }[], rates: Rates, take = 12): Promise<RecentPayment[]> {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const rows = await prisma.transaction.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, amount: { gt: 0 } },
    orderBy: { occurredAt: "desc" },
    take,
    select: { id: true, projectId: true, occurredAt: true, amount: true, currency: true, customer: true, site: true, utmSource: true, clickId: true },
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: names.get(r.projectId) ?? "",
    at: r.occurredAt,
    amount: convert(rates, Number(r.amount), r.currency, "RON"),
    customer: r.customer,
    site: r.site,
    from: paymentSource(r.utmSource, r.clickId),
  }));
}

export type AdPlatform = { platform: string; spend: number; clicks: number; impressions: number };

const PLATFORM: Partial<Record<Provider, string>> = { GOOGLE_ADS: "Google Ads", META: "Facebook / Instagram", TIKTOK: "TikTok", MANUAL: "Alte reclame" };

export async function adsByPlatform(ids: string[], since: string, until: string, rates: Rates): Promise<AdPlatform[]> {
  const rows = await prisma.adSpendDaily.groupBy({
    by: ["provider", "currency"],
    where: { projectId: { in: ids }, date: { gte: dayDate(since), lte: dayDate(until) } },
    _sum: { spend: true, clicks: true, impressions: true },
  });
  const m = new Map<string, AdPlatform>();
  for (const r of rows) {
    const name = PLATFORM[r.provider] ?? r.provider;
    const a = m.get(name) ?? { platform: name, spend: 0, clicks: 0, impressions: 0 };
    a.spend += convert(rates, Number(r._sum.spend ?? 0), r.currency, "RON");
    a.clicks += Number(r._sum.clicks ?? 0);
    a.impressions += Number(r._sum.impressions ?? 0);
    m.set(name, a);
  }
  return [...m.values()].sort((a, b) => b.spend - a.spend);
}

export type SocialSummary = {
  posts: number;
  views: number;
  interactions: number;
  top: { id: string; projectName: string; platform: string; caption: string | null; url: string | null; views: number }[];
};

export async function socialSummary(projects: { id: string; name: string }[], since: string, until: string): Promise<SocialSummary> {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const where = { projectId: { in: projects.map((p) => p.id) }, status: "published", date: { gte: dayDate(since), lte: dayDate(until) } };
  const [agg, top] = await Promise.all([
    prisma.socialPost.aggregate({ where, _count: { _all: true }, _sum: { views: true, likes: true, comments: true, shares: true, saves: true } }),
    prisma.socialPost.findMany({ where: { ...where, views: { gt: 0 } }, orderBy: { views: "desc" }, take: 3 }),
  ]).catch(() => [null, []] as const);
  const s = agg?._sum;
  return {
    posts: agg?._count._all ?? 0,
    views: s?.views ?? 0,
    interactions: (s?.likes ?? 0) + (s?.comments ?? 0) + (s?.shares ?? 0) + (s?.saves ?? 0),
    top: (top ?? []).map((p) => ({ id: p.id, projectName: names.get(p.projectId) ?? "", platform: p.platform, caption: p.caption, url: p.url, views: p.views ?? 0 })),
  };
}
