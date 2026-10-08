// Citeste mesajele noi din casutele aplicatiilor (MAILBOXES_JSON), doar citire pe server. Crontab, la 2 minute:
//   */2 * * * * CS=$(grep -E "^CRON_SECRET=" /opt/apps/mydashboard/.env | cut -d= -f2- | tr -d '"'); curl -s -o /dev/null -w "email-sync \%{http_code}\n" -X POST -H "Authorization: Bearer $CS" --max-time 110 https://mydashboard.ro/api/cron/email-sync >> /var/log/mydashboard-sync.log 2>&1
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { syncAll } = await import("@/lib/email-inbox/sync");
  const { missingTable } = await import("@/lib/email-inbox/admin");
  try {
    // in raspuns / log: doar numere si erori (fara continutul mesajelor)
    return NextResponse.json(await syncAll());
  } catch (e) {
    if (missingTable(e)) return NextResponse.json({ skipped: "migrarea prisma/sql/2026-10-08_email_inbox.sql nu e aplicată" });
    console.error("[cron/email-sync]", (e as Error)?.message);
    return NextResponse.json({ error: String((e as Error)?.message || e).slice(0, 300) }, { status: 500 });
  }
}
