import type { AiAccount } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { TZ, dayDate, dayKey, lastNDays } from "@/lib/dates";
import { raiseAlert, resolveAlert } from "@/lib/alerts";
import { AI_ADMIN, isAiAdminProvider, type AiAdminCredentials, type ApiCostRow } from "@/lib/integrations/ai-admin";

// Conturile de organizatie Anthropic / OpenAI: citite o singura data pe zi (costul zilei de ieri e final
// abia dupa miezul noptii UTC), oricat de des ar rula /api/cron/sync. Rescriem mereu ultimele 7 zile,
// ca sa prindem corecturile tarzii; prima sincronizare aduce 90 de zile.
export const AI_SYNC_DAYS = 7;
export const AI_FIRST_DAYS = 90;
// Dupa ora 5 (ora Romaniei) = dupa 2-3:00 UTC: ziua UTC de ieri e incheiata si raportata
const FROM_HOUR = 5;
const RETRY_MS = 2 * 60 * 60 * 1000;

async function replaceCosts(acc: AiAccount, since: string, until: string, rows: ApiCostRow[]) {
  await prisma.$transaction([
    prisma.aiCostDaily.deleteMany({ where: { accountId: acc.id, date: { gte: dayDate(since), lte: dayDate(until) } } }),
    prisma.aiCostDaily.createMany({
      data: rows
        .filter((r) => r.date >= since && r.date <= until)
        .map((r) => ({
          accountId: acc.id,
          organizationId: acc.organizationId,
          provider: acc.provider,
          date: dayDate(r.date),
          externalId: r.externalId,
          model: r.model.slice(0, 190),
          costUsd: r.costUsd,
          inputTokens: BigInt(Math.round(r.inputTokens)),
          outputTokens: BigInt(Math.round(r.outputTokens)),
          cachedTokens: BigInt(Math.round(r.cachedTokens)),
          requests: Math.round(r.requests),
        })),
      skipDuplicates: true,
    }),
  ]);
}

export async function syncAiAccount(accountId: string, days = AI_SYNC_DAYS) {
  const acc = await prisma.aiAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (!isAiAdminProvider(acc.provider)) throw new Error(`Furnizor AI necunoscut: ${acc.provider}`);
  const info = AI_ADMIN[acc.provider];
  const { since, until } = lastNDays(days);
  await prisma.aiAccount.update({ where: { id: acc.id }, data: { lastTryAt: new Date() } });
  const alertKey = `sync:ai:${acc.provider}:${acc.organizationId}`;
  try {
    const creds = decryptJson<AiAdminCredentials>(acc.credentials);
    // Numele workspace-urilor / proiectelor (nu opresc sincronizarea daca lipsesc)
    const names = await info.names(creds).catch(() => null);
    const rows = await info.fetch(creds, since, until);
    await replaceCosts(acc, since, until, rows);
    await prisma.aiAccount.update({
      where: { id: acc.id },
      data: { status: "ACTIVE", lastSyncAt: new Date(), lastError: null, ...(names && { names }) },
    });
    await resolveAlert(alertKey, `Contul ${info.name} (cost AI) se sincronizează din nou.`).catch(() => {});
    return { ok: true as const, rows: rows.length };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.aiAccount.update({ where: { id: acc.id }, data: { status: "ERROR", lastError: error } });
    await raiseAlert({ key: alertKey, kind: "sync", message: `Contul ${info.name} (cost AI) nu se mai sincronizează: ${error}` }).catch(() => {});
    return { ok: false as const, error };
  }
}

function due(acc: Pick<AiAccount, "lastSyncAt" | "lastTryAt">, now = new Date()) {
  if (!acc.lastSyncAt) return !acc.lastTryAt || now.getTime() - acc.lastTryAt.getTime() >= RETRY_MS;
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
  if (hour < FROM_HOUR) return false;
  if (dayKey(acc.lastSyncAt) === dayKey(now)) return false;
  return !acc.lastTryAt || now.getTime() - acc.lastTryAt.getTime() >= RETRY_MS;
}

// Din /api/cron/sync (la 10 minute): doar conturile care n-au fost citite azi
export async function syncAiAccountsDue() {
  const accounts = await prisma.aiAccount.findMany({ where: { status: { not: "DISABLED" } } });
  const results = [];
  for (const a of accounts) {
    if (!due(a)) continue;
    results.push({ id: a.id, provider: a.provider, ...(await syncAiAccount(a.id, a.lastSyncAt ? AI_SYNC_DAYS : AI_FIRST_DAYS)) });
  }
  return results;
}
