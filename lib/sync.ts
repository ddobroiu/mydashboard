import { raiseAlert, resolveAlert } from "@/lib/alerts";
import type { Connection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { TZ, addDays, dayDate, dayKey, lastNDays } from "@/lib/dates";
import { fetchStripeTransactions, type StripeCredentials } from "@/lib/integrations/stripe";
import { fetchMetaSpend, type MetaCredentials } from "@/lib/integrations/meta";
import { fetchPostingClipsPosts, type PostingClipsCredentials } from "@/lib/integrations/postingclips";
import { fetchOblioInvoices, type InvoiceRow, type OblioCredentials } from "@/lib/integrations/oblio";
import { fetchReplicateUsage, type AiUsageRow, type ReplicateCredentials } from "@/lib/integrations/replicate";
import { fetchDbOrders, type OrdersDbCredentials } from "@/lib/integrations/orders-db";
import { fetchClarityInsights, type ClarityCredentials, type ClarityRow } from "@/lib/integrations/clarity";
import type { AdSpendRow, SocialPostRow, TransactionRow } from "@/lib/integrations/types";

export const SYNCABLE = ["STRIPE", "META", "POSTINGCLIPS", "OBLIO", "REPLICATE", "ORDERS_DB", "CLARITY"] as const;

// Vizualizarile unui clip mai cresc cam o luna dupa postare (si PostingClips
// le reciteste tot 30 de zile), asa ca rescriem mereu cel putin atat.
const SOCIAL_MIN_DAYS = 30;

// Rescrie complet intervalul [since, until] pentru o conexiune.
// Asa prindem si corecturile tarzii (rambursari Stripe, cheltuieli Meta recalculate).
export async function replaceAdSpend(conn: Connection, since: string, until: string, rows: AdSpendRow[]) {
  const range = { gte: dayDate(since), lte: dayDate(until) };
  await prisma.$transaction([
    prisma.adSpendDaily.deleteMany({ where: { connectionId: conn.id, date: range } }),
    prisma.adSpendDaily.createMany({
      data: rows.map((r) => ({
        projectId: conn.projectId,
        connectionId: conn.id,
        provider: conn.provider,
        date: dayDate(r.date),
        campaignId: r.campaignId,
        campaignName: r.campaignName,
        clipId: r.clipId ?? null,
        currency: r.currency,
        spend: r.spend,
        impressions: r.impressions,
        clicks: r.clicks,
        conversions: r.conversions,
        conversionValue: r.conversionValue,
      })),
    }),
  ]);
}

async function replaceTransactions(conn: Connection, since: string, until: string, rows: TransactionRow[]) {
  const range = { gte: dayDate(since), lte: dayDate(until) };
  await prisma.$transaction([
    prisma.transaction.deleteMany({ where: { connectionId: conn.id, date: range } }),
    prisma.transaction.createMany({
      data: rows.map((r) => ({
        projectId: conn.projectId,
        connectionId: conn.id,
        provider: conn.provider,
        externalId: r.externalId,
        occurredAt: r.occurredAt,
        date: dayDate(r.date),
        currency: r.currency,
        amount: r.amount,
        customer: r.customer,
        utmSource: r.utmSource,
        utmCampaign: r.utmCampaign,
        clickId: r.clickId,
        visitorId: r.visitorId,
        site: r.site ?? null,
        fee: r.fee ?? null,
      })),
      skipDuplicates: true,
    }),
  ]);
}

// Rescrie postarile programate de la `since` incoace (inclusiv cele viitoare),
// ca sa dispara si cele sterse intre timp din PostingClips.
async function replaceSocialPosts(conn: Connection, since: string, rows: SocialPostRow[]) {
  await prisma.$transaction([
    prisma.socialPost.deleteMany({ where: { connectionId: conn.id, scheduledAt: { gte: dayDate(since) } } }),
    prisma.socialPost.createMany({
      data: rows.map((r) => ({
        ...r,
        projectId: conn.projectId,
        connectionId: conn.id,
        date: dayDate(dayKey(r.publishedAt ?? r.scheduledAt)),
      })),
      skipDuplicates: true,
    }),
  ]);
}

// Facturile Oblio din interval; optional si ca incasari (proiecte fara Stripe).
async function replaceInvoices(conn: Connection, since: string, until: string, rows: InvoiceRow[], asRevenue: boolean) {
  const range = { gte: dayDate(since), lte: dayDate(until) };
  const revenue: TransactionRow[] = asRevenue
    ? rows
        .filter((r) => !r.canceled && r.total !== 0)
        .map((r) => ({
          externalId: `oblio-${r.externalId}`,
          occurredAt: r.issueDate,
          date: r.issueDate.toISOString().slice(0, 10),
          currency: r.currency,
          amount: r.total,
          customer: r.clientEmail ?? r.clientName,
          utmSource: null,
          utmCampaign: null,
          clickId: null,
          visitorId: null,
        }))
    : [];
  await prisma.$transaction([
    prisma.invoice.deleteMany({ where: { connectionId: conn.id, issueDate: range } }),
    prisma.invoice.createMany({
      data: rows.map((r) => ({ ...r, projectId: conn.projectId, connectionId: conn.id })),
      skipDuplicates: true,
    }),
  ]);
  // Rescrie si incasarile (sau le sterge, daca bifa a fost scoasa)
  await replaceTransactions(conn, since, until, revenue);
}

async function replaceAiUsage(conn: Connection, since: string, until: string, rows: AiUsageRow[]) {
  const range = { gte: dayDate(since), lte: dayDate(until) };
  await prisma.$transaction([
    prisma.aiUsageDaily.deleteMany({ where: { connectionId: conn.id, date: range } }),
    prisma.aiUsageDaily.createMany({
      data: rows.map((r) => ({ ...r, date: dayDate(r.date), projectId: conn.projectId, connectionId: conn.id })),
    }),
  ]);
}

// Clarity: randul zilei de ieri (API-ul da totalul ultimelor 24 de ore; citit dupa ora 3 ≈ ziua de ieri)
export async function storeClarity(conn: Pick<Connection, "id" | "projectId">, row: ClarityRow, day = addDays(dayKey(new Date()), -1)) {
  const date = dayDate(day);
  await prisma.clarityDaily.upsert({
    where: { connectionId_date: { connectionId: conn.id, date } },
    create: { ...row, projectId: conn.projectId, connectionId: conn.id, date },
    update: { ...row, fetchedAt: new Date() },
  });
}

// Clarity permite 10 cereri pe zi, iar sync-ul ruleaza la 10 minute. O singura citire reusita pe zi
// (cand ziua de ieri inca n-are rand); dupa o eroare reincercam cel mult o data la 2 ore si de maxim 4 ori in 24 de ore.
const CLARITY_RETRY_MS = 2 * 60 * 60 * 1000;
const CLARITY_MAX_TRIES = 4;

// Dupa ora 3 (ora Romaniei): Clarity mai proceseaza vizitele cateva ore, iar noaptea e trafic putin,
// asa ca fereastra de 24 de ore (3:00 ieri - 3:00 azi) acopera practic ziua de ieri.
const CLARITY_FROM_HOUR = 3;

async function clarityDue(connectionId: string, firstTime: boolean): Promise<boolean> {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  if (!firstTime && hour < CLARITY_FROM_HOUR) return false;
  const yesterday = dayDate(addDays(dayKey(new Date()), -1));
  const have = await prisma.clarityDaily.findUnique({ where: { connectionId_date: { connectionId, date: yesterday } }, select: { id: true } });
  if (have) return false;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const tries = await prisma.syncRun.findMany({
    where: { connectionId, startedAt: { gte: dayAgo } },
    select: { startedAt: true },
    orderBy: { startedAt: "desc" },
  });
  if (tries.length >= CLARITY_MAX_TRIES) return false;
  return !tries[0] || Date.now() - tries[0].startedAt.getTime() >= CLARITY_RETRY_MS;
}

async function runProvider(conn: Connection, since: string, until: string): Promise<number> {
  switch (conn.provider) {
    case "STRIPE": {
      const rows = await fetchStripeTransactions(decryptJson<StripeCredentials>(conn.credentials), since, until);
      await replaceTransactions(conn, since, until, rows);
      return rows.length;
    }
    case "META": {
      const rows = await fetchMetaSpend(decryptJson<MetaCredentials>(conn.credentials), conn.externalId!, since, until);
      await replaceAdSpend(conn, since, until, rows);
      return rows.length;
    }
    case "REPLICATE": {
      const rows = await fetchReplicateUsage(decryptJson<ReplicateCredentials>(conn.credentials), since, until);
      await replaceAiUsage(conn, since, until, rows);
      return rows.length;
    }
    case "ORDERS_DB": {
      const rows = await fetchDbOrders(decryptJson<OrdersDbCredentials>(conn.credentials), since, until);
      await replaceTransactions(conn, since, until, rows);
      return rows.length;
    }
    case "OBLIO": {
      const creds = decryptJson<OblioCredentials>(conn.credentials);
      const rows = await fetchOblioInvoices(creds, conn.externalId!, since, until);
      await replaceInvoices(conn, since, until, rows, creds.asRevenue === "1");
      return rows.length;
    }
    case "POSTINGCLIPS": {
      const from = [since, addDays(until, -(SOCIAL_MIN_DAYS - 1))].sort()[0];
      const rows = await fetchPostingClipsPosts(decryptJson<PostingClipsCredentials>(conn.credentials), from);
      await replaceSocialPosts(conn, from, rows);
      return rows.length;
    }
    case "CLARITY": {
      const row = await fetchClarityInsights(decryptJson<ClarityCredentials>(conn.credentials));
      await storeClarity(conn, row);
      return 1;
    }
    default:
      throw new Error(`Integrarea ${conn.provider} nu e inca disponibila`);
  }
}

export async function syncConnection(connectionId: string, days = 3) {
  const conn = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
  // Clarity: o data pe zi, oricat de des ar rula sync-ul (si la „Sincronizează acum”)
  if (conn.provider === "CLARITY" && !(await clarityDue(conn.id, !conn.lastSyncAt))) return { ok: true as const, rows: 0, skipped: true };
  const { since, until } = lastNDays(days);
  const run = await prisma.syncRun.create({ data: { connectionId } });

  try {
    const rows = await runProvider(conn, since, until);
    await prisma.$transaction([
      prisma.syncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: true, rows } }),
      prisma.connection.update({
        where: { id: conn.id },
        data: { status: "ACTIVE", lastSyncAt: new Date(), lastError: null },
      }),
    ]);
    return { ok: true as const, rows, skipped: false };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.$transaction([
      prisma.syncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error } }),
      prisma.connection.update({ where: { id: conn.id }, data: { status: "ERROR", lastError: error } }),
    ]);
    return { ok: false as const, error, skipped: false };
  }
}

