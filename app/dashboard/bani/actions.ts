"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { adminOrganizations, requireProject, requireUser } from "@/lib/access";

// Costurile fixe lunare: ale unui proiect sau comune (projectId gol = impartit la toate proiectele).

const fields = z.object({
  name: z.string().trim().min(1).max(80),
  monthly: z.coerce.number().min(0).max(1_000_000),
  currency: z.enum(["EUR", "RON", "USD"]),
});

// Cine poate modifica: admin in organizatie (costuri comune) sau pe proiect
async function canEdit(organizationId: string, projectId: string | null) {
  if (projectId) {
    const { project } = await requireProject(projectId, "ADMIN");
    return project.organizationId === organizationId;
  }
  const orgs = await adminOrganizations(await requireUser());
  return orgs.some((o) => o.id === organizationId);
}

const parseAmount = (v: FormDataEntryValue | null) => String(v ?? "").replace(/\s/g, "").replace(",", ".");

function refresh(projectId: string | null) {
  revalidatePath("/dashboard", "layout");
  if (projectId) revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function addFixedCost(formData: FormData) {
  const organizationId = String(formData.get("organizationId") ?? "");
  const scope = String(formData.get("scope") ?? "");
  const projectId = scope === "shared" ? null : String(formData.get("projectId") ?? "") || null;
  const parsed = fields.safeParse({ name: formData.get("name"), monthly: parseAmount(formData.get("monthly")), currency: formData.get("currency") });
  if (!parsed.success || !(await canEdit(organizationId, projectId))) return;
  await prisma.fixedCost.create({ data: { organizationId, projectId, ...parsed.data } });
  refresh(String(formData.get("projectId") ?? "") || null);
}

export async function updateFixedCost(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const cost = await prisma.fixedCost.findUnique({ where: { id } });
  const parsed = fields.safeParse({ name: formData.get("name"), monthly: parseAmount(formData.get("monthly")), currency: formData.get("currency") });
  if (!cost || !parsed.success || !(await canEdit(cost.organizationId, cost.projectId))) return;
  // Salvata de proprietar = verificata
  await prisma.fixedCost.update({ where: { id }, data: { ...parsed.data, toVerify: false } });
  refresh(String(formData.get("projectId") ?? "") || cost.projectId);
}

export async function deleteFixedCost(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const cost = await prisma.fixedCost.findUnique({ where: { id } });
  if (!cost || !(await canEdit(cost.organizationId, cost.projectId))) return;
  await prisma.fixedCost.delete({ where: { id } });
  refresh(String(formData.get("projectId") ?? "") || cost.projectId);
}
