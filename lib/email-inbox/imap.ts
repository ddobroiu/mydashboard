// Conexiunea IMAP (imapflow). Folderele se deschid DOAR în citire (EXAMINE) și conținutul se citește cu
// BODY.PEEK: pe server nu se marchează, nu se mută și nu se șterge nimic. Singura scriere e APPEND în
// folderul „Trimise” pentru răspunsurile date din mydashboard. (Portat din print/shopprint-main.)
import { ImapFlow } from "imapflow";
import type { MailboxConfig } from "./config";

/** mailparser: imaginile cid: rămân cid: (le servește ruta de atașamente), fără conversii inutile. */
export const PARSE_OPTS = { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true } as const;

export function imapClient(mb: MailboxConfig) {
    return new ImapFlow({
        host: mb.imapHost,
        port: mb.imapPort,
        secure: mb.imapSecure ?? mb.imapPort === 993,
        auth: { user: mb.user, pass: mb.pass },
        ...(mb.tlsInsecure && { tls: { rejectUnauthorized: false } }),
        logger: false,
        disableAutoIdle: true,
        connectionTimeout: 20_000,
        greetingTimeout: 15_000,
        socketTimeout: 120_000,
    });
}

export async function withImap<T>(mb: MailboxConfig, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const client = imapClient(mb);
    client.on("error", () => { /* tratat de promisiunea de mai jos; fără date sensibile în loguri */ });
    await client.connect();
    try {
        return await fn(client);
    } finally {
        await client.logout().catch(() => client.close());
    }
}

/** Deschide folderul doar pentru citire (EXAMINE). */
export async function withReadOnlyFolder<T>(client: ImapFlow, folder: string, fn: (info: { uidValidity: bigint; uidNext: number; exists: number }) => Promise<T>): Promise<T> {
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
        const mb = client.mailbox;
        if (!mb || typeof mb === "boolean") throw new Error(`Folderul ${folder} nu s-a deschis`);
        return await fn({ uidValidity: BigInt(mb.uidValidity), uidNext: Number(mb.uidNext), exists: Number(mb.exists) });
    } finally {
        lock.release();
    }
}

/** Folderul „Trimise”: cel din config, altfel cel marcat \Sent pe server. */
export async function findSentFolder(client: ImapFlow, preferred?: string): Promise<string | null> {
    const list = await client.list().catch(() => []);
    if (preferred && list.some((f) => f.path === preferred)) return preferred;
    return list.find((f) => f.specialUse === "\\Sent")?.path || list.find((f) => /(^|[./])sent( items| messages)?$/i.test(f.path))?.path || null;
}

export async function streamToBuffer(stream: NodeJS.ReadableStream, max = Infinity): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let n = 0;
    for await (const ch of stream as AsyncIterable<Buffer | string>) {
        const b = typeof ch === "string" ? Buffer.from(ch) : ch;
        n += b.length;
        if (n > max) throw new Error("Fișier prea mare");
        chunks.push(b);
    }
    return Buffer.concat(chunks);
}
