import crypto from "crypto";
import { NextResponse } from "next/server";
import { alertToken, raiseAlert, resolveAlert, type AlertKind } from "@/lib/alerts";
import { isLocalDevAlert } from "@/lib/alert-explain";

export const dynamic = "force-dynamic";

// Aplicatiile anunta aici o problema (ex. credite terminate la Anthropic) sau ca s-a rezolvat.
// POST { project, kind: "credits" | "error", key?, message, resolved?, env? } cu antetul x-alert-token.
// env = "development" / "local" (sau o cale locala in mesaj, ex. C:\Users\... ori .next/dev) = test de pe calculatorul unui programator: ignorat, fara e-mail.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { project?: string; kind?: string; key?: string; message?: string; resolved?: boolean; env?: string }
    | null;
  const project = String(body?.project || "").slice(0, 60);
  const token = req.headers.get("x-alert-token") || "";
  const expected = project ? alertToken(project) : "";
  if (!project || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const kind: AlertKind = body?.kind === "credits" ? "credits" : "error";
  const message = String(body?.message || "").slice(0, 1000) || "Fără detalii.";
  const env = typeof body?.env === "string" ? body.env.slice(0, 20) : null;
  // testele locale au cheia lor, ca sa nu acopere (sau sa rezolve) aceeasi alerta venita de pe site-ul real
  const local = isLocalDevAlert(message, env);
  const key = `${local ? "local:" : ""}${kind}:${project}:${String(body?.key || "general").slice(0, 80)}`;
  if (body?.resolved) {
    await resolveAlert(key, `${project}: ${message}`);
    return NextResponse.json({ ok: true });
  }
  const r = await raiseAlert({ key, kind, project, message, env });
  return NextResponse.json({ ok: true, sent: r.sent, ...(r.ignored && { ignored: "test local" }) });
}
