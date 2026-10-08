import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import { replaceAdSpend } from "@/lib/sync";
import type { AdSpendRow } from "@/lib/integrations/types";

// Google Ads, contul comun al tuturor site-urilor (API-ul Google Ads cere developer token aprobat, pe care nu-l avem):
// UN script lipit in cont (Instrumente → Scripturi) trimite cheltuiala pe campanie pe zi la /api/ingest/google-ads-cont.
// Cheia scriptului e derivata din CRON_SECRET (nu se seteaza separat), ca in adminul ShopPrint (lib/adSpend.ts).
// Fiecare campanie merge la proiectul al carui prefix se potriveste cu inceputul numelui (AdsCampaignRule).
// Partea proiectului se scrie in AdSpendDaily printr-o conexiune GOOGLE_ADS ascunsa (externalId SHARED_EXTERNAL_ID),
// asa ca Bani, Prezentare si prima pagina o vad fara alta modificare.

export const SHARED_EXTERNAL_ID = "shared-google-ads";
export const SHARED_LABEL = "cont comun, după numele campaniei";

export function accountScriptKey(): string | null {
  const s = process.env.CRON_SECRET;
  if (!s) return null;
  return crypto.createHmac("sha256", s).update("google-ads-account-script").digest("base64url").slice(0, 32);
}

export function isValidAccountKey(key: unknown) {
  const expected = accountScriptKey();
  if (!expected || typeof key !== "string" || key.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(key), Buffer.from(expected));
}

// Regulile de pornire (se creeaza o singura data, cand tabelul e gol, pentru proiectele care exista cu numele acesta)
export const DEFAULT_RULES: { prefix: string; project: string }[] = [
  { prefix: "BazaDate", project: "bazadate" },
  { prefix: "Beneficiari", project: "beneficiari" },
  { prefix: "Shopping", project: "print" },
  { prefix: "ShopPrint", project: "print" },
  { prefix: "PostingClips", project: "postingclips" },
  { prefix: "Oferte", project: "oferte" },
  { prefix: "Anexa1", project: "anexa1" },
  { prefix: "InvitOnline", project: "invitonline" },
  { prefix: "AI365", project: "ai365" },
  { prefix: "TipareMentale", project: "tiparementale" },
];

export type Rule = { id: string; prefix: string; projectId: string };

// Tabelele vin din prisma/sql/2026-10-09_google_ads_cont_comun.sql; pana se aplica, paginile spun asta in loc sa cada
export const isMissingTable = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022");

export async function getRules(): Promise<Rule[]> {
  let rules = await prisma.adsCampaignRule.findMany({ select: { id: true, prefix: true, projectId: true }, orderBy: { prefix: "asc" } });
  if (rules.length === 0) {
    const projects = await prisma.project.findMany({ select: { id: true, name: true } });
    const byName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id]));
    const data = DEFAULT_RULES.filter((r) => byName.has(r.project)).map((r) => ({ prefix: r.prefix, projectId: byName.get(r.project)! }));
    if (data.length) {
      await prisma.adsCampaignRule.createMany({ data, skipDuplicates: true });
      rules = await prisma.adsCampaignRule.findMany({ select: { id: true, prefix: true, projectId: true }, orderBy: { prefix: "asc" } });
    }
  }
  return rules;
}

// Proiectul unei campanii: prefixul cel mai lung cu care incepe numele (fara diferente de litere mari/mici)
export function projectOfCampaign(name: string, rules: Rule[]): string | null {
  const n = name.trim().toLowerCase();
  let best: Rule | null = null;
  for (const r of rules) {
    const p = r.prefix.trim().toLowerCase();
    if (p && n.startsWith(p) && (!best || p.length > best.prefix.trim().length)) best = r;
  }
  return best?.projectId ?? null;
}

// Conexiunea ascunsa a proiectului pentru partea lui din contul comun
async function sharedConnection(projectId: string) {
  const found = await prisma.connection.findFirst({ where: { projectId, provider: "GOOGLE_ADS", externalId: SHARED_EXTERNAL_ID } });
  if (found) return found;
  return prisma.connection.create({
    data: { projectId, provider: "GOOGLE_ADS", externalId: SHARED_EXTERNAL_ID, label: SHARED_LABEL, credentials: encryptJson({ shared: "1" }) },
  });
}

// Proiectele care au deja scriptul lor (conexiunea veche, pe proiect) si au primit date in ultima saptamana:
// nu le mai dam si partea din contul comun, ca sa nu se numere de doua ori.
async function projectsWithOwnScript() {
  const since = new Date(Date.now() - 7 * 86_400_000);
  const rows = await prisma.connection.findMany({
    where: { provider: "GOOGLE_ADS", status: { not: "DISABLED" }, OR: [{ externalId: null }, { externalId: { not: SHARED_EXTERNAL_ID } }], lastSyncAt: { gte: since } },
    select: { projectId: true },
  });
  return new Set(rows.map((r) => r.projectId));
}

