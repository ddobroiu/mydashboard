// Salvarea unui mesaj: dedublare dupa Message-ID, legarea in conversatie (In-Reply-To / References, apoi acelasi
// client + acelasi subiect in 90 de zile), categoria, aplicatia si scorul „Posibil client”. (Portat din print.)
import { prisma } from "@/lib/prisma";
import { categorize, counterpart, detectProject, extractPhone, LEAD_THRESHOLD, normalizeSubject, preview, scoreLead, type Category, type MailFacts } from "./classify";
import type { MailProjectKey } from "./projects";
import { sanitizeEmailHtml } from "./sanitize";

export type IncomingAttachment = { idx?: number; partId?: string; filename: string; mime: string; size: number; contentId?: string | null; inline: boolean; content?: Buffer };

export type IncomingMail = {
  mailboxAddress: string;
  mailboxProject?: MailProjectKey;
  folder?: string;
  uid?: number;
  uidValidity?: bigint;
  messageId: string;
  inReplyTo?: string | null;
  references: string[];
  facts: MailFacts;
  html?: string | null;
  sentAt: Date;
  receivedAt?: Date;
  /** Importat ca citit (mesajele deja citite pe server la prima sincronizare; trimisele). */
  seen: boolean;
  attachments: IncomingAttachment[];
  source: "imap" | "dashboard";
  sendStatus?: string;
  error?: string;
};

export type IngestResult = { status: "created" | "duplicate"; messageId: string; threadId: string; category: Category; possibleLead: boolean; project: string | null };

export const cleanId = (id: string | null | undefined) => String(id || "").trim().replace(/^<|>$/g, "").trim().slice(0, 500);
const WINDOW_MS = 90 * 86_400_000;
const uniq = <T,>(a: T[]) => [...new Set(a)];

async function findThread(m: IncomingMail, customerEmail: string | null, normSubject: string): Promise<string | null> {
  const refs = uniq([m.inReplyTo, ...m.references].map(cleanId).filter(Boolean)).slice(-50);
  if (refs.length) {
    const hit = await prisma.emailMessage.findFirst({ where: { messageId: { in: refs } }, select: { threadId: true }, orderBy: { sentAt: "desc" } });
    if (hit) return hit.threadId;
  }
  if (customerEmail && normSubject.length >= 3) {
    const t = await prisma.emailThread.findFirst({
      where: { customerEmail, normSubject, lastMessageAt: { gt: new Date(m.sentAt.getTime() - WINDOW_MS) } },
      orderBy: { lastMessageAt: "desc" },
      select: { id: true },
    });
    if (t) return t.id;
  }
  return null;
}

