// Descarcarea unui atasament direct din IMAP (doar citire). ?inline=1 = imaginile din corpul mesajului (cid:).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchAttachmentFromImap } from "@/lib/email-inbox/attachments";
import { emailApiDenied } from "@/lib/email-inbox/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const d = await emailApiDenied();
  if (d) return d;
  const { id } = await params;
  const att = await prisma.emailAttachment
    .findUnique({ where: { id }, include: { message: { select: { messageId: true, uid: true, uidValidity: true, folder: true, mailboxAddress: true } } } })
    .catch(() => null);
  if (!att) return NextResponse.json({ error: "Atașamentul nu există" }, { status: 404 });
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  try {
    const data = await fetchAttachmentFromImap(att);
    // doar pozele se afiseaza in pagina; restul se descarca (un HTML/SVG atasat nu ruleaza pe domeniul nostru)
    const safeInline = inline && /^image\/(png|jpe?g|gif|webp)$/i.test(att.mime);
    const type = safeInline ? att.mime : /html|svg|xml|javascript/i.test(att.mime) ? "application/octet-stream" : att.mime || "application/octet-stream";
    const ascii = att.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `${safeInline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
        "Content-Length": String(data.length),
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : "Eroare").slice(0, 200) }, { status: 502 });
  }
}
