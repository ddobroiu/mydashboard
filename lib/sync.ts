import type { Connection } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { addDays, dayDate, dayKey, lastNDays } from "@/lib/dates";
import { fetchStripeTransactions, type StripeCredentials } from "@/lib/integrations/stripe";
import { fetchMetaSpend, type MetaCredentials } from "@/lib/integrations/meta";
import { fetchPostingClipsPosts, type PostingClipsCredentials } from "@/lib/integrations/postingclips";
import { fetchOblioInvoices, type InvoiceRow, type OblioCredentials } from "@/lib/integrations/oblio";
import { fetchReplicateUsage, type AiUsageRow, type ReplicateCredentials } from "@/lib/integrations/replicate";
import type { AdSpendRow, SocialPostRow, TransactionRow } from "@/lib/integrations/types";

export const SYNCABLE = ["STRIPE", "META", "POSTINGCLIPS", "OBLIO", "REPLICATE"] as const;

// Vizualizarile unui clip mai cresc cam o luna dupa postare (si PostingClips
// le reciteste tot 30 de zile), asa ca rescriem mereu cel putin atat.
const SOCIAL_MIN_DAYS = 30;

// Rescrie complet intervalul [since, until] pentru o conexiune.
// Asa prindem si corecturile tarzii (rambursari Stripe, cheltuieli Meta recalculate).
async function replaceAdSpend(conn: Connection, since: string, until: string, rows: AdSpendRow[]) {
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
    default:
      throw new Error(`Integrarea ${conn.provider} nu e inca disponibila`);
  }
}

export async function syncConnection(connectionId: string, days = 3) {
  const conn = await prisma.connection.findUniqueOrThrow({ where: { id: connectionId } });
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
    return { ok: true as const, rows };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.$transaction([
      prisma.syncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), ok: false, error } }),
      prisma.connection.update({ where: { id: conn.id }, data: { status: "ERROR", lastError: error } }),
    ]);
    return { ok: false as const, error };
  }
}

export async function syncAll(days = 3) {
  const conns = await prisma.connection.findMany({
    where: { status: { not: "DISABLED" }, provider: { in: [...SYNCABLE] } },
    select: { id: true },
  });
  const results = [];
  // Secvential, ca sa nu lovim rate-limit-urile platformelor.
  for (const c of conns) results.push({ id: c.id, ...(await syncConnection(c.id, days)) });
  return results;
}
