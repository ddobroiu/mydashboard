import type { Provider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import { convert, getRates } from "@/lib/fx";
import { moneyForRange } from "@/lib/money";
import { getGa4, ga4Property } from "@/lib/ga4";
import { getAppStats, type AppStats } from "@/lib/app-stats";
import { NOT_LOCAL_ALERT, explainAlert, scrubSecrets } from "@/lib/alert-explain";
import { plainConnectionError, plainProvider } from "@/lib/plain-errors";
import { matchProject } from "@/lib/ai-usage";
import { elevenLabsProject, getVoiceStatus, type VoiceStatus } from "@/lib/elevenlabs";
import { socialWeek } from "@/lib/social-posts";

// Prima pagina si „Pe scurt” din pagina proiectului: pentru fiecare afacere, cifrele care conteaza
// (incasari, comenzi, vizitatori, reclame, profit) pe azi / 7 / 30 de zile, plus o stare in cuvinte simple.
// Doar cifre reale: ce nu avem ramane null, cu motivul scurt in `notes`.

export type WindowKey = "azi" | "d7" | "p7" | "d30" | "p30";
export type Figures = {
  revenue: number | null; // in lei
  orders: number | null;
  ads: number | null; // in lei
  ai: number; // in lei
  profit: number | null; // in lei: incasari − reclame − AI
  visitors: number | null;
  sessions: number | null;
};
export type Tone = "good" | "warn" | "bad";
export type Issue = { tone: Tone; text: string; action?: string; technical?: string };
export type BusinessOverview = {
  id: string;
  name: string;
  domain: string | null;
  currency: string;
  // lei → moneda proiectului
  rate: number;
  w: Record<WindowKey, Figures>;
  notes: { revenue?: string; visitors?: string; ads?: string; trend?: string };
  sources: { revenue: "plati" | "aplicatie" | null; visitors: "ga4" | "masurare" | null };
  lastSaleAt: Date | null;
  status: Issue;
  issues: Issue[];
  // doar la PostingClips: vocea ElevenLabs (consum de caractere + abonament)
  voice?: VoiceStatus;
  // Postarile de pe retelele sociale din ultimele 7 zile (PostingClips + postarile automate FB/IG)
  social: { posts: number; views: number };
  // Conturi noi din aplicatie (/api/mydashboard/stats), null = aplicatia nu le raporteaza
  signups: { azi: number | null; d7: number | null; d30: number | null; total: number | null } | null;
  // Ce sursa de date e legata: ok = primim date, error = legata dar da eroare, missing = nelegata
  links: Record<LinkKey, LinkState>;
};

export type LinkKey = "plati" | "conturi" | "googleAds" | "metaAds" | "vizitatori" | "postari";
export type LinkState = { state: "ok" | "error" | "missing"; note?: string };

const REVENUE: Provider[] = ["STRIPE", "ORDERS_DB", "OBLIO"];
const ADS: Provider[] = ["META", "GOOGLE_ADS", "TIKTOK", "MANUAL"];

type P = {
  id: string;
  name: string;
  domain: string | null;
  currency: string;
  organizationId: string;
  trackingId: string | null;
  connections: { id: string; provider: Provider; status: string; lastError: string | null }[];
};

export function windows(today = dayKey(new Date())): Record<WindowKey, { since: string; until: string }> {
  return {
    azi: { since: today, until: today },
    d7: { since: addDays(today, -6), until: today },
    p7: { since: addDays(today, -13), until: addDays(today, -7) },
    d30: { since: addDays(today, -29), until: today },
    p30: { since: addDays(today, -59), until: addDays(today, -30) },
  };
}

async function uniqueVisitors(ids: string[], since: string, until: string) {
  const rows = await prisma.trackSession.groupBy({
    by: ["projectId", "visitorId"],
    where: { projectId: { in: ids }, date: { gte: dayDate(since), lte: dayDate(until) } },
  });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1);
  return m;
}

