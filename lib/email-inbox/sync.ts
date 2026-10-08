// Sincronizarea incrementală după UID: pentru fiecare căsuță și folder ținem UIDVALIDITY și ultimul UID
// citit (EmailMailbox). Prima rulare aduce ultimele EMAIL_FIRST_SYNC_DAYS zile (implicit 30). Rulat de
// /api/cron/email-sync (la 2 minute) și de butonul „Verifică acum” din pagina E-mail. (Portat din print.)
// Pe server: EXAMINE (doar citire) + BODY.PEEK → nimic marcat citit, nimic mutat sau șters.
import type { ImapFlow, MessageStructureObject } from "imapflow";
import { convert } from "html-to-text";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import { prisma } from "@/lib/prisma";
import { getMailboxes, inboxLimits, type MailboxConfig } from "./config";
import type { Addr, MailFacts } from "./classify";
import { PARSE_OPTS, streamToBuffer, withImap, withReadOnlyFolder } from "./imap";
import { cleanId, ingestMail, type IncomingAttachment, type IngestResult } from "./ingest";

export type FolderSyncResult = { mailbox: string; folder: string; fetched: number; created: number; duplicates: number; failed: number; possibleLeads: number; skipped?: string; error?: string };
type SyncOpts = { now?: Date; limits?: Partial<ReturnType<typeof inboxLimits>>; onResult?: (r: IngestResult) => void };

const LOCK_MS = 5 * 60_000;

export function addrList(x: AddressObject | AddressObject[] | undefined): Addr[] {
    const out: Addr[] = [];
    const walk = (v: { address?: string; name?: string; group?: unknown[] }[]) => {
        for (const a of v) {
            if (a.address) out.push({ address: a.address.toLowerCase(), ...(a.name && { name: a.name }) });
            if (Array.isArray(a.group)) walk(a.group as typeof v);
        }
    };
    for (const o of Array.isArray(x) ? x : x ? [x] : []) walk(o.value || []);
    return out;
}

export function headerRecord(parsed: Pick<ParsedMail, "headerLines">): Record<string, string[]> {
    const rec: Record<string, string[]> = {};
    for (const { key, line } of parsed.headerLines || []) {
        const v = line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
        (rec[key.toLowerCase()] ||= []).push(v.slice(0, 2000));
    }
    return rec;
}

