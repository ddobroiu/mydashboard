import { NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Apelat de GitHub Actions (.github/workflows/sync.yml) de cateva ori pe zi.
// Re-sincronizeaza ultimele 3 zile, ca sa prinda corecturile tarzii ale platformelor.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const days = Math.min(Number(new URL(req.url).searchParams.get("days")) || 3, 90);
  const results = await syncAll(days);
  const failed = results.filter((r) => !r.ok);
  return NextResponse.json({ synced: results.length, failed: failed.length, results }, { status: failed.length ? 207 : 200 });
}