// Rescrie partea fiecarui proiect pe [since, until], din randurile brute si regulile de acum
export async function redistribute(since: string, until: string) {
  const [raw, rules, own] = await Promise.all([
    prisma.googleAdsAccountDaily.findMany({ where: { date: { gte: dayDate(since), lte: dayDate(until) } } }),
    getRules(),
    projectsWithOwnScript(),
  ]);
  const byProject = new Map<string, AdSpendRow[]>();
  for (const r of raw) {
    const pid = projectOfCampaign(r.campaignName, rules);
    if (!pid || own.has(pid)) continue;
    if (!byProject.has(pid)) byProject.set(pid, []);
    byProject.get(pid)!.push({
      date: r.date.toISOString().slice(0, 10),
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      clipId: null,
      currency: r.currency,
      spend: Number(r.spend),
      impressions: r.impressions,
      clicks: r.clicks,
      conversions: Number(r.conversions),
      conversionValue: Number(r.conversionValue),
    });
  }
  // si proiectele care aveau ceva si acum nu mai au (regula stearsa / mutata)
  const existing = await prisma.connection.findMany({ where: { provider: "GOOGLE_ADS", externalId: SHARED_EXTERNAL_ID }, select: { projectId: true } });
  const pids = new Set([...byProject.keys(), ...existing.map((c) => c.projectId)]);
  for (const pid of pids) {
    const conn = await sharedConnection(pid);
    const rows = byProject.get(pid) ?? [];
    await replaceAdSpend(conn, since, until, rows);
    await prisma.connection.update({ where: { id: conn.id }, data: { status: "ACTIVE", lastError: null, lastSyncAt: new Date() } });
  }
  return { projects: byProject.size, rows: raw.length };
}

// Dupa schimbarea regulilor: refacem ultimele 90 de zile
export const redistributeRecent = () => redistribute(addDays(dayKey(new Date()), -89), dayKey(new Date()));

// Campaniile din ultimele 30 de zile, cu proiectul la care merg (pentru pagina de setari)
export async function recentCampaigns(rules: Rule[]) {
  const since = dayDate(addDays(dayKey(new Date()), -29));
  const [rows, last] = await Promise.all([
    prisma.googleAdsAccountDaily.groupBy({ by: ["campaignId", "campaignName", "currency"], where: { date: { gte: since } }, _sum: { spend: true, clicks: true } }),
    prisma.googleAdsAccountDaily.aggregate({ _max: { updatedAt: true } }),
  ]);
  return {
    lastAt: last._max.updatedAt,
    campaigns: rows
      .map((r) => ({
        campaignId: r.campaignId,
        name: r.campaignName,
        currency: r.currency,
        spend: Number(r._sum.spend ?? 0),
        clicks: Number(r._sum.clicks ?? 0),
        projectId: projectOfCampaign(r.campaignName, rules),
      }))
      .sort((a, b) => b.spend - a.spend),
  };
}

// Scriptul lipit in Google Ads → Instrumente → Actiuni in bloc → Scripturi. Trimite ultimele 30 de zile la fiecare rulare.
export function accountAdsScript(endpoint: string, key: string) {
  return `// mydashboard: cheltuiala Google Ads pe campanie pe zi, pentru TOATE site-urile din cont.
// Campania ajunge la site-ul al carui nume il are la inceput (ex. „BazaDate - Cautare” → BazaDate).
// Programeaza-l „Din ora in ora”. Contine o cheie: nu-l publica.
var ENDPOINT = '${endpoint}';
var KEY = '${key}';
var DAYS = 30;

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var day = function (d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  var until = day(new Date());
  var since = day(new Date(Date.now() - (DAYS - 1) * 86400000));

  var it = AdsApp.search(
    'SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, ' +
    'metrics.clicks, metrics.conversions, metrics.conversions_value FROM campaign ' +
    "WHERE segments.date BETWEEN '" + since + "' AND '" + until + "'"
  );
  var rows = [];
  while (it.hasNext()) {
    var r = it.next();
    rows.push({
      date: r.segments.date,
      campaignId: String(r.campaign.id),
      campaignName: r.campaign.name,
      spend: Number(r.metrics.costMicros || 0) / 1e6,
      impressions: Number(r.metrics.impressions || 0),
      clicks: Number(r.metrics.clicks || 0),
      conversions: Number(r.metrics.conversions || 0),
      conversionValue: Number(r.metrics.conversionsValue || 0)
    });
  }

  var res = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      key: KEY,
      customerId: account.getCustomerId(),
      accountName: account.getName(),
      currency: account.getCurrencyCode(),
      since: since,
      until: until,
      rows: rows
    })
  });
  Logger.log(res.getResponseCode() + ' ' + res.getContentText());
  if (res.getResponseCode() !== 200) throw new Error('mydashboard: ' + res.getContentText());
}
`;
}
