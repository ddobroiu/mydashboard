// Citirile si actiunile inboxului (/dashboard/email, /api/email/*, /api/operator/*).
// Starea (citit, rezolvat, arhivat, „nu e spam”) e DOAR in baza noastra; pe serverul de e-mail nu se schimba nimic.
import { prisma } from "@/lib/prisma";
import { getAppStats } from "@/lib/app-stats";
import { getMailboxes } from "./config";
import { matchProject, MAIL_PROJECTS, isProjectKey } from "./projects";

export type EmailView = "inbox" | "leads" | "unread" | "awaiting" | "system" | "spam" | "done" | "archived" | "all";
export const EMAIL_VIEWS: EmailView[] = ["inbox", "leads", "unread", "awaiting", "system", "spam", "done", "archived", "all"];

/** Un client care a scris si nu a primit raspuns de atat timp intra la „De facut”. */
export const AWAITING_MS = 24 * 3600_000;
/** Conversatiile mai vechi nu mai sunt cerute la „De facut” (raman in inbox). */
const AWAITING_MAX_MS = 30 * 86_400_000;

export type ThreadRow = {
  id: string;
  subject: string;
  name: string;
  email: string | null;
  project: string | null;
  mailbox: string;
  category: string;
  tag: string | null;
  status: string;
  lastMessageAt: string;
  preview: string;
  lastDirection: string | null;
  unread: number;
  messageCount: number;
  hasAttachments: boolean;
  possibleLead: boolean;
  leadSignals: string[];
};

export type EmailAttachmentView = { id: string; filename: string; mime: string; size: number; inline: boolean };
export type EmailMessageView = {
  id: string;
  direction: "in" | "out";
  mailbox: string;
  fromName: string | null;
  fromEmail: string | null;
  to: { address: string; name?: string }[];
  cc: { address: string; name?: string }[];
  subject: string | null;
  text: string | null;
  html: string | null;
  hasRemoteImages: boolean;
  sentAt: string;
  source: string | null;
  error: string | null;
  leadSignals: string[];
  attachments: EmailAttachmentView[];
};
export type CustomerLinks = {
  payments: { project: string; amount: number; currency: string; at: string; provider: string }[];
  paymentsTotal: Record<string, number>;
  appActivity: { project: string; at: string; title: string; detail: string | null; amount: number | null; status: string | null }[];
  otherThreads: { id: string; subject: string; project: string | null; lastMessageAt: string }[];
};
export type ThreadDetail = {
  thread: ThreadRow & { customerPhone: string | null };
  messages: EmailMessageView[];
  customer: CustomerLinks;
};

/** Tabelele nu exista inca (migrarea neaplicata) → inbox gol, fara eroare. */
export const missingTable = (e: unknown) =>
  ["P2021", "P2022"].includes((e as { code?: string })?.code || "") || /does not exist/i.test(String((e as Error)?.message || ""));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function row(t: any): ThreadRow {
  return {
    id: t.id,
    subject: t.subject,
    name: t.customerName || t.customerEmail || "(necunoscut)",
    email: t.customerEmail,
    project: t.project,
    mailbox: t.mailboxAddress,
    category: t.category,
    tag: t.tag,
    status: t.status,
    lastMessageAt: new Date(t.lastMessageAt).toISOString(),
    preview: t.lastPreview || "",
    lastDirection: t.lastDirection,
    unread: t.unreadCount,
    messageCount: t.messageCount,
    hasAttachments: t.hasAttachments,
    possibleLead: t.possibleLead,
    leadSignals: t.leadSignals || [],
  };
}

/** Conversatii cu oameni, deschise, la care ultimul mesaj e al clientului si e mai vechi de 24 h. */
export function awaitingWhere(now = new Date()) {
  return {
    category: "inbox",
    status: "open",
    lastDirection: "in",
    lastMessageAt: { lt: new Date(now.getTime() - AWAITING_MS), gt: new Date(now.getTime() - AWAITING_MAX_MS) },
  };
}

export function viewWhere(view: EmailView, now = new Date()): Record<string, unknown> {
  switch (view) {
    case "leads":
      return { category: "inbox", possibleLead: true, status: "open" };
    case "unread":
      return { category: "inbox", unreadCount: { gt: 0 } };
    case "awaiting":
      return awaitingWhere(now);
    case "system":
      return { category: "system", status: { not: "archived" } };
    case "spam":
      return { category: { in: ["spam", "bulk"] } };
    case "done":
      return { status: "done" };
    case "archived":
      return { status: "archived" };
    case "all":
      return {};
    default:
      return { category: "inbox", status: "open" };
  }
}

