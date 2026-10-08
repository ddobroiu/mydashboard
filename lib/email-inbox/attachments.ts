// Atasamentele raman pe serverul de e-mail: se descarca la cerere direct din IMAP (folder deschis doar in citire,
// BODY.PEEK). Nu le copiem nicaieri. (Portat din print, fara Cloudinary.)
import { simpleParser } from "mailparser";
import { getMailboxes, type MailboxConfig } from "./config";
import { PARSE_OPTS, streamToBuffer, withImap, withReadOnlyFolder } from "./imap";

type AttRow = {
  idx: number | null;
  partId: string | null;
  message: { messageId: string; uid: number | null; uidValidity: bigint | null; folder: string | null; mailboxAddress: string };
};

/** Continutul unui atasament (dupa UID; daca UIDVALIDITY s-a schimbat, dupa Message-ID). */
export async function fetchAttachmentFromImap(att: AttRow, mailboxes: MailboxConfig[] = getMailboxes()): Promise<Buffer> {
  const mb = mailboxes.find((m) => m.address === att.message.mailboxAddress);
  if (!mb) throw new Error("Căsuța nu mai e configurată (MAILBOXES_JSON)");
  const folder = att.message.folder || "INBOX";
  return withImap(mb, (client) =>
    withReadOnlyFolder(client, folder, async (info) => {
      let uid = att.message.uid && att.message.uidValidity === info.uidValidity ? att.message.uid : null;
      if (!uid) {
        const found = await client.search({ header: { "message-id": att.message.messageId } }, { uid: true });
        uid = Array.isArray(found) && found.length ? found[0] : null;
      }
      if (!uid) throw new Error("Mesajul nu mai e pe server");
      if (att.partId) {
        const dl = await client.download(String(uid), att.partId, { uid: true });
        if (!dl?.content) throw new Error("Atașamentul nu s-a găsit");
        return streamToBuffer(dl.content, 200 * 1024 * 1024);
      }
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) throw new Error("Mesajul nu s-a putut citi");
      const parsed = await simpleParser(msg.source, PARSE_OPTS);
      const a = parsed.attachments[att.idx ?? -1];
      if (!a) throw new Error("Atașamentul nu s-a găsit");
      return a.content;
    }),
  );
}
