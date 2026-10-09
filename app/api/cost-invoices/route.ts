// Adauga o factura de cost cu fisierul ei (formular simplu din tabul Bani al proiectului), apoi revine in pagina.
// Rută, nu server action: fișierele trec de limita de 1 MB a acțiunilor.
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { COST_CATEGORIES, FILE_RE, MAX_FILE, mimeOf } from "@/lib/cost-invoices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return s && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};

export async function POST(req: NextRequest) {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  const f = await req.formData();
  const projectId = String(f.get("projectId") ?? "");
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, organizationId: true } });
  const member = project && (await prisma.membership.findFirst({ where: { organizationId: project.organizationId, userId, role: { in: ["OWNER", "ADMIN"] } } }));
  if (!project || !member) return NextResponse.json({ error: "Fără acces" }, { status: 404 });
  const back = new URL(`/dashboard/projects/${project.id}?tab=bani`, req.url);

  const supplier = String(f.get("supplier") ?? "").trim().slice(0, 80);
  const total = num(f.get("total"));
  const date = String(f.get("issueDate") ?? "");
  if (!supplier || total === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.redirect(back, 303);
  const currency = ["RON", "EUR", "USD"].includes(String(f.get("currency"))) ? String(f.get("currency")) : "RON";
  const category = String(f.get("category") ?? "") in COST_CATEGORIES ? String(f.get("category")) : "altele";
  const file = f.get("file");
  const hasFile = file instanceof File && file.size > 0 && file.size <= MAX_FILE && FILE_RE.test(file.name);

  await prisma.costInvoice.create({
    data: {
      organizationId: project.organizationId,
      projectId: f.get("scope") === "shared" ? null : project.id,
      supplier,
      category,
      number: String(f.get("number") ?? "").trim().slice(0, 80) || null,
      issueDate: new Date(`${date}T00:00:00Z`),
      total,
      vat: num(f.get("vat")),
      currency,
      note: String(f.get("note") ?? "").trim().slice(0, 300) || null,
      source: "manual",
      ...(hasFile
        ? { fileName: file.name.slice(0, 200), fileMime: mimeOf(file.name), file: { create: { data: Buffer.from(await file.arrayBuffer()), size: file.size } } }
        : {}),
    },
  });
  revalidatePath(`/dashboard/projects/${project.id}`);
  return NextResponse.redirect(back, 303);
}