export async function listThreads(opts: { view?: EmailView; project?: string; q?: string; take?: number; since?: Date }) {
  const q = (opts.q || "").trim();
  const where: Record<string, unknown> = {
    ...viewWhere(opts.view || "inbox"),
    ...(opts.project && { project: opts.project }),
    ...(opts.since && { lastMessageAt: { gte: opts.since } }),
    ...(q && {
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { customerEmail: { contains: q.toLowerCase() } },
        { customerName: { contains: q, mode: "insensitive" } },
        { lastPreview: { contains: q, mode: "insensitive" } },
        { messages: { some: { text: { contains: q, mode: "insensitive" } } } },
        { messages: { some: { attachments: { some: { filename: { contains: q, mode: "insensitive" } } } } } },
      ],
    }),
  };
  const list = await prisma.emailThread.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: Math.min(opts.take ?? 150, 300) });
  return list.map(row);
}

/** Pentru meniu, filtre si prima pagina. */
export async function counters() {
  const [unread, leads, awaiting, system, spam] = await Promise.all([
    prisma.emailThread.aggregate({ _sum: { unreadCount: true }, where: { category: "inbox", unreadCount: { gt: 0 } } }),
    prisma.emailThread.count({ where: viewWhere("leads") }),
    prisma.emailThread.count({ where: awaitingWhere() }),
    prisma.emailThread.aggregate({ _sum: { unreadCount: true }, where: { category: "system", unreadCount: { gt: 0 } } }),
    prisma.emailThread.aggregate({ _sum: { unreadCount: true }, where: { category: { in: ["spam", "bulk"] }, unreadCount: { gt: 0 } } }),
  ]);
  return {
    unread: unread._sum.unreadCount || 0,
    leads,
    awaiting,
    system: system._sum.unreadCount || 0,
    spam: spam._sum.unreadCount || 0,
  };
}

/** Pe aplicatie: necitite (oameni), posibili clienti deschisi, fara raspuns > 24 h, notificari necitite. */
export async function countersByProject() {
  const [unread, leads, awaiting, system] = await Promise.all([
    prisma.emailThread.groupBy({ by: ["project"], where: { category: "inbox", unreadCount: { gt: 0 } }, _sum: { unreadCount: true } }),
    prisma.emailThread.groupBy({ by: ["project"], where: viewWhere("leads"), _count: { _all: true } }),
    prisma.emailThread.groupBy({ by: ["project"], where: awaitingWhere(), _count: { _all: true } }),
    prisma.emailThread.groupBy({ by: ["project"], where: { category: "system", unreadCount: { gt: 0 } }, _sum: { unreadCount: true } }),
  ]);
  const out = new Map<string, { unread: number; leads: number; awaiting: number; system: number }>();
  const get = (k: string | null) => {
    const key = k || "";
    if (!out.has(key)) out.set(key, { unread: 0, leads: 0, awaiting: 0, system: 0 });
    return out.get(key)!;
  };
  for (const r of unread) get(r.project).unread = r._sum.unreadCount || 0;
  for (const r of leads) get(r.project).leads = r._count._all;
  for (const r of awaiting) get(r.project).awaiting = r._count._all;
  for (const r of system) get(r.project).system = r._sum.unreadCount || 0;
  return out;
}

/** Ultimele conversatii importante: posibili clienti si necitite de la oameni. */
export async function latestImportant(take = 6) {
  const list = await prisma.emailThread.findMany({
    where: { category: "inbox", status: "open", OR: [{ unreadCount: { gt: 0 } }, { possibleLead: true }] },
    orderBy: [{ lastMessageAt: "desc" }],
    take,
  });
  return list.map(row);
}

export async function syncStatus() {
  const rows = await prisma.emailMailbox.findMany({ orderBy: [{ address: "asc" }, { folder: "asc" }] });
  return {
    configured: getMailboxes().map((m) => ({ address: m.address, label: m.label, project: m.project ?? null, folders: m.folders })),
    state: rows.map((r) => ({
      address: r.address,
      folder: r.folder,
      lastSyncAt: r.lastSyncAt?.toISOString() || null,
      lastError: r.lastError,
      lastErrorAt: r.lastErrorAt?.toISOString() || null,
    })),
  };
}

/**
 * Clientul dupa adresa de e-mail: platile lui din mydashboard (Stripe/Oblio/comenzi, Transaction.customer),
 * ce apare despre el in cifrele trimise de aplicatie (/api/mydashboard/stats → recent) si celelalte conversatii.
 */