export async function ingestMail(m: IncomingMail): Promise<IngestResult> {
  const messageId = cleanId(m.messageId);
  const f = m.facts;
  const project = detectProject(f, m.mailboxProject) ?? null;
  const { category, tag } = categorize(f);

  const existing = await prisma.emailMessage.findUnique({ where: { messageId }, select: { id: true, threadId: true, category: true } });
  if (existing) {
    // acelasi mesaj venit a doua oara (redirectionare dubla, alt folder, UIDVALIDITY nou): actualizam doar pozitia IMAP
    if (m.uid && m.folder && m.source === "imap") {
      await prisma.emailMessage.update({ where: { id: existing.id }, data: { uid: m.uid, uidValidity: m.uidValidity ?? null, folder: m.folder } }).catch(() => {});
    }
    return { status: "duplicate", messageId, threadId: existing.threadId, category: existing.category as Category, possibleLead: false, project };
  }

  const who = counterpart(f);
  const customerEmail = who?.address ? who.address.toLowerCase() : null;
  const normSubject = normalizeSubject(f.subject);
  const score = f.direction === "in" && category === "inbox" ? scoreLead(f) : { score: 0, signals: [] as string[] };
  const possibleLead = score.score >= LEAD_THRESHOLD;
  const clean = m.html ? sanitizeEmailHtml(m.html) : { html: null as string | null, hasRemoteImages: false };
  const unread = f.direction === "in" && !m.seen ? 1 : 0;
  const hasFiles = m.attachments.some((a) => !a.inline);
  const pv = preview(f.text) || (hasFiles ? `📎 ${m.attachments.filter((a) => !a.inline).map((a) => a.filename).join(", ")}` : "");
  const phone = f.direction === "in" ? extractPhone(f.text) : null;

  let threadId = await findThread(m, customerEmail, normSubject);
  if (threadId) {
    const t = await prisma.emailThread.findUnique({ where: { id: threadId } });
    if (t) {
      const newer = m.sentAt >= t.lastMessageAt;
      // un mesaj nou de la client redeschide conversatia rezolvata/arhivata
      const reopen = f.direction === "in" && unread > 0 && t.status !== "open" && category === "inbox";
      await prisma.emailThread.update({
        where: { id: t.id },
        data: {
          ...(newer && { lastMessageAt: m.sentAt, lastPreview: pv, lastDirection: f.direction }),
          unreadCount: { increment: unread },
          messageCount: { increment: 1 },
          ...(hasFiles && { hasAttachments: true }),
          ...(possibleLead && !t.possibleLead && { possibleLead: true }),
          ...(score.score > t.leadScore && { leadScore: score.score }),
          ...(score.signals.length && { leadSignals: uniq([...t.leadSignals, ...score.signals]).slice(0, 14) }),
          ...(f.direction === "in" && category === "inbox" && t.category !== "inbox" && { category, tag: null }),
          ...(!t.customerName && who?.name && { customerName: who.name.slice(0, 120) }),
          ...(!t.customerPhone && phone && { customerPhone: phone }),
          ...(!t.project && project && { project }),
          ...(reopen && { status: "open" }),
        },
      });
    } else threadId = null;
  }
  if (!threadId) {
    const t = await prisma.emailThread.create({
      data: {
        mailboxAddress: m.mailboxAddress,
        subject: (f.subject || "(fără subiect)").slice(0, 300),
        normSubject,
        project,
        category,
        tag,
        customerEmail,
        customerName: who?.name ? who.name.slice(0, 120) : null,
        customerPhone: phone,
        lastMessageAt: m.sentAt,
        lastPreview: pv,
        lastDirection: f.direction,
        unreadCount: unread,
        messageCount: 1,
        hasAttachments: hasFiles,
        possibleLead,
        leadScore: score.score,
        leadSignals: score.signals.slice(0, 14),
      },
    });
    threadId = t.id;
  }

  let created;
  try {
    created = await prisma.emailMessage.create({
      data: {
        threadId,
        mailboxAddress: m.mailboxAddress,
        folder: m.folder ?? null,
        uid: m.uid ?? null,
        uidValidity: m.uidValidity ?? null,
        direction: f.direction,
        messageId,
        inReplyTo: cleanId(m.inReplyTo) || null,
        references: uniq(m.references.map(cleanId).filter(Boolean)).slice(-50),
        fromEmail: f.from?.address?.toLowerCase() || null,
        fromName: f.from?.name?.slice(0, 200) || null,
        replyTo: f.replyTo[0]?.address?.toLowerCase() || null,
        to: f.to.slice(0, 50),
        cc: f.cc.slice(0, 50),
        subject: f.subject.slice(0, 500),
        project,
        category,
        text: f.text.slice(0, 200_000),
        html: clean.html ? clean.html.slice(0, 1_000_000) : null,
        hasRemoteImages: clean.hasRemoteImages,
        leadScore: score.score,
        leadSignals: score.signals,
        sentAt: m.sentAt,
        receivedAt: m.receivedAt ?? null,
        source: m.source,
        sendStatus: m.sendStatus ?? null,
        error: m.error ?? null,
      },
      select: { id: true },
    });
  } catch (e) {
    // aceeasi cheie scrisa intre timp de alta rulare: e duplicat
    if ((e as { code?: string })?.code === "P2002") {
      const ex = await prisma.emailMessage.findUnique({ where: { messageId }, select: { threadId: true } });
      if (ex) return { status: "duplicate", messageId, threadId: ex.threadId, category, possibleLead: false, project };
    }
    throw e;
  }

  if (m.attachments.length) {
    await prisma.emailAttachment.createMany({
      data: m.attachments.slice(0, 60).map((a) => ({
        messageId: created.id,
        idx: a.idx ?? null,
        partId: a.partId ?? null,
        filename: (a.filename || "fisier").slice(0, 200),
        mime: (a.mime || "application/octet-stream").slice(0, 120),
        size: a.size || 0,
        contentId: a.contentId ? cleanId(a.contentId) : null,
        inline: a.inline,
      })),
    });
  }
  return { status: "created", messageId, threadId, category, possibleLead, project };
}
