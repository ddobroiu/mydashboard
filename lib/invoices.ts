import { prisma } from "@/lib/prisma";
import { dayDate } from "@/lib/dates";

export async function getInvoices(projectIds: string[], since: string, until: string) {
  const where = { projectId: { in: projectIds }, issueDate: { gte: dayDate(since), lte: dayDate(until) } };
  const [rows, totals, canceled, byCurrency, spvPending] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: [{ issueDate: "desc" }, { number: "desc" }], take: 50 }),
    prisma.invoice.aggregate({ where: { ...where, canceled: false }, _count: { _all: true } }),
    prisma.invoice.count({ where: { ...where, canceled: true } }),
    prisma.invoice.groupBy({ by: ["currency"], where: { ...where, canceled: false }, _sum: { total: true } }),
    // Facturi netrimise in SPV sau cu erori (codurile Oblio -1 si 2)
    prisma.invoice.count({ where: { ...where, canceled: false, einvoiceCode: { in: [-1, 2] } } }),
  ]);
  return {
    count: totals._count._all,
    canceled,
    spvPending,
    totals: byCurrency.map((c) => ({ currency: c.currency, total: Number(c._sum.total ?? 0) })),
    rows: rows.map((r) => ({ ...r, total: Number(r.total) })),
  };
}

export type Invoices = Awaited<ReturnType<typeof getInvoices>>;
