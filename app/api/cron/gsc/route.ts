import { NextResponse } from "next/server";
import { syncGscAll } from "@/lib/gsc";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Google Search Console, o data pe zi (crontab pe server, vezi README).
// Prima rulare pe un proiect aduce 16 luni; apoi doar ultimele zile (Google le mai corecteaza).
// ?project=bazadate = doar un proiect (pentru test).
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await syncGscAll(new URL(req.url).searchParams.get("project"));
  const failed = results.filter((r) => !r.ok).length;
  return NextResponse.json({ synced: results.length, failed, results }, { status: failed ? 207 : 200 });
}