// Din statisticile aplicatiei (/api/mydashboard/stats): incasari si comenzi, cand proiectul nu are plati legate
function appFigures(s: AppStats) {
  const money = s.kpi.find((k) => k.key === "venit") ?? s.kpi.find((k) => k.unit === "money");
  const orders = s.kpi.find((k) => k.key === "comenzi") ?? s.kpi.find((k) => k.unit === "count" && /comenz|plăți|vânz/i.test(k.label));
  return { money, orders, currency: s.currency ?? "RON" };
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const RANK: Record<Tone, number> = { bad: 0, warn: 1, good: 2 };

function daysAgo(d: Date) {
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

export function ago(d: Date) {
  const min = Math.round((Date.now() - d.getTime()) / 60_000);
  if (min < 60) return min <= 1 ? "acum un minut" : `acum ${min} minute`;
  const h = Math.round(min / 60);
  if (h < 24) return h === 1 ? "acum o oră" : `acum ${h} ore`;
  const z = Math.round(h / 24);
  return z === 1 ? "ieri" : `acum ${z} zile`;
}

export async function getOverview(projects: P[]): Promise<BusinessOverview[]> {
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const W = windows();
  const keys = Object.keys(W) as WindowKey[];
  const rates = await getRates();

  const [lines, visitors, lastSales, tracked, adRows, alerts, social] = await Promise.all([
    Promise.all(keys.map((k) => moneyForRange(projects, W[k].since, W[k].until, rates))),
    Promise.all(keys.map((k) => uniqueVisitors(ids, W[k].since, W[k].until))),
    prisma.transaction.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, amount: { gt: 0 } }, _max: { occurredAt: true } }),
    prisma.trackSession.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, date: { gte: dayDate(W.p30.since) } }, _count: { _all: true } }),
    prisma.adSpendDaily.groupBy({ by: ["projectId", "provider"], where: { projectId: { in: ids }, date: { gte: dayDate(W.p30.since) } }, _sum: { spend: true } }),
    prisma.alertState.findMany({
      where: { active: true, ...NOT_LOCAL_ALERT },
      select: { kind: true, project: true, message: true, explanation: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    }),
    socialWeek(ids),
  ]);
  const lastSale = new Map(lastSales.map((r) => [r.projectId, r._max.occurredAt]));
  const hasTracker = new Set(tracked.filter((r) => r._count._all > 0).map((r) => r.projectId));

  // GA4 si statisticile aplicatiilor: in paralel, fiecare cu cache si limita de timp
  const ga4Ranges = Object.fromEntries(keys.map((k) => [k, W[k]]));
  const voiceFor = matchProject(elevenLabsProject(), projects)?.id ?? null;
  const [ga4, appStats, voice] = await Promise.all([
    Promise.all(projects.map((p) => (ga4Property(p.name) ? getGa4(p.name, ga4Ranges) : Promise.resolve(null)))),
    Promise.all(
      projects.map((p) =>
        !p.domain ? Promise.resolve(null) : getAppStats(p.name, p.domain).catch(() => null),
      ),
    ),
    voiceFor ? getVoiceStatus() : Promise.resolve(undefined),
  ]);

  return projects.map((p, i) => {
    const hasRevenue = p.connections.some((c) => REVENUE.includes(c.provider));
    const hasAds = p.connections.some((c) => ADS.includes(c.provider) && c.provider !== "MANUAL");
    const g = ga4[i];
    const appRes = appStats[i];
    const app = appRes?.ok && !hasRevenue ? appFigures(appRes.stats) : null;
    const usersKpi = appRes?.ok ? appRes.stats.kpi.find((k) => k.key === "users") ?? appRes.stats.kpi.find((k) => /conturi noi|utilizatori noi|înscrieri/i.test(k.label)) : undefined;
    const signups = usersKpi ? { azi: usersKpi.today ?? usersKpi.h24 ?? null, d7: usersKpi.d7 ?? null, d30: usersKpi.d30 ?? null, total: usersKpi.total ?? null } : null;
    const notes: BusinessOverview["notes"] = {};
    const sources: BusinessOverview["sources"] = { revenue: null, visitors: null };

    if (hasRevenue) sources.revenue = "plati";
    else if (app?.money) {
      sources.revenue = "aplicatie";
      notes.trend = "din aplicație, fără comparație cu perioada trecută";
    } else notes.revenue = "lipsește legătura cu plățile (Stripe)";

    if (g?.ok) sources.visitors = "ga4";
    else if (hasTracker.has(p.id)) sources.visitors = "masurare";
    else notes.visitors = g && !g.ok ? g.reason : "site-ul nu are codul de măsurare";

    const w = {} as Record<WindowKey, Figures>;
    keys.forEach((k, j) => {
      const l = lines[j].get(p.id)!;
      let revenue: number | null = null;
      let orders: number | null = null;
      if (sources.revenue === "plati") {
        revenue = l.revenue;
        orders = l.orders;
      } else if (sources.revenue === "aplicatie" && app) {
        const field = k === "azi" ? "today" : k === "d7" ? "d7" : k === "d30" ? "d30" : null;
        const v = field ? app.money?.[field] : null;
        const o = field ? app.orders?.[field] : null;
        revenue = v == null ? null : convert(rates, v, app.currency, "RON");
        orders = o ?? null;
      }
      const ads = hasAds || l.ads > 0 ? l.ads : null;
      const vis = sources.visitors === "ga4" && g?.ok ? g.values[k]?.users ?? null : sources.visitors === "masurare" ? visitors[j].get(p.id) ?? 0 : null;
      const ses = g?.ok ? g.values[k]?.sessions ?? null : null;
      w[k] = { revenue, orders, ads, ai: l.ai, profit: revenue == null ? null : revenue - (ads ?? 0) - l.ai, visitors: vis, sessions: ses };
    });
    if (!hasAds && !(w.d30.ads ?? 0)) notes.ads = "lipsește legătura cu reclamele";

    // Starea, de la cea mai grava la cea mai linistita
    const issues: Issue[] = [];
    const name = p.name.toLowerCase();
    const domain = p.domain?.toLowerCase().replace(/^www\./, "") ?? null;
    const mine = alerts.filter((a) => {
      const k = (a.project ?? "").toLowerCase().replace(/^www\./, "");
      return k === name || (domain && k === domain);
    });
    const down = mine.find((a) => a.kind === "down");
    if (down) {
      issues.push({
        tone: "bad",
        text: "Site-ul nu răspunde",
        action: "Deschide site-ul să verifici. Dacă nu revine în 10–15 minute, spune-i programatorului.",
        technical: scrubSecrets(down.message).slice(0, 500),
      });
    }
    const explained = mine.filter((a) => a !== down).map((a) => ({ a, e: explainAlert(a) }));
    for (const { a, e } of explained.filter((x) => x.e.severity === "Urgent")) {
      issues.push({ tone: "bad", text: capitalize(e.title), action: e.action, technical: scrubSecrets(a.message).slice(0, 500) });
    }
    for (const c of p.connections.filter((c) => c.status === "ERROR" && (REVENUE.includes(c.provider) || ADS.includes(c.provider)))) {
      const pe = plainConnectionError(c.provider, c.lastError);
      issues.push({ tone: "warn", text: `Nu mai primim cifrele de la ${plainProvider(c.provider)}`, action: `${pe.what} ${pe.action}`, technical: scrubSecrets(c.lastError ?? "").slice(0, 500) });
    }
    const ls = lastSale.get(p.id) ?? null;
    if (sources.revenue === "plati" && ls && daysAgo(ls) >= 3 && daysAgo(ls) <= 60) {
      issues.push({ tone: "warn", text: `Nicio vânzare de ${daysAgo(ls)} zile`, action: "Verifică dacă plata merge pe site și dacă reclamele rulează." });
    }
    const minor = explained.filter((x) => x.e.severity !== "Urgent");
    if (minor.length) {
      issues.push({
        tone: "warn",
        text: minor.length === 1 ? capitalize(minor[0].e.title) : `${minor.length} probleme de verificat pe site`,
        action: minor.length === 1 ? minor[0].e.action : "Le găsești explicate în pagina Alerte.",
        technical: minor.map((x) => scrubSecrets(x.a.message).slice(0, 300)).join("\n\n"),
      });
    }
    issues.sort((a, b) => RANK[a.tone] - RANK[b.tone]);
    const good: Issue = {
      tone: "good",
      text: "Merge bine",
      action: ls ? `Ultima vânzare: ${ago(ls)}.` : sources.revenue ? "Încă nicio vânzare înregistrată." : undefined,
    };

    const conn = (prov: Provider) => p.connections.find((c) => c.provider === prov);
    const spent = (prov: Provider) => adRows.some((r) => r.projectId === p.id && r.provider === prov && Number(r._sum.spend ?? 0) > 0);
    const linkOf = (prov: Provider): LinkState => {
      const c = conn(prov);
      if (spent(prov)) return { state: "ok" };
      if (c?.status === "ERROR") return { state: "error", note: plainConnectionError(prov, c.lastError).what };
      return c ? { state: "ok", note: "legat, fără cheltuieli în 30 de zile" } : { state: "missing" };
    };
    const revConn = p.connections.filter((c) => REVENUE.includes(c.provider));
    const soc = social.get(p.id);
    const links: Record<LinkKey, LinkState> = {
      plati: revConn.some((c) => c.status === "ERROR") ? { state: "error", note: "o conexiune de plăți dă eroare" } : revConn.length || app?.money ? { state: "ok" } : { state: "missing" },
      conturi: signups ? { state: "ok" } : appRes && !appRes.ok && appRes.reason === "error" ? { state: "error", note: "aplicația dă eroare la statistici" } : { state: "missing" },
      googleAds: linkOf("GOOGLE_ADS"),
      metaAds: linkOf("META"),
      vizitatori: sources.visitors ? { state: "ok" } : { state: "missing", note: notes.visitors },
      postari: soc && soc.posts > 0 ? { state: "ok" } : p.connections.some((c) => c.provider === "POSTINGCLIPS" || c.provider === "SOCIAL_AUTOPOST") ? { state: "ok", note: "legat, nicio postare în 7 zile" } : { state: "missing" },
    };

    return {
      id: p.id,
      signups,
      links,
      name: p.name,
      domain: p.domain,
      currency: p.currency,
      rate: convert(rates, 1, "RON", p.currency),
      w,
      notes,
      sources,
      lastSaleAt: ls,
      status: issues[0] ?? good,
      issues,
      social: social.get(p.id) ?? { posts: 0, views: 0 },
      ...(p.id === voiceFor && voice ? { voice } : {}),
    };
  });
}

// Totalul tuturor afacerilor, in lei
export function totals(list: BusinessOverview[], k: WindowKey) {
  const sum = (f: (x: Figures) => number | null) => list.reduce((s, b) => s + (f(b.w[k]) ?? 0), 0);
  return {
    revenue: sum((x) => x.revenue),
    orders: sum((x) => x.orders),
    ads: sum((x) => x.ads),
    ai: sum((x) => x.ai),
    profit: sum((x) => x.profit),
    visitors: sum((x) => x.visitors),
  };
}
