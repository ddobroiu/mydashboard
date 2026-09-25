import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { decryptJson } from "@/lib/crypto";
import { replaceAdSpend } from "@/lib/sync";
import { parseScriptKey, secretMatches, toAdSpendRows, type GoogleAdsCredentials } from "@/lib/integrations/google-ads";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 90;

// Primeste cheltuiala de la scriptul din contul Google Ads (vezi lib/integrations/google-ads.ts)
// si rescrie intervalul trimis, ca la celelalte integrari.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const key = parseScriptKey(body?.key);
  if (!key) return NextResponse.json({ error: "cheie lipsă" }, { status: 401 });

  const conn = await prisma.connection.findUnique({ where: { id: key.connectionId } });
  if (!conn || conn.provider !== "GOOGLE_ADS" || conn.status === "DISABLED") {
    return NextResponse.json({ error: "cheie greșită" }, { status: 401 });
  }
  const creds = decryptJson<GoogleAdsCredentials>(conn.credentials);
  if (!secretMatches(creds.scriptSecret, key.secret)) {
    return NextResponse.json({ error: "cheie greșită" }, { status: 401 });
  }

  const { since, until, currency, rows } = body;
  const span = (Date.parse(until) - Date.parse(since)) / 86_400_000;
  if (!DAY.test(since) || !DAY.test(until) || !(span >= 0 && span < MAX_DAYS) || !Array.isArray(rows) || typeof currency !== "string") {
    return NextResponse.json({ error: "date invalide" }, { status: 400 });
  }

  const adRows = toAdSpendRows(rows, currency, creds.project);
  const accountName = typeof body.accountName === "string" ? body.accountName : "Google Ads";

  await replaceAdSpend(conn, since, until, adRows);
  await prisma.$transaction([
    prisma.syncRun.create({ data: { connectionId: conn.id, finishedAt: new Date(), ok: true, rows: adRows.length } }),
    prisma.connection.update({
      where: { id: conn.id },
      data: {
        status: "ACTIVE",
        lastSyncAt: new Date(),
        lastError: null,
        externalId: typeof body.customerId === "string" ? body.customerId : conn.externalId,
        label: `${accountName} (${currency})${creds.project ? ` · [${creds.project}]` : ""}`,
      },
    }),
  ]);
  return NextResponse.json({ ok: true, rows: adRows.length });
}
