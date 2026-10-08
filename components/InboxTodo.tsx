import Link from "next/link";
import { ArrowRight, CheckCircle2, Inbox, ListTodo, Sparkles } from "lucide-react";
import { countersByProject, latestImportant, missingTable } from "@/lib/email-inbox/admin";
import { projectLabel } from "@/lib/email-inbox/projects";
import { getTasks, type Task } from "@/lib/tasks";

const SEV: Record<Task["severity"], string> = {
  Urgent: "bg-red-600 text-white",
  Important: "bg-orange-500 text-white",
  Mic: "bg-gray-500 text-white",
};

function ago(iso: string) {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600_000);
  if (h < 1) return "acum";
  if (h < 48) return `acum ${h} h`;
  return `acum ${Math.floor(h / 24)} zile`;
}

// Prima pagina: caseta „Inbox” (necitite pe aplicatie, ultimele mesaje importante) + lista „De facut”
export default async function InboxTodo() {
  let ready = true;
  let byProject = new Map<string, { unread: number; leads: number; awaiting: number; system: number }>();
  let important: Awaited<ReturnType<typeof latestImportant>> = [];
  try {
    [byProject, important] = await Promise.all([countersByProject(), latestImportant(5)]);
  } catch (e) {
    if (!missingTable(e)) throw e;
    ready = false;
  }
  const { tasks } = await getTasks();
  const rows = [...byProject.entries()].filter(([, v]) => v.unread + v.leads + v.awaiting > 0).sort((a, b) => b[1].unread - a[1].unread);
  const unread = rows.reduce((s, [, v]) => s + v.unread, 0);

  return (
    <section className="grid gap-3 lg:grid-cols-2">
      <div className="card space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Inbox size={18} /> Inbox {unread > 0 && <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-white">{unread} necitite</span>}
          </h2>
          <Link href="/dashboard/email" className="flex items-center gap-1 text-sm text-accent">
            Deschide <ArrowRight size={14} />
          </Link>
        </div>
        {!ready ? (
          <p className="text-sm text-text-3">Inboxul nu e activ încă (lipsește migrarea bazei de date).</p>
        ) : rows.length === 0 && important.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-good"><CheckCircle2 size={16} /> Niciun mesaj necitit de la clienți.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {rows.map(([k, v]) => (
                <Link key={k || "-"} href={`/dashboard/email${k ? `?project=${k}` : ""}`} className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-accent">
                  <span className="font-medium">{projectLabel(k) || "fără aplicație"}</span>
                  {v.unread > 0 && <span className="ml-1 text-accent">{v.unread} necitite</span>}
                  {v.leads > 0 && <span className="ml-1 text-warn">{v.leads} posibili clienți</span>}
                  {v.awaiting > 0 && <span className="ml-1 text-bad">{v.awaiting} fără răspuns</span>}
                </Link>
              ))}
            </div>
            <ul className="divide-y divide-border">
              {important.map((t) => (
                <li key={t.id}>
                  <Link href={`/dashboard/email?id=${t.id}`} className="block py-2 hover:opacity-80">
                    <span className="flex items-baseline gap-2 text-sm">
                      <span className={`truncate ${t.unread ? "font-semibold" : ""}`}>{t.name}</span>
                      {t.project && <span className="shrink-0 text-xs text-text-3">{projectLabel(t.project)}</span>}
                      <span className="ml-auto shrink-0 text-xs text-text-3">{ago(t.lastMessageAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-text-2">
                      {t.possibleLead && <Sparkles size={12} className="shrink-0 text-warn" />}
                      <span className="truncate">{t.subject} · {t.preview}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card space-y-3 p-4">
        <h2 className="flex items-center gap-2 font-semibold">
          <ListTodo size={18} /> De făcut {tasks.length > 0 && <span className="rounded-full bg-bad-bg px-2 py-0.5 text-xs text-bad">{tasks.length}</span>}
        </h2>
        {tasks.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-good"><CheckCircle2 size={16} /> Nimic de făcut acum.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.slice(0, 8).map((t) => (
              <li key={t.id}>
                <Link href={t.href} className="block rounded-lg border border-border px-3 py-2 hover:border-accent">
                  <span className="flex items-baseline gap-2 text-sm">
                    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEV[t.severity]}`}>{t.severity}</span>
                    <span className="min-w-0 truncate font-medium">{t.title}</span>
                    <span className="ml-auto shrink-0 text-xs text-text-3">{ago(t.at)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-2">{t.action}</span>
                </Link>
              </li>
            ))}
            {tasks.length > 8 && <li className="text-xs text-text-3">și încă {tasks.length - 8}…</li>}
          </ul>
        )}
      </div>
    </section>
  );
}
