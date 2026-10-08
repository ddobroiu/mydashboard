import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dayDate } from "@/lib/dates";
import { isMissingTable, isValidAccountKey, redistribute } from "@/lib/ads-account";

export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 90;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Primeste cheltuiala de la scriptul din contul comun Google Ads (lib/ads-account.ts): rescrie intervalul trimis
// in GoogleAdsAccountDaily, apoi imparte campaniile pe proiecte dupa numele lor.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!isValidAccountKey(body?.key)) return NextResponse.json({ error: "cheie greșită" }, { status: 401 });

  const { since, until, currency, rows } = body;
  const span = (Date.parse(until) - Date.parse(since)) / 86_400_000;
  if (!DAY.test(since) || !DAY.test(until) || !(span >= 0 && span < MAX_DAYS) || !Array.isArray(rows) || typeof currency !== "string") {
    return NextResponse.json({ error: "date invalide" }, { status: 400 });
  }
  const customerId = typeof body.customerId === "string" && body.customerId ? body.customerId.slice(0, 40) : "necunoscut";

  const data = (rows as Record<string, unknown>[])
    .filter((r) => typeof r.date === "string" && DAY.test(r.date) && r.date >= since && r.date <= until && r.campaignId != null)
    .map((r) => ({
      customerId,
      date: dayDate(r.date as string),
      campaignId: String(r.campaignId).slice(0, 60),
      campaignName: String(r.campaignName ?? r.campaignId).slice(0, 300),
      currency: currency.slice(0, 3).toUpperCase(),
      spend: n(r.spend),
      impressions: Math.round(n(r.impressions)),
      clicks: Math.round(n(r.clicks)),
      conversions: n(r.conversions),
      conversionValue: n(r.conversionValue),
    }));

  try {
    await prisma.$transaction([
      prisma.googleAdsAccountDaily.deleteMany({ where: { customerId, date: { gte: dayDate(since), lte: dayDate(until) } } }),
      prisma.googleAdsAccountDaily.createMany({ data, skipDuplicates: true }),
    ]);
    const r = await redistribute(since, until);
    return NextResponse.json({ ok: true, rows: data.length, projects: r.projects });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: "mydashboard: tabelele Google Ads nu sunt create încă" }, { status: 503 });
    throw e;
  }
}
