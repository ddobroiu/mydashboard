// Lista conversatiilor pentru /dashboard/email (+ POST = „Verifica acum”, aceeasi sincronizare ca la cron).
import { NextRequest, NextResponse } from "next/server";
import { counters, EMAIL_VIEWS, listThreads, missingTable, syncStatus, type EmailView } from "@/lib/email-inbox/admin";
import { emailApiDenied } from "@/lib/email-inbox/guard";
import { isProjectKey } from "@/lib/email-inbox/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const d = await emailApiDenied();
  if (d) return d;
  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get("count") === "1") return NextResponse.json(await counters());
    const view = (EMAIL_VIEWS.includes(sp.get("view") as EmailView) ? sp.get("view") : "inbox") as EmailView;
    const project = sp.get("project");
    const [threads, count, sync] = await Promise.all([
      listThreads({ view, project: isProjectKey(project) ? project : undefined, q: sp.get("q") || "" }),
      counters(),
      syncStatus(),
    ]);
    return NextResponse.json({ threads, counters: count, sync });
  } catch (e) {
    if (missingTable(e)) return NextResponse.json({ threads: [], counters: { unread: 0, leads: 0, awaiting: 0, system: 0, spam: 0 }, notReady: true });
    return NextResponse.json({ error: "Nu am putut încărca mesajele." }, { status: 500 });
  }
}

export async function POST() {
  const d = await emailApiDenied();
  if (d) return d;
  try {
    const { syncAll } = await import("@/lib/email-inbox/sync");
    return NextResponse.json(await syncAll());
  } catch (e) {
    if (missingTable(e)) return NextResponse.json({ error: "Inboxul nu e activ încă (migrarea nu e aplicată)." }, { status: 503 });
    return NextResponse.json({ error: (e instanceof Error ? e.message : "Eroare").slice(0, 200) }, { status: 500 });
  }
}
