"use server";

import { revalidatePath } from "next/cache";
import { adminOrganizations, requireUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { redistributeRecent } from "@/lib/ads-account";

async function requireAdmin() {
  const userId = await requireUser();
  const orgs = await adminOrganizations(userId);
  if (orgs.length === 0) throw new Error("Doar administratorii pot schimba regulile");
  return orgs.map((o) => o.id);
}

// Regula noua: campaniile al caror nume incepe cu `prefix` merg la proiectul ales; apoi refacem ultimele 90 de zile
export async function addRule(form: FormData) {
  const orgIds = await requireAdmin();
  const prefix = String(form.get("prefix") ?? "").trim().slice(0, 80);
  const projectId = String(form.get("projectId") ?? "");
  if (!prefix) return;
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: { in: orgIds } }, select: { id: true } });
  if (!project) return;
  await prisma.adsCampaignRule.upsert({ where: { prefix }, create: { prefix, projectId }, update: { projectId } });
  await redistributeRecent();
  revalidatePath("/dashboard/setari/google-ads");
}

export async function deleteRule(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  await prisma.adsCampaignRule.deleteMany({ where: { id } });
  await redistributeRecent();
  revalidatePath("/dashboard/setari/google-ads");
}
