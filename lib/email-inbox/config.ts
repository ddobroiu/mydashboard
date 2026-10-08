// Casutele de e-mail ale aplicatiilor, din MAILBOXES_JSON (IMAP pentru citire, SMTP pentru raspuns).
// Fiecare domeniu are casuta pe serverul lui (mail.<domeniu>). Daca toate adresele sunt redirectionate spre una
// singura, ajunge o singura casuta: aplicatia se deduce din antete (classify.ts → detectProject).
import { isProjectKey, projectOfAddress, type MailProjectKey } from "./projects";

export type MailboxConfig = {
  label: string;
  address: string;
  imapHost: string;
  imapPort: number;
  smtpHost?: string;
  smtpPort?: number;
  user: string;
  pass: string;
  /** Folderele citite (implicit ["INBOX"]); „INBOX.Sent” aduce si raspunsurile date din alt program de e-mail. */
  folders: string[];
  /** Unde se salveaza raspunsurile trimise din mydashboard. Implicit: folderul \Sent gasit pe server. */
  sentFolder?: string;
  /** Aplicatia casutei (daca antetele nu spun alta); implicit dupa domeniul adresei. */
  project?: MailProjectKey;
  imapSecure?: boolean;
  smtpSecure?: boolean;
  /** Doar daca certificatul serverului de e-mail e invalid: nu-l mai verifica. */
  tlsInsecure?: boolean;
};

/** Citeste MAILBOXES_JSON; intrarile incomplete (fara parola) sunt ignorate, fara sa afiseze parole. */
export function getMailboxes(env: NodeJS.ProcessEnv = process.env): MailboxConfig[] {
  const raw = String(env.MAILBOXES_JSON || "").trim();
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    console.error("[email-inbox] MAILBOXES_JSON nu e JSON valid");
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .map((m: Record<string, unknown>): MailboxConfig | null => {
      const address = String(m?.address || "").trim().toLowerCase();
      const imapHost = String(m?.imapHost || "").trim();
      const pass = String(m?.pass ?? "");
      if (!address || !imapHost || !pass) return null;
      const folders = Array.isArray(m.folders) && m.folders.length ? m.folders.map(String).slice(0, 5) : ["INBOX"];
      const project = isProjectKey(m.project) ? m.project : projectOfAddress(address);
      return {
        label: String(m.label || address),
        address,
        imapHost,
        imapPort: Number(m.imapPort) || 993,
        smtpHost: m.smtpHost ? String(m.smtpHost) : undefined,
        smtpPort: Number(m.smtpPort) || 465,
        user: String(m.user || address),
        pass,
        folders,
        sentFolder: m.sentFolder ? String(m.sentFolder) : undefined,
        ...(project && { project }),
        ...(typeof m.imapSecure === "boolean" && { imapSecure: m.imapSecure }),
        ...(typeof m.smtpSecure === "boolean" && { smtpSecure: m.smtpSecure }),
        ...(m.tlsInsecure === true && { tlsInsecure: true }),
      };
    })
    .filter((m): m is MailboxConfig => Boolean(m));
}

const num = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d);
export const inboxLimits = (env: NodeJS.ProcessEnv = process.env) => ({
  /** Prima sincronizare: cate zile in urma. */
  firstSyncDays: num(env.EMAIL_FIRST_SYNC_DAYS, 30),
  /** Cate mesaje noi pe rulare si pe folder (restul la urmatoarea rulare). */
  perRun: num(env.EMAIL_SYNC_BATCH, 60),
  /** Mesajele mai mari nu se descarca intregi (doar antetele + textul; fisierele la cerere). */
  maxSourceBytes: num(env.EMAIL_MAX_MESSAGE_MB, 30) * 1024 * 1024,
});
