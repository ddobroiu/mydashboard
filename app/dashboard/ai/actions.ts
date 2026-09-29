"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { adminOrganizations, requireProject, requireUser } from "@/lib/access";
import { AI_ADMIN, isAiAdminProvider } from "@/lib/integrations/ai-admin";
import { AI_FIRST_DAYS, syncAiAccount } from "@/lib/ai-accounts";

// Conturile Anthropic / OpenAI (o cheie Admin pe organizatie) si legarea workspace-urilor / proiectelor lor de proiecte.

async function isOrgAdmin(organizationId: string) {
  const orgs = await adminOrganizations(await requireUser());
  return orgs.some((o) => o.id === organizationId);
}

function refresh() {
  revalidatePath("/dashboard", "layout");
}

// Salveaza (sau inlocuieste) cheia Admin. Cheia e verificata inainte, apoi aducem ultimele 90 de zile.
export async function saveAiAccount(_prev: string | null, formData: FormData): Promise<string | null> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const provider = String(formData.get("provider") ?? "");
  const adminKey = String(formData.get("adminKey") ?? "").trim();
  if (!isAiAdminProvider(provider)) return "Furnizor necunoscut.";
  if (!(await isOrgAdmin(organizationId))) return "Nu ai drept de administrare în această organizație.";
  const info = AI_ADMIN[provider];
  if (!adminKey) return "Completează cheia Admin.";
  if (!adminKey.startsWith(info.keyPrefix)) return `Cheia ${info.name} de administrare începe cu ${info.keyPrefix}… (o cheie API obișnuită nu vede costurile).`;

  let names: Record<string, string>;
  try {
    names = await info.names({ adminKey });
  } catch (e) {
    return `Cheia nu a mers: ${e instanceof Error ? e.message : String(e)}`;
  }
  const count = Object.keys(names).length;
  const label = `${count} ${info.idLabel === "workspace" ? "workspace-uri" : "proiecte"}`;
  const acc = await prisma.aiAccount.upsert({
    where: { organizationId_provider: { organizationId, provider } },
    create: { organizationId, provider, label, names, credentials: encryptJson({ adminKey }) },
    update: { label, names, credentials: encryptJson({ adminKey }), status: "ACTIVE", lastError: null },
  });
  const res = await syncAiAccount(acc.id, AI_FIRST_DAYS);
  refresh();
  return res.ok ? null : `Cheia e salvată, dar citirea costurilor a eșuat: ${res.error}`;
}

export async function deleteAiAccount(formData: FormData) {
  const acc = await prisma.aiAccount.findUnique({ where: { id: String(formData.get("accountId") ?? "") } });
  if (!acc || !(await isOrgAdmin(acc.organizationId))) return;
  await prisma.aiAccount.delete({ where: { id: acc.id } });
  refresh();
}

// „Sincronizează acum”: toate conturile AI ale organizatiilor pe care le administrezi
export async function syncAiNow(formData: FormData) {
  const days = Math.min(Math.max(Number(formData.get("days") ?? 7) || 7, 1), 365);
  const orgs = await adminOrganizations(await requireUser());
  const accounts = await prisma.aiAccount.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) }, status: { not: "DISABLED" } } });
  for (const a of accounts) await syncAiAccount(a.id, days);
  refresh();
}

// Leaga un workspace (wrkspc_…) / proiect (proj_…) / „default” de un proiect din mydashboard
export async function linkAiExternal(formData: FormData) {
  const accountId = String(formData.get("accountId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const externalId = String(formData.get("externalId") ?? "").trim();
  if (!accountId || !projectId || !externalId || externalId.length > 100) return;
  const { project } = await requireProject(projectId, "ADMIN");
  const acc = await prisma.aiAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.organizationId !== project.organizationId) return;
  await prisma.aiProjectLink.upsert({
    where: { accountId_externalId: { accountId, externalId } },
    create: { accountId, externalId, projectId },
    update: { projectId },
  });
  refresh();
}

export async function unlinkAiExternal(formData: FormData) {
  const link = await prisma.aiProjectLink.findUnique({ where: { id: String(formData.get("linkId") ?? "") } });
  if (!link) return;
  await requireProject(link.projectId, "ADMIN");
  await prisma.aiProjectLink.delete({ where: { id: link.id } });
  refresh();
}
