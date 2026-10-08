// Raspuns din mydashboard: pleaca DIN ACEEASI CASUTA in care a venit mesajul clientului (ex. contact@bazadate.ro),
// prin SMTP-ul ei (gratuit, fara Resend), cu In-Reply-To si References ca sa ramana in aceeasi conversatie.
// Apoi copia se pune in „Trimise” al aceleiasi casute (IMAP APPEND in INBOX.Sent). (Portat din print.)
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { prisma } from "@/lib/prisma";
import { getMailboxes, type MailboxConfig } from "./config";
import { findSentFolder, withImap } from "./imap";
import { ingestMail } from "./ingest";
import { isProjectKey, MAIL_PROJECTS } from "./projects";
import { textToHtml } from "./sanitize";

type SmtpLike = { sendMail: (p: Record<string, unknown>) => Promise<{ messageId?: string }> };
export type SendDeps = {
  smtp?: (mb: MailboxConfig) => SmtpLike;
  mailboxes?: MailboxConfig[];
  /** false = nu pune copia in „Trimise” (teste fara IMAP). */
  append?: boolean;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const domain = (a: string) => a.toLowerCase().split("@")[1] || "";

function smtpFor(mb: MailboxConfig): SmtpLike {
  return nodemailer.createTransport({
    host: mb.smtpHost || mb.imapHost,
    port: mb.smtpPort || 465,
    secure: mb.smtpSecure ?? (mb.smtpPort || 465) === 465,
    auth: { user: mb.user, pass: mb.pass },
    ...(mb.tlsInsecure && { tls: { rejectUnauthorized: false } }),
    connectionTimeout: 20_000,
  });
}

export async function buildRaw(mail: Record<string, unknown>): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => new MailComposer(mail as any).compile().build((err, msg) => (err ? reject(err) : resolve(msg))));
}

/** Casuta prin care raspundem: cea in care a venit ultimul mesaj al clientului (altfel casuta conversatiei). */
export function pickMailbox(inboundMailbox: string | null | undefined, threadMailbox: string, mailboxes: MailboxConfig[]): MailboxConfig | null {
  return mailboxes.find((m) => m.address === inboundMailbox) || mailboxes.find((m) => m.address === threadMailbox) || null;
}

export async function sendReply(threadId: string, body: string, deps: SendDeps = {}) {
  const text = body.trim().slice(0, 20_000);
  if (!text) throw new Error("Scrie un mesaj.");
  const thread = await prisma.emailThread.findUnique({ where: { id: threadId } });
  if (!thread) throw new Error("Conversația nu există");
  if (!thread.customerEmail) throw new Error("Conversația nu are adresa clientului.");
  const mailboxes = deps.mailboxes ?? getMailboxes();

  const last =
    (await prisma.emailMessage.findFirst({ where: { threadId, direction: "in" }, orderBy: { sentAt: "desc" } })) ||
    (await prisma.emailMessage.findFirst({ where: { threadId }, orderBy: { sentAt: "desc" } }));
  const mb = pickMailbox(last?.direction === "in" ? last.mailboxAddress : null, thread.mailboxAddress, mailboxes);
  if (!mb) throw new Error(`Căsuța ${last?.mailboxAddress || thread.mailboxAddress} nu e configurată (MAILBOXES_JSON).`);
  const project = thread.project || mb.project || null;
  const name = isProjectKey(project) && project === mb.project ? MAIL_PROJECTS[project].name : mb.label;
  const fromAddr = mb.address;
  const from = `${name} <${fromAddr}>`;

  const subject = /^\s*(re|răspuns)\s*:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  const references = last ? [...last.references, last.messageId].slice(-20) : [];
  const messageId = `${randomUUID()}@${domain(fromAddr)}`;
  const when = last ? last.sentAt.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" }) : "";
  const quoted = last?.text ? `\n\nPe ${when}, ${last.fromName || last.fromEmail} a scris:\n${last.text.split(/\r?\n/).slice(0, 80).map((l) => `> ${l}`).join("\n")}` : "";
  const fullText = `${text}${quoted}`;
  const html = `${textToHtml(text)}${last?.text ? `<br><div style="color:#555">Pe ${esc(when)}, ${esc(last.fromName || last.fromEmail || "")} a scris:</div><blockquote style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex;color:#555;white-space:pre-wrap">${esc(last.text.slice(0, 8000))}</blockquote>` : ""}`;
  const inReplyTo = last ? `<${last.messageId}>` : undefined;
  const refHeader = references.map((r) => `<${r}>`).join(" ");
  const now = new Date();
  const raw = await buildRaw({ from, to: thread.customerEmail, subject, text: fullText, html, messageId: `<${messageId}>`, inReplyTo, references: refHeader || undefined, date: now });

  try {
    await (deps.smtp ?? smtpFor)(mb).sendMail({ envelope: { from: mb.address, to: [thread.customerEmail] }, raw });
  } catch (e) {
    throw new Error(`Mesajul nu a plecat: ${(e instanceof Error ? e.message : "eroare SMTP").slice(0, 200)}`);
  }

  // copia in „Trimise” pe server (doar adaugare; daca nu merge, mesajul a plecat oricum)
  let appendError: string | undefined;
  if (deps.append !== false) {
    try {
      await withImap(mb, async (c) => {
        const folder = await findSentFolder(c, mb.sentFolder);
        if (!folder) throw new Error("folderul Trimise nu există");
        await c.append(folder, raw, ["\\Seen"], now);
      });
    } catch (e) {
      appendError = `Nu s-a salvat în Trimise: ${(e instanceof Error ? e.message : "eroare").slice(0, 120)}`;
    }
  }

  const r = await ingestMail({
    mailboxAddress: mb.address,
    mailboxProject: mb.project,
    messageId,
    inReplyTo: last?.messageId ?? null,
    references,
    facts: {
      direction: "out",
      headers: {},
      from: { address: fromAddr, name },
      replyTo: [],
      to: [{ address: thread.customerEmail, ...(thread.customerName && { name: thread.customerName }) }],
      cc: [],
      subject,
      text: fullText,
      attachments: [],
    },
    html,
    sentAt: now,
    seen: true,
    attachments: [],
    source: "dashboard",
    sendStatus: "sent",
    error: appendError,
  });
  if (r.threadId !== threadId) {
    await prisma.emailMessage.update({ where: { messageId }, data: { threadId } });
    if (r.status === "created") await prisma.emailThread.deleteMany({ where: { id: r.threadId, messages: { none: {} } } });
  }
  await prisma.emailThread.update({ where: { id: threadId }, data: { unreadCount: 0, lastDirection: "out", lastMessageAt: now, lastPreview: text.slice(0, 180) } });
  return { ok: true, from, appendError };
}
