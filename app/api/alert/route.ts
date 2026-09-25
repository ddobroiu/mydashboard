import crypto from "crypto";
import { NextResponse } from "next/server";
import { alertToken, raiseAlert, resolveAlert, type AlertKind } from "@/lib/alerts";

export const dynamic = "force-dynamic";

// Aplicatiile anunta aici o problema (ex. credite terminate la Anthropic) sau ca s-a rezolvat.
// POST { project, kind: "credits" | "error", key?, message, resolved? } cu antetul x-alert-token.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { project?: string; kind?: string; key?: string; message?: string; resolved?: boolean }
    | null;
  const project = String(body?.project || "").slice(0, 60);
  const token = req.headers.get("x-alert-token") || "";
  const expected = project ? alertToken(project) : "";
  if (!project || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const kind: AlertKind = body?.kind === "credits" ? "credits" : "error";
  const key = `${kind}:${project}:${String(body?.key || "general").slice(0, 80)}`;
  const message = String(body?.message || "").slice(0, 1000) || "Fără detalii.";
  if (body?.resolved) {
    await resolveAlert(key, `${project}: ${message}`);
    return NextResponse.json({ ok: true });
  }
  const r = await raiseAlert({ key, kind, project, message });
  return NextResponse.json({ ok: true, sent: r.sent });
}
