import { prisma } from "@/lib/prisma";
import { isMissingTable } from "@/lib/ads-account";

// Facturile de cost ale unui proiect (furnizori: servere, domenii, AI, reclame...) + cele comune (projectId null).
// Doar evidenta documentelor: nu intra in totalurile din Bani (vezi modelul CostInvoice).

export const COST_CATEGORIES: Record<string, string> = {
  server: "Servere / găzduire",
  domenii: "Domenii",
  ai: "AI",
  reclame: "Reclame",
  email: "E-mail",
  comisioane: "Comisioane plată",
  abonamente: "Abonamente",
  altele: "Altele",
};

export const MAX_FILE = 15 * 1024 * 1024;
export const FILE_RE = /\.(pdf|xml|zip|jpe?g|png)$/i;

export type CostInvoiceRow = {
  id: string;
  supplier: string;
  category: string;
  number: string | null;
  issueDate: string;
  total: number;
  vat: number | null;
  currency: string;
  shared: boolean;
  note: string | null;
  fileName: string | null;
  source: string;
};

/** Ultimele facturi ale proiectului + cele comune ale organizatiei; null daca tabelul nu e inca in baza. */
export async function getCostInvoices(project: { id: string; organizationId: string }, take = 200): Promise<CostInvoiceRow[] | null> {
  try {
    const rows = await prisma.costInvoice.findMany({
      where: { organizationId: project.organizationId, OR: [{ projectId: project.id }, { projectId: null }] },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      supplier: r.supplier,
      category: r.category,
      number: r.number,
      issueDate: r.issueDate.toISOString().slice(0, 10),
      total: Number(r.total),
      vat: r.vat === null ? null : Number(r.vat),
      currency: r.currency,
      shared: r.projectId === null,
      note: r.note,
      fileName: r.fileName,
      source: r.source,
    }));
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

export const mimeOf = (name: string) =>
  /\.pdf$/i.test(name) ? "application/pdf" : /\.xml$/i.test(name) ? "application/xml" : /\.zip$/i.test(name) ? "application/zip" : /\.png$/i.test(name) ? "image/png" : /\.jpe?g$/i.test(name) ? "image/jpeg" : "application/octet-stream";
