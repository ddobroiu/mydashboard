// Fisierul unei facturi de cost (PDF / XML...), doar pentru membrii organizatiei.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  const { id } = await params;
  const inv = await prisma.costInvoice
    .findUnique({ where: { id }, select: { organizationId: true, fileName: true, fileMime: true, file: { select: { data: true } } } })
    .catch(() => null);
  if (!inv?.file) return NextResponse.json({ error: "Fără fișier" }, { status: 404 });
  const member = await prisma.membership.findFirst({ where: { organizationId: inv.organizationId, userId }, select: { id: true } });
  if (!member) return NextResponse.json({ error: "Fără acces" }, { status: 404 });
  const name = inv.fileName || "factura";
  const isPdf = inv.fileMime === "application/pdf";
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const data = Buffer.from(inv.file.data);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      // PDF-ul se deschide in browser; restul (XML, ZIP...) se descarca
      "Content-Type": isPdf ? "application/pdf" : "application/octet-stream",
      "Content-Disposition": `${isPdf ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