export const htmlToText = (html: string) =>
    convert(html, { wordwrap: false, selectors: [{ selector: "img", format: "skip" }, { selector: "a", options: { ignoreHref: true } }] })
        .replace(/[\u200B-\u200F\u2007\uFEFF\u034F]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

/** Mesaj descărcat întreg → IncomingMail. */
export function fromParsed(parsed: ParsedMail, ctx: { mb: MailboxConfig; folder: string; uid?: number; uidValidity?: bigint; direction: "in" | "out"; seen: boolean; internalDate?: Date }) {
    const html = typeof parsed.html === "string" ? parsed.html : null;
    const attachments: IncomingAttachment[] = parsed.attachments.map((a, idx) => ({
        idx,
        filename: a.filename || `fisier-${idx + 1}${a.contentType === "application/pdf" ? ".pdf" : ""}`,
        mime: a.contentType || "application/octet-stream",
        size: a.size || a.content?.length || 0,
        contentId: a.contentId || null,
        // „inline” = imagine mică afișată în corpul HTML (logo, semnătură). Pozele mari puse în corp (iPhone: grafica
        // clientului) și cele nefolosite în HTML sunt fișiere: apar la atașamente.
        inline: Boolean(a.contentId) && Boolean(html?.includes(`cid:${cleanId(a.contentId)}`)) && (a.size || a.content?.length || 0) < 300_000,
        content: a.content,
    }));
    const facts: MailFacts = {
        direction: ctx.direction,
        folder: ctx.folder,
        headers: headerRecord(parsed),
        from: addrList(parsed.from)[0] || null,
        replyTo: addrList(parsed.replyTo),
        to: addrList(parsed.to),
        cc: addrList(parsed.cc),
        subject: parsed.subject || "",
        text: parsed.text || (html ? htmlToText(html) : ""),
        attachments: attachments.map(({ filename, mime, size, inline }) => ({ filename, mime, size, inline })),
    };
    const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? String(parsed.references).split(/\s+/) : [];
    const messageId = cleanId(parsed.messageId) || `uid-${ctx.uid}.${ctx.uidValidity}.${ctx.folder}@${ctx.mb.address}`;
    return {
        mailboxAddress: ctx.mb.address,
        mailboxProject: ctx.mb.project,
        folder: ctx.folder,
        uid: ctx.uid,
        uidValidity: ctx.uidValidity,
        messageId,
        inReplyTo: parsed.inReplyTo || null,
        references: refs,
        facts,
        html,
        sentAt: parsed.date && !isNaN(parsed.date.getTime()) ? parsed.date : ctx.internalDate || new Date(),
        receivedAt: ctx.internalDate,
        seen: ctx.seen,
        attachments,
        source: "imap" as const,
    };
}

function leaves(node: MessageStructureObject | undefined, out: MessageStructureObject[] = []) {
    if (!node) return out;
    if (node.childNodes?.length) node.childNodes.forEach((c) => leaves(c, out));
    else out.push(node);
    return out;
}

/** Mesaj prea mare: antetele + textul; fișierele rămân pe server (descărcare la cerere după partea IMAP). */
async function fetchLarge(client: ImapFlow, uid: number, ctx: Parameters<typeof fromParsed>[1]) {
    const msg = await client.fetchOne(String(uid), { headers: true, bodyStructure: true }, { uid: true });
    if (!msg || !msg.headers) throw new Error("antetele nu s-au putut citi");
    const parsed = await simpleParser(Buffer.concat([msg.headers, Buffer.from("\r\n")]), PARSE_OPTS);
    const parts = leaves(msg.bodyStructure);
    const textPart = parts.find((p) => p.type === "text/plain" && p.disposition !== "attachment") || parts.find((p) => p.type === "text/html" && p.disposition !== "attachment");
    let text = "";
    if (textPart?.part) {
        const dl = await client.download(String(uid), textPart.part, { uid: true, maxBytes: 300_000 }).catch(() => null);
        if (dl?.content) text = (await streamToBuffer(dl.content).catch(() => Buffer.alloc(0))).toString("utf8");
        if (textPart.type === "text/html") text = htmlToText(text);
    }
    const inc = fromParsed({ ...parsed, text, html: false, attachments: [] } as ParsedMail, ctx);
    inc.attachments = parts
        .filter((p) => p.part && (p.disposition === "attachment" || !/^(text|multipart)\//.test(p.type)))
        .map((p) => ({
            partId: p.part,
            filename: p.dispositionParameters?.filename || p.parameters?.name || `fisier-${p.part}`,
            mime: p.type || "application/octet-stream",
            size: p.size || 0,
            contentId: p.id || null,
            inline: p.disposition === "inline" && Boolean(p.id),
        }));
    inc.facts.attachments = inc.attachments.map(({ filename, mime, size, inline }) => ({ filename, mime, size, inline }));
    inc.facts.text = text;
    return inc;
}

const isSentFolder = (mb: MailboxConfig, folder: string) => folder === mb.sentFolder || /(^|[./])sent( items| messages)?$/i.test(folder);

export async function syncFolder(client: ImapFlow, mb: MailboxConfig, folder: string, opts: SyncOpts = {}): Promise<FolderSyncResult> {
    const now = opts.now ?? new Date();
    const lim = { ...inboxLimits(), ...opts.limits };
    const res: FolderSyncResult = { mailbox: mb.address, folder, fetched: 0, created: 0, duplicates: 0, failed: 0, possibleLeads: 0 };
    const state = await prisma.emailMailbox.upsert({
        where: { address_folder: { address: mb.address, folder } },
        create: { address: mb.address, folder, label: mb.label },
        update: {},
    });
    // o singură sincronizare odată (cron + butonul din admin)
    const locked = await prisma.emailMailbox.updateMany({
        where: { id: state.id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
        data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
    });
    if (!locked.count) return { ...res, skipped: "altă sincronizare e în curs" };
    const errors: string[] = [];
    try {
        await withReadOnlyFolder(client, folder, async (info) => {
            const reset = state.uidValidity !== null && state.uidValidity !== info.uidValidity;
            let lastUid = reset ? 0 : state.lastUid;
            const first = lastUid === 0;
            const found = first
                ? await client.search({ since: new Date(now.getTime() - lim.firstSyncDays * 86_400_000) }, { uid: true })
                : await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
            const uids = (Array.isArray(found) ? found : []).filter((u) => u > lastUid).sort((a, b) => a - b).slice(0, lim.perRun);
            const meta: { uid: number; size: number; seen: boolean; internalDate?: Date }[] = [];
            if (uids.length) {
                for await (const m of client.fetch(uids.join(","), { uid: true, size: true, flags: true, internalDate: true }, { uid: true })) {
                    meta.push({ uid: m.uid, size: m.size || 0, seen: Boolean(m.flags?.has("\\Seen")), internalDate: m.internalDate ? new Date(m.internalDate) : undefined });
                }
            }
            meta.sort((a, b) => a.uid - b.uid);
            const direction = isSentFolder(mb, folder) ? "out" : "in";
            // mesajele de dinainte de prima sincronizare păstrează starea de pe server (citit / necitit);
            // cele venite după apar necitite aici, chiar dacă au fost deschise între timp pe telefon
            const importedOld = (d?: Date) => Boolean(d && d < state.createdAt);
            for (const m of meta) {
                res.fetched++;
                const ctx = { mb, folder, uid: m.uid, uidValidity: info.uidValidity, direction, seen: direction === "out" || (m.seen && importedOld(m.internalDate)), internalDate: m.internalDate } as const;
                try {
                    let inc;
                    if (m.size > lim.maxSourceBytes) inc = await fetchLarge(client, m.uid, ctx);
                    else {
                        const msg = await client.fetchOne(String(m.uid), { source: true }, { uid: true });
                        if (!msg || !msg.source) throw new Error("mesajul nu s-a putut citi");
                        inc = fromParsed(await simpleParser(msg.source, PARSE_OPTS), ctx);
                    }
                    const r = await ingestMail(inc);
                    opts.onResult?.(r);
                    if (r.status === "created") res.created++;
                    else res.duplicates++;
                    if (r.possibleLead) res.possibleLeads++;
                } catch (e) {
                    res.failed++;
                    errors.push(`UID ${m.uid}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`);
                }
                // progresul se salvează după fiecare mesaj (un mesaj stricat nu blochează coada)
                lastUid = m.uid;
                await prisma.emailMailbox.update({ where: { id: state.id }, data: { lastUid, uidValidity: info.uidValidity } });
            }
            if (!meta.length) await prisma.emailMailbox.update({ where: { id: state.id }, data: { uidValidity: info.uidValidity, ...(reset && { lastUid: 0 }) } });
        });
        await prisma.emailMailbox.update({
            where: { id: state.id },
            data: { lastSyncAt: now, lockedUntil: null, ...(errors.length ? { lastError: errors.join(" | ").slice(0, 1000), lastErrorAt: now } : { lastError: null }) },
        });
        if (errors.length) res.error = errors.join(" | ").slice(0, 500);
    } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
        await prisma.emailMailbox.update({ where: { id: state.id }, data: { lockedUntil: null, lastError: msg, lastErrorAt: now } }).catch(() => {});
        res.error = msg;
    }
    return res;
}

export async function syncMailbox(mb: MailboxConfig, opts: SyncOpts = {}): Promise<FolderSyncResult[]> {
    try {
        return await withImap(mb, async (client) => {
            const out: FolderSyncResult[] = [];
            for (const folder of mb.folders) out.push(await syncFolder(client, mb, folder, opts));
            return out;
        });
    } catch (e) {
        // conexiune / autentificare: notăm pe fiecare folder (fără parolă în mesaj)
        const msg = `Conectare IMAP eșuată: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`;
        const now = opts.now ?? new Date();
        for (const folder of mb.folders) {
            await prisma.emailMailbox.upsert({
                where: { address_folder: { address: mb.address, folder } },
                create: { address: mb.address, folder, label: mb.label, lastError: msg, lastErrorAt: now },
                update: { lastError: msg, lastErrorAt: now },
            }).catch(() => {});
        }
        return mb.folders.map((folder) => ({ mailbox: mb.address, folder, fetched: 0, created: 0, duplicates: 0, failed: 0, possibleLeads: 0, error: msg }));
    }
}

export async function syncAll(opts: SyncOpts & { mailboxes?: MailboxConfig[] } = {}) {
    const mailboxes = opts.mailboxes ?? getMailboxes();
    const results: FolderSyncResult[] = [];
    for (const mb of mailboxes) results.push(...(await syncMailbox(mb, opts)));
    return { mailboxes: mailboxes.length, results };
}
