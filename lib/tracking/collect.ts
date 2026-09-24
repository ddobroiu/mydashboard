import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dayDate, dayKey } from "@/lib/dates";
import { attribute, deviceOf } from "./sources";

export type Hit = {
  site: string;
  vid: string;
  sid: string;
  url: string;
  t: "pageview" | "purchase" | "event";
  ns?: number;
  ref?: string;
  name?: string;
  value?: number;
  currency?: string;
  order?: string;
};

const ID = /^[a-f0-9]{32}$/;

export function parseHit(raw: unknown): Hit | null {
  if (!raw || typeof raw !== "object") return null;
  const h = raw as Record<string, unknown>;
  if (typeof h.site !== "string" || typeof h.url !== "string") return null;
  if (typeof h.vid !== "string" || !ID.test(h.vid) || typeof h.sid !== "string" || !ID.test(h.sid)) return null;
  if (h.t !== "pageview" && h.t !== "purchase" && h.t !== "event") return null;
  if (!/^https?:\/\//.test(h.url) || h.url.length > 2000) return null;
  return {
    site: h.site.slice(0, 40),
    vid: h.vid,
    sid: h.sid,
    url: h.url,
    t: h.t,
    ns: h.ns === 1 ? 1 : 0,
    ref: typeof h.ref === "string" ? h.ref.slice(0, 1000) : "",
    name: typeof h.name === "string" ? h.name.slice(0, 80) : undefined,
    value: typeof h.value === "number" && Number.isFinite(h.value) && h.value > 0 && h.value < 1e9 ? h.value : undefined,
    currency: typeof h.currency === "string" && /^[A-Za-z]{3}$/.test(h.currency) ? h.currency.toUpperCase() : undefined,
    order: typeof h.order === "string" && h.order ? h.order.slice(0, 120) : undefined,
  };
}

// trackingId -> proiect + obiective, tinute putin in memorie ca sa nu lovim baza la fiecare pagina
type SiteInfo = { projectId: string; goals: { id: string; pattern: string; name: string; value: Prisma.Decimal | null }[] };
const cache = new Map<string, { at: number; info: SiteInfo | null }>();
const TTL = 60_000;

export function forgetSite(trackingId: string | null) {
  if (trackingId) cache.delete(trackingId);
}

async function site(trackingId: string): Promise<SiteInfo | null> {
  const hit = cache.get(trackingId);
  if (hit && Date.now() - hit.at < TTL) return hit.info;
  const project = await prisma.project.findUnique({
    where: { trackingId },
    select: { id: true, goals: { select: { id: true, pattern: true, name: true, value: true } } },
  });
  const info = project ? { projectId: project.id, goals: project.goals } : null;
  cache.set(trackingId, { at: Date.now(), info });
  return info;
}

// Acelasi cod de tracking poate fi pe mai multe site-uri ale proiectului (ex. grupul print)
function hostOf(url: string) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "").slice(0, 100);
  } catch {
    return null;
  }
}

function pathOf(url: string) {
  try {
    const u = new URL(url);
    return (u.pathname + u.search).slice(0, 500);
  } catch {
    return "/";
  }
}

export async function recordHit(h: Hit, userAgent: string) {
  const info = await site(h.site);
  if (!info) return;
  const { projectId } = info;
  const now = new Date();
  const date = dayDate(dayKey(now));
  const path = pathOf(h.url);

  const existing = await prisma.trackSession.findUnique({ where: { id: h.sid }, select: { projectId: true } });
  if (existing && existing.projectId !== projectId) return;

  const touch = { lastSeenAt: now, ...(h.t === "pageview" ? { pageviews: { increment: 1 } } : {}) };
  if (!existing) {
    const a = attribute(h.url, h.ref || null);
    // upsert: doua cereri simultane pot porni aceeasi vizita (pagina + comanda)
    await prisma.trackSession.upsert({
      where: { id: h.sid },
      update: touch,
      create: {
        id: h.sid,
        projectId,
        visitorId: h.vid,
        date,
        landingPath: path,
        host: hostOf(h.url),
        referrerHost: a.referrerHost,
        source: a.source,
        medium: a.medium,
        campaign: a.campaign,
        content: a.content,
        term: a.term,
        clickType: a.clickType,
        device: deviceOf(userAgent),
        pageviews: h.t === "pageview" ? 1 : 0,
      },
    });
  } else {
    await prisma.trackSession.update({ where: { id: h.sid }, data: touch });
  }

  const base = { projectId, sessionId: h.sid, visitorId: h.vid, at: now, date, path };

  if (h.t === "pageview") {
    await prisma.trackEvent.create({ data: { ...base, type: "pageview" } });
    // Obiectivele se ating o singura data pe vizita
    const lower = path.toLowerCase();
    for (const goal of info.goals) {
      if (!lower.includes(goal.pattern.toLowerCase())) continue;
      const done = await prisma.trackEvent.count({ where: { sessionId: h.sid, goalId: goal.id } });
      if (done === 0) {
        await prisma.trackEvent.create({ data: { ...base, type: "goal", name: goal.name, goalId: goal.id, value: goal.value } });
      }
    }
    return;
  }

  if (h.t === "purchase" && h.order) {
    // Aceeasi comanda poate fi trimisa de doua ori (reincarcarea paginii de multumire)
    const dup = await prisma.trackEvent.count({ where: { projectId, type: "purchase", orderId: h.order } });
    if (dup > 0) return;
  }
  await prisma.trackEvent.create({
    data: { ...base, type: h.t, name: h.name ?? h.t, value: h.value, currency: h.currency, orderId: h.order },
  });
}
