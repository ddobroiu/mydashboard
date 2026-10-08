import crypto from "crypto";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { raiseAlert, resolveAlert } from "@/lib/alerts";
import { addDays, dayDate, dayKey } from "@/lib/dates";

// Google Search Console: ce cauta oamenii pe Google si pe ce pagini intra.
// Autentificare cu un service account (robot) adaugat ca utilizator in Search Console;
// token prin JWT grant, fara biblioteca googleapis.

type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const b64 = process.env.GSC_SERVICE_ACCOUNT_JSON;
  const file = process.env.GSC_SERVICE_ACCOUNT_FILE;
  let raw: string | null = null;
  if (b64) raw = Buffer.from(b64, "base64").toString("utf8");
  else if (file) raw = fs.readFileSync(file, "utf8");
  if (!raw) return null;
  const k = JSON.parse(raw) as ServiceAccount;
  if (!k.client_email || !k.private_key) throw new Error("Cheia Search Console nu are client_email / private_key");
  return k;
}

export const gscConfigured = () => Boolean(process.env.GSC_SERVICE_ACCOUNT_JSON || process.env.GSC_SERVICE_ACCOUNT_FILE);

const WEBMASTERS = "https://www.googleapis.com/auth/webmasters.readonly";
const tokens = new Map<string, { token: string; exp: number }>();

