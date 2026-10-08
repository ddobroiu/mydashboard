// „De facut”: lista calculata (nu se salveaza nimic) din
//   1. alertele active (site picat, credite, erori), explicate pe intelesul proprietarului;
//   2. clientii care au scris si nu au primit raspuns de peste 24 de ore (posibilii clienti primii);
//   3. casutele de e-mail care nu se pot citi.
// Folosita pe prima pagina si de robotul-operator (/api/operator/tasks). Doar aplicatiile (fara print si 3D).
import { prisma } from "@/lib/prisma";
import { explainAlert, NOT_LOCAL_ALERT, SEVERITY_ORDER, type Severity } from "@/lib/alert-explain";
import { awaitingWhere, missingTable } from "@/lib/email-inbox/admin";
import { getMailboxes } from "@/lib/email-inbox/config";
import { projectKeyOf, projectLabel } from "@/lib/email-inbox/projects";

export type Task = {
  id: string;
  kind: "alert" | "email" | "mailbox";
  severity: Severity;
  project: string | null;
  title: string;
  detail: string;
  action: string;
  href: string;
  at: string;
  ageHours: number;
};

/** Alertele care tin de aplicatii (sau generale); alertele site-urilor de print / 3D nu intra aici. */
export const isAppAlert = (project: string | null) => !project || Boolean(projectKeyOf(project));

export async function activeAppAlerts() {
  const rows = await prisma.alertState.findMany({ where: { active: true, ...NOT_LOCAL_ALERT }, orderBy: { updatedAt: "desc" }, take: 200 });
  return rows
    .filter((a) => isAppAlert(a.project))
    .map((a) => {
      const e = explainAlert(a);
      return { ...a, projectKey: projectKeyOf(a.project) ?? null, e };
    });
}

export async function getTasks(now = new Date()): Promise<{ tasks: Task[]; emailReady: boolean }> {
  const hours = (d: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / 3600_000));
  const tasks: Task[] = [];

  for (const a of await activeAppAlerts()) {
    tasks.push({
      id: `alert:${a.key}`,
      kind: "alert",
      severity: a.e.severity,
      project: a.projectKey,
      title: `${a.projectKey ? projectLabel(a.projectKey) : a.project ?? "general"}: ${a.e.title}`,
      detail: a.e.what,
      action: a.e.action,
      href: "/dashboard/alerte",
      at: a.createdAt.toISOString(),
      ageHours: hours(a.createdAt),
    });
  }

  let emailReady = true;
  try {
    const [threads, boxes] = await Promise.all([
      prisma.emailThread.findMany({ where: awaitingWhere(now), orderBy: { lastMessageAt: "asc" }, take: 50 }),
      prisma.emailMailbox.findMany({ where: { lastError: { not: null } } }),
    ]);
    for (const t of threads) {
      const age = hours(t.lastMessageAt);
      tasks.push({
        id: `email:${t.id}`,
        kind: "email",
        severity: t.possibleLead || age >= 72 ? "Important" : "Mic",
        project: t.project,
        title: `Răspunde lui ${t.customerName || t.customerEmail || "client"}${t.project ? ` (${projectLabel(t.project)})` : ""}: ${t.subject}`,
        detail: `${t.possibleLead ? `Posibil client (${t.leadSignals.slice(0, 4).join(", ")}). ` : ""}Fără răspuns de ${age >= 48 ? `${Math.floor(age / 24)} zile` : `${age} ore`}. ${t.lastPreview || ""}`.trim(),
        action: "Răspunde din pagina E-mail sau marchează „Rezolvat” dacă nu e nevoie de răspuns.",
        href: `/dashboard/email?id=${t.id}`,
        at: t.lastMessageAt.toISOString(),
        ageHours: age,
      });
    }
    const configured = new Set(getMailboxes().map((m) => m.address));
    const seen = new Set<string>();
    for (const b of boxes) {
      if (!configured.has(b.address) || seen.has(b.address)) continue;
      seen.add(b.address);
      tasks.push({
        id: `mailbox:${b.address}`,
        kind: "mailbox",
        severity: "Important",
        project: projectKeyOf(b.address.split("@")[1]) ?? null,
        title: `Căsuța ${b.address} nu se poate citi`,
        detail: (b.lastError || "").slice(0, 200),
        action: "Verifică parola căsuței în MAILBOXES_JSON sau dacă serverul de e-mail merge.",
        href: "/dashboard/email",
        at: (b.lastErrorAt || b.updatedAt).toISOString(),
        ageHours: hours(b.lastErrorAt || b.updatedAt),
      });
    }
  } catch (e) {
    if (!missingTable(e)) throw e;
    emailReady = false;
  }

  const kindOrder = { alert: 0, mailbox: 1, email: 2 } as const;
  tasks.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      kindOrder[a.kind] - kindOrder[b.kind] ||
      b.ageHours - a.ageHours,
  );
  return { tasks, emailReady };
}