// O conexiune care nu mai merge (cheie expirata, acces revocat) -> e-mail; cand merge iar -> „rezolvat”
async function alertOnSync(connectionId: string, error: string | null) {
  const c = await prisma.connection.findUnique({ where: { id: connectionId }, select: { provider: true, label: true, project: { select: { name: true } } } });
  if (!c) return;
  const key = `sync:${connectionId}`;
  if (!error) return resolveAlert(key, `${c.project.name}: conexiunea ${c.provider} (${c.label ?? ""}) merge din nou.`);
  await raiseAlert({ key, kind: "sync", project: c.project.name, message: `Conexiunea ${c.provider} (${c.label ?? ""}) nu se mai sincronizează: ${error.slice(0, 300)}` });
}

export async function syncAll(days = 3) {
  const conns = await prisma.connection.findMany({
    where: { status: { not: "DISABLED" }, provider: { in: [...SYNCABLE] } },
    select: { id: true },
  });
  const results = [];
  // Secvential, ca sa nu lovim rate-limit-urile platformelor.
  for (const c of conns) {
    const r = await syncConnection(c.id, days);
    results.push({ id: c.id, ...r });
    // Sarita (Clarity deja citit azi): nu schimbam starea alertei
    if (!r.skipped) await alertOnSync(c.id, r.ok ? null : String(r.error ?? "eroare necunoscută")).catch(() => {});
  }
  return results;
}
