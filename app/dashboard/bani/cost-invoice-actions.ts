"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/access";

// Sterge o factura de cost (si fisierul ei). Doar adminii proiectului din a carui pagina se sterge.
export async function deleteCostInvoice(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const { project } = await requireProject(projectId, "ADMIN");
  const inv = await prisma.costInvoice.findUnique({ where: { id }, select: { organizationId: true, projectId: true } });
  if (!inv || inv.organizationId !== project.organizationId || (inv.projectId && inv.projectId !== project.id)) return;
  await prisma.costInvoice.delete({ where: { id } });
  revalidatePath(`/dashboard/projects/${projectId}`);
}