// Tokenul robotului pentru un scope (Search Console; si Google Analytics in lib/ga4.ts, cu acelasi robot)
export async function accessToken(scope = WEBMASTERS): Promise<string> {
  const cached = tokens.get(scope);
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const k = serviceAccount();
  if (!k) throw new Error("Lipsește cheia Search Console (GSC_SERVICE_ACCOUNT_FILE sau GSC_SERVICE_ACCOUNT_JSON)");
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: k.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const jwt = `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), k.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) throw new Error(`Google nu a dat acces (${res.status} ${data.error ?? ""})`.trim());
  tokens.set(scope, { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

type Row = { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number };

async function searchAnalytics(siteUrl: string, body: Record<string, unknown>): Promise<Row[]> {
  const token = await accessToken();
  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      // "all" = si zilele recente (inca nefinalizate); le rescriem la fiecare rulare
      body: JSON.stringify({ dataState: "all", ...body }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const msg = err?.error?.message ?? res.statusText;
    if (res.status === 403) throw new Error(`Robotul nu are acces la ${siteUrl} în Search Console (${msg})`);
    throw new Error(`Search Console ${res.status}: ${msg}`);
  }
  const data = (await res.json()) as { rows?: Row[] };
  return data.rows ?? [];
}

// "https://www.tablou.net/" -> "sc-domain:tablou.net"
export function siteUrlFor(domain: string | null): string | null {
  if (!domain) return null;
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  return host ? `sc-domain:${host}` : null;
}

// Google pastreaza 16 luni de date
const BACKFILL_DAYS = 486;
// Zilele recente se mai corecteaza cateva zile
const REFRESH_DAYS = 4;
const TOP_QUERIES = 1000;
const TOP_PAGES = 250;

type ProjectLite = { id: string; name: string; domain: string | null };

export async function syncGscProject(p: ProjectLite) {
  const siteUrl = siteUrlFor(p.domain);
  if (!siteUrl) return { project: p.name, skipped: "fără domeniu" };
  const today = dayKey(new Date());

  const last = await prisma.gscDaily.findFirst({ where: { projectId: p.id }, orderBy: { date: "desc" }, select: { date: true } });
  const since = last ? addDays(last.date.toISOString().slice(0, 10), -REFRESH_DAYS) : addDays(today, -BACKFILL_DAYS);

  // 1) totalurile pe zi
  const daily = await searchAnalytics(siteUrl, { startDate: since, endDate: today, dimensions: ["date"], rowLimit: 25000 });
  await prisma.$transaction([
    prisma.gscDaily.deleteMany({ where: { projectId: p.id, date: { gte: dayDate(since) } } }),
    prisma.gscDaily.createMany({
      data: daily.map((r) => ({
        projectId: p.id,
        date: dayDate(r.keys![0]),
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        position: r.position,
      })),
    }),
  ]);

  const newest = await prisma.gscDaily.findFirst({ where: { projectId: p.id }, orderBy: { date: "desc" }, select: { date: true } });
  const lastDate = newest ? newest.date.toISOString().slice(0, 10) : null;

  // 2) topul cautarilor si al paginilor: ultimele 28 de zile cu date si cele 28 dinainte
  let periodStart: string | null = null;
  let tops = 0;
  if (lastDate) {
    periodStart = addDays(lastDate, -27);
    const prevEnd = addDays(periodStart, -1);
    const prevStart = addDays(prevEnd, -27);
    const [qCur, qPrev, pCur, pPrev] = await Promise.all([
      searchAnalytics(siteUrl, { startDate: periodStart, endDate: lastDate, dimensions: ["query"], rowLimit: TOP_QUERIES }),
      searchAnalytics(siteUrl, { startDate: prevStart, endDate: prevEnd, dimensions: ["query"], rowLimit: TOP_QUERIES }),
      searchAnalytics(siteUrl, { startDate: periodStart, endDate: lastDate, dimensions: ["page"], rowLimit: TOP_PAGES }),
      searchAnalytics(siteUrl, { startDate: prevStart, endDate: prevEnd, dimensions: ["page"], rowLimit: TOP_PAGES }),
    ]);
    const rows = (kind: string, period: string, list: Row[]) =>
      list.map((r) => ({
        projectId: p.id,
        kind,
        period,
        key: r.keys![0].slice(0, 500),
        clicks: Math.round(r.clicks),
        impressions: Math.round(r.impressions),
        position: r.position,
      }));
    const data = [...rows("query", "cur", qCur), ...rows("query", "prev", qPrev), ...rows("page", "cur", pCur), ...rows("page", "prev", pPrev)];
    tops = data.length;
    await prisma.$transaction([prisma.gscTop.deleteMany({ where: { projectId: p.id } }), prisma.gscTop.createMany({ data })]);
  }

  const state = {
    siteUrl,
    lastSyncAt: new Date(),
    lastError: null,
    lastDate: lastDate ? dayDate(lastDate) : null,
    periodStart: periodStart ? dayDate(periodStart) : null,
    periodEnd: lastDate ? dayDate(lastDate) : null,
  };
  await prisma.gscSite.upsert({ where: { projectId: p.id }, create: { projectId: p.id, ...state }, update: state });
  return { project: p.name, days: daily.length, tops, lastDate };
}

// Scadere de peste 30% a clicurilor din Google fata de saptamana trecuta (doar la volume care conteaza)
const DROP = 0.3;
const MIN_WEEK_CLICKS = 50;

export async function checkGscDrop(p: ProjectLite) {
  const last = await prisma.gscDaily.findFirst({ where: { projectId: p.id }, orderBy: { date: "desc" }, select: { date: true } });
  if (!last) return;
  // Ultima zi poate fi incompleta: comparam cele 7 zile de dinaintea ei cu cele 7 anterioare
  const end = addDays(last.date.toISOString().slice(0, 10), -1);
  const sum = async (from: string, to: string) =>
    (await prisma.gscDaily.aggregate({ where: { projectId: p.id, date: { gte: dayDate(from), lte: dayDate(to) } }, _sum: { clicks: true } }))._sum
      .clicks ?? 0;
  const cur = await sum(addDays(end, -6), end);
  const prev = await sum(addDays(end, -13), addDays(end, -7));
  const key = `gsc-drop:${p.id}`;
  if (prev >= MIN_WEEK_CLICKS && cur < prev * (1 - DROP)) {
    const pct = Math.round((1 - cur / prev) * 100);
    await raiseAlert({
      key,
      kind: "traffic",
      project: p.name,
      message: `Clicurile din Google au scăzut cu ${pct}% față de săptămâna trecută: ${cur} în ultimele 7 zile, față de ${prev} înainte.`,
    });
  } else {
    await resolveAlert(key, `${p.name}: clicurile din Google și-au revenit (${cur} în ultimele 7 zile, față de ${prev}).`);
  }
}

export async function syncGscAll(onlyProject?: string | null) {
  const projects = await prisma.project.findMany({
    where: { domain: { not: null }, ...(onlyProject && { name: { equals: onlyProject, mode: "insensitive" as const } }) },
    select: { id: true, name: true, domain: true },
    orderBy: { name: "asc" },
  });
  const results = [];
  for (const p of projects) {
    const key = `gsc:${p.id}`;
    try {
      const r = await syncGscProject(p);
      results.push({ ok: true, ...r });
      await resolveAlert(key, `${p.name}: datele din Google Search Console vin din nou.`);
      await checkGscDrop(p);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ ok: false, project: p.name, error });
      await prisma.gscSite
        .upsert({
          where: { projectId: p.id },
          create: { projectId: p.id, siteUrl: siteUrlFor(p.domain) ?? "", lastError: error },
          update: { lastError: error },
        })
        .catch(() => {});
      await raiseAlert({ key, kind: "sync", project: p.name, message: `Datele din Google Search Console nu se pot citi: ${error.slice(0, 300)}` }).catch(() => {});
    }
  }
  return results;
}
