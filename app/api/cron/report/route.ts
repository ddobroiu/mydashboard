import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/alerts";
import { buildDailyReport, renderDailyReport, reportSubject } from "@/lib/daily-report";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Raportul de dimineata pe e-mail (ALERT_EMAIL). Crontab-ul serverului e in UTC, iar ora Romaniei se schimba
// vara/iarna, asa ca il apelam la 04:30 si la 05:30 UTC: trimite doar apelul care cade la 07:xx in Romania.
// ?force=1 trimite oricand (test).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", hour: "2-digit", hour12: false }).format(new Date()));
  if (!force && hour !== 7) return NextResponse.json({ skipped: `ora ${hour} în România, trimitem la 7` });

  const report = await buildDailyReport();
  const sent = await sendEmail(reportSubject(report), renderDailyReport(report, process.env.AUTH_URL || undefined));
  return NextResponse.json({ sent, day: report.day, highlights: report.highlights.length }, { status: sent ? 200 : 502 });
}
