// Conversatia (mesaje, atasamente, clientul); o marcheaza citita DOAR la noi. POST: reply | status | unread | category.
import { NextRequest, NextResponse } from "next/server";
import { getThread, markUnread, missingTable, setThreadCategory, setThreadStatus } from "@/lib/email-inbox/admin";
import { emailApiDenied } from "@/lib/email-inbox/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const d = await emailApiDenied();
  if (d) return d;
  const { id } = await params;
  try {
    const detail = await getThread(id, { markRead: req.nextUrl.searchParams.get("peek") !== "1" });
    if (!detail) return NextResponse.json({ error: "Conversația nu există" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    if (missingTable(e)) return NextResponse.json({ error: "Inboxul nu e activ încă (migrarea nu e aplicată)." }, { status: 503 });
    return NextResponse.json({ error: "Nu am putut încărca conversația." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const d = await emailApiDenied();
  if (d) return d;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.action === "reply") {
      const { sendReply } = await import("@/lib/email-inbox/send");
      return NextResponse.json(await sendReply(id, String(body.text || "")));
    }
    if (body?.action === "status" && ["open", "done", "archived"].includes(body.status)) {
      await setThreadStatus(id, body.status);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "unread") {
      await markUnread(id);
      return NextResponse.json({ ok: true });
    }
    if (body?.action === "category" && ["inbox", "spam"].includes(body.category)) {
      await setThreadCategory(id, body.category);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Acțiune necunoscută" }, { status: 400 });
  } catch (e) {
    if (missingTable(e)) return NextResponse.json({ error: "Inboxul nu e activ încă (migrarea nu e aplicată)." }, { status: 503 });
    return NextResponse.json({ error: (e instanceof Error ? e.message : "Eroare").slice(0, 300) }, { status: 502 });
  }
}
