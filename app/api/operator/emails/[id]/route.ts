// GET /api/operator/emails/<id>: conversatia ca text (fara HTML), cu clientul (plati, activitate in aplicatie).
// Nu o marcheaza citita: robotul doar citeste.
import { json, emailRow, operatorDenied } from "@/lib/operator";
import { getThread, missingTable } from "@/lib/email-inbox/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const d = await getThread(id, { markRead: false });
    if (!d) return json({ error: "Conversația nu există" }, 404);
    return json({
      thread: { ...emailRow(d.thread), phone: d.thread.customerPhone },
      messages: d.messages.map((m) => ({
        direction: m.direction,
        mailbox: m.mailbox,
        from: m.fromEmail,
        fromName: m.fromName,
        to: m.to.map((a) => a.address),
        at: m.sentAt,
        subject: m.subject,
        text: (m.text || "").slice(0, 20_000),
        attachments: m.attachments.filter((a) => !a.inline).map((a) => ({ filename: a.filename, mime: a.mime, size: a.size })),
      })),
      customer: d.customer,
    });
  } catch (e) {
    if (missingTable(e)) return json({ error: "Inboxul nu e activ încă." }, 503);
    console.error("[operator/emails/id]", (e as Error)?.message);
    return json({ error: "Conversația nu s-a putut citi." }, 500);
  }
}
