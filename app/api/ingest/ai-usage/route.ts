import crypto from "crypto";
import { NextResponse } from "next/server";
import { alertToken } from "@/lib/alerts";
import { ingestAiUsage } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";

// Consumul AI raportat de aplicatii (helper-ul _deploy/shared/ai-usage.ts), cu acelasi token ca /api/alert.
// POST { project, events: [{ provider, model, feature, inputTokens?, outputTokens?, cachedTokens?, cacheWriteTokens?,
//   seconds?, costUsd?, count?, ts?, ok, errorType?: "credit" | "auth" | "rate" | "other", errorMessage? }] }
// cu antetul x-alert-token. Cel mult 1000 de evenimente pe cerere.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { project?: string; events?: unknown } | null;
  const project = String(body?.project || "").slice(0, 60);
  const token = req.headers.get("x-alert-token") || "";
  const expected = project ? alertToken(project) : "";
  if (!project || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!Array.isArray(body?.events)) return NextResponse.json({ error: "events lipsă" }, { status: 400 });
  const r = await ingestAiUsage(project, body.events);
  return NextResponse.json({ ok: true, accepted: r.accepted });
}
