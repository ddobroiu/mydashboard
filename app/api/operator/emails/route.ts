// GET /api/operator/emails?unread=1&project=bazadate&view=leads&since=7d&q=factura&limit=50
// view: inbox | leads | unread | awaiting (fara raspuns > 24 h) | system | spam | done | archived | all. Fara corpul mesajelor.
import { emailsList, json, operatorDenied, parseSince } from "@/lib/operator";
import { EMAIL_VIEWS, missingTable } from "@/lib/email-inbox/admin";
import { isProjectKey } from "@/lib/email-inbox/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const view = sp.get("view");
  const project = sp.get("project");
  try {
    const emails = await emailsList({
      unread: sp.get("unread") === "1" || sp.get("unread") === "true",
      view: view && (EMAIL_VIEWS as string[]).includes(view) ? view : undefined,
      project: isProjectKey(project) ? project : undefined,
      since: sp.get("since") ? parseSince(sp.get("since")) : undefined,
      q: sp.get("q")?.slice(0, 100) || undefined,
      limit: Number(sp.get("limit")) || 50,
    });
    return json({ count: emails.length, emails });
  } catch (e) {
    if (missingTable(e)) return json({ count: 0, emails: [], notReady: true });
    console.error("[operator/emails]", (e as Error)?.message);
    return json({ error: "E-mailurile nu s-au putut citi." }, 500);
  }
}