export async function customerLinks(email: string | null, threadProject: string | null, excludeThreadId?: string): Promise<CustomerLinks> {
  const empty: CustomerLinks = { payments: [], paymentsTotal: {}, appActivity: [], otherThreads: [] };
  const mail = String(email || "").trim().toLowerCase();
  if (!mail.includes("@")) return empty;
  const [tx, threads, projects] = await Promise.all([
    prisma.transaction.findMany({
      where: { customer: { equals: mail, mode: "insensitive" } },
      orderBy: { occurredAt: "desc" },
      take: 30,
      select: { amount: true, currency: true, occurredAt: true, provider: true, project: { select: { name: true } } },
    }),
    prisma.emailThread.findMany({
      where: { customerEmail: mail, ...(excludeThreadId && { id: { not: excludeThreadId } }) },
      orderBy: { lastMessageAt: "desc" },
      take: 10,
      select: { id: true, subject: true, project: true, lastMessageAt: true },
    }),
    prisma.project.findMany({ select: { name: true, domain: true } }),
  ]);
  const paymentsTotal: Record<string, number> = {};
  for (const t of tx) paymentsTotal[t.currency] = Math.round(((paymentsTotal[t.currency] || 0) + Number(t.amount)) * 100) / 100;

  const appActivity: CustomerLinks["appActivity"] = [];
  const p = matchProject(threadProject, projects);
  if (p) {
    const st = await getAppStats(p.name, p.domain).catch(() => null);
    if (st?.ok) {
      for (const r of st.stats.recent || []) {
        if (`${r.title} ${r.detail || ""}`.toLowerCase().includes(mail)) {
          appActivity.push({ project: p.name, at: r.at, title: r.title, detail: r.detail ?? null, amount: r.amount ?? null, status: r.status ?? null });
        }
      }
    }
  }
  return {
    payments: tx.map((t) => ({ project: t.project.name, amount: Number(t.amount), currency: t.currency, at: t.occurredAt.toISOString(), provider: t.provider })),
    paymentsTotal,
    appActivity: appActivity.slice(0, 10),
    otherThreads: threads.map((t) => ({ ...t, lastMessageAt: t.lastMessageAt.toISOString() })),
  };
}

export async function getThread(id: string, opts: { markRead?: boolean; withCustomer?: boolean } = {}): Promise<ThreadDetail | null> {
  const t = await prisma.emailThread.findUnique({ where: { id } });
  if (!t) return null;
  const msgs = await prisma.emailMessage.findMany({ where: { threadId: id }, orderBy: { sentAt: "asc" }, take: 200, include: { attachments: { orderBy: { idx: "asc" } } } });
  if (opts.markRead && t.unreadCount > 0) await prisma.emailThread.update({ where: { id }, data: { unreadCount: 0 } });
  const customer =
    opts.withCustomer !== false && t.category === "inbox"
      ? await customerLinks(t.customerEmail, t.project, t.id).catch(() => ({ payments: [], paymentsTotal: {}, appActivity: [], otherThreads: [] }))
      : { payments: [], paymentsTotal: {}, appActivity: [], otherThreads: [] };
  return {
    thread: { ...row(t), unread: opts.markRead ? 0 : t.unreadCount, customerPhone: t.customerPhone },
    messages: msgs.map((m) => {
      const byCid = new Map(m.attachments.filter((a) => a.contentId).map((a) => [a.contentId as string, a.id]));
      const html = m.html
        ? m.html.replace(/src="cid:([^"]+)"/gi, (_all, cid: string) => {
            const att = byCid.get(cid.replace(/^<|>$/g, ""));
            return att ? `src="/api/email/attachment/${att}?inline=1"` : 'src=""';
          })
        : null;
      return {
        id: m.id,
        direction: m.direction as "in" | "out",
        mailbox: m.mailboxAddress,
        fromName: m.fromName,
        fromEmail: m.fromEmail,
        to: (m.to as { address: string; name?: string }[] | null) || [],
        cc: (m.cc as { address: string; name?: string }[] | null) || [],
        subject: m.subject,
        text: m.text,
        html,
        hasRemoteImages: m.hasRemoteImages,
        sentAt: m.sentAt.toISOString(),
        source: m.source,
        error: m.error,
        leadSignals: m.leadSignals,
        attachments: m.attachments.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, inline: a.inline })),
      };
    }),
    customer,
  };
}

export async function setThreadStatus(id: string, status: "open" | "done" | "archived") {
  await prisma.emailThread.update({ where: { id }, data: { status, ...(status !== "open" && { unreadCount: 0 }) } });
}

export async function markUnread(id: string) {
  await prisma.emailThread.update({ where: { id }, data: { unreadCount: 1 } });
}

/** „Nu e spam” / „Muta la spam” (doar la noi; pe server mesajul ramane unde e). */
export async function setThreadCategory(id: string, category: "inbox" | "spam") {
  await prisma.emailThread.update({ where: { id }, data: { category, ...(category === "inbox" && { tag: null }) } });
}

export const projectName = (k: string | null) => (isProjectKey(k) ? MAIL_PROJECTS[k].name : k || "fără proiect");
