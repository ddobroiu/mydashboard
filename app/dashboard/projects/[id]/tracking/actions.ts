"use server";

import crypto from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/access";
import { encryptJson } from "@/lib/crypto";
import { dayDate } from "@/lib/dates";
import { forgetSite } from "@/lib/tracking/collect";

const path = (projectId: string) => `/dashboard/projects/${projectId}/tracking`;
const field = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// ─── Obiective ───────────────────────────────────────────────────────────────

export async function addGoal(_prev: string | null, fd: FormData): Promise<string | null> {
  const projectId = field(fd, "projectId");
  const { project } = await requireProject(projectId, "ADMIN");
  const parsed = z
    .object({
      name: z.string().min(2, "Dă un nume obiectivului").max(80),
      pattern: z.string().min(2, "Scrie ce conține adresa paginii (ex. /multumim)").max(200),
      value: z.union([z.literal(""), z.coerce.number().min(0).max(1e8)]),
    })
    .safeParse({ name: field(fd, "name"), pattern: field(fd, "pattern"), value: field(fd, "value") });
  if (!parsed.success) return parsed.error.issues[0].message;

  // Daca s-a lipit o adresa intreaga, pastram doar calea
  let pattern = parsed.data.pattern;
  try {
    const u = new URL(pattern);
    pattern = u.pathname + u.search;
  } catch {}

  await prisma.goal.create({
    data: { projectId, name: parsed.data.name, pattern, value: parsed.data.value === "" ? null : parsed.data.value },
  });
  forgetSite(project.trackingId);
  revalidatePath(path(projectId));
  return null;
}

export async function deleteGoal(fd: FormData) {
  const goal = await prisma.goal.findUnique({ where: { id: field(fd, "goalId") } });
  if (!goal) return;
  const { project } = await requireProject(goal.projectId, "ADMIN");
  await prisma.goal.delete({ where: { id: goal.id } });
  forgetSite(project.trackingId);
  revalidatePath(path(goal.projectId));
}

// ─── Linkuri urmarite ───────────────────────────────────────────────────────

export async function addLink(_prev: string | null, fd: FormData): Promise<string | null> {
  const projectId = field(fd, "projectId");
  await requireProject(projectId, "ADMIN");
  const name = field(fd, "name");
  if (name.length < 2) return "Dă un nume linkului (ex. Bio Instagram)";

  let url: URL;
  try {
    url = new URL(field(fd, "destination"));
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return "Adresa de destinație trebuie să înceapă cu https://";
  }
  const utm = { utm_source: field(fd, "source"), utm_medium: field(fd, "medium"), utm_campaign: field(fd, "campaign") };
  if (!utm.utm_source) return "Completează sursa (ex. instagram, influencer-ana, flyer)";
  for (const [k, v] of Object.entries(utm)) if (v) url.searchParams.set(k, v.toLowerCase().replace(/\s+/g, "-"));

  // Cod scurt, usor de scris de mana (fara 0/O, 1/l)
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join("");
    try {
      await prisma.trackedLink.create({ data: { projectId, name: name.slice(0, 80), code, destination: url.toString() } });
      revalidatePath(path(projectId));
      return null;
    } catch {}
  }
  return "Nu am putut genera linkul, mai încearcă o dată.";
}

export async function deleteLink(fd: FormData) {
  const link = await prisma.trackedLink.findUnique({ where: { id: field(fd, "linkId") } });
  if (!link) return;
  await requireProject(link.projectId, "ADMIN");
  await prisma.trackedLink.delete({ where: { id: link.id } });
  revalidatePath(path(link.projectId));
}

// ─── Cheltuieli manuale ─────────────────────────────────────────────────────

// Cheltuielile manuale stau in AdSpendDaily, sub o conexiune MANUAL ascunsa.
async function manualConnection(projectId: string) {
  const existing = await prisma.connection.findFirst({ where: { projectId, provider: "MANUAL" } });
  if (existing) return existing;
  return prisma.connection.create({
    data: { projectId, provider: "MANUAL", label: "Cheltuieli manuale", credentials: encryptJson({}) },
  });
}

export async function addManualSpend(_prev: string | null, fd: FormData): Promise<string | null> {
  const projectId = field(fd, "projectId");
  const { project } = await requireProject(projectId, "ADMIN");
  const parsed = z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Alege data"),
      name: z.string().min(2, "Scrie pe ce s-au dat banii (ex. influencer-ana)").max(120),
      amount: z.coerce.number().positive("Suma trebuie să fie mai mare ca 0").max(1e8),
    })
    .safeParse({ date: field(fd, "date"), name: field(fd, "name"), amount: field(fd, "amount") });
  if (!parsed.success) return parsed.error.issues[0].message;

  const conn = await manualConnection(projectId);
  await prisma.adSpendDaily.create({
    data: {
      projectId,
      connectionId: conn.id,
      provider: "MANUAL",
      date: dayDate(parsed.data.date),
      campaignId: crypto.randomUUID(),
      campaignName: parsed.data.name,
      currency: project.currency,
      spend: parsed.data.amount,
    },
  });
  revalidatePath(path(projectId));
  return null;
}

export async function deleteManualSpend(fd: FormData) {
  const row = await prisma.adSpendDaily.findUnique({ where: { id: field(fd, "spendId") } });
  if (!row || row.provider !== "MANUAL") return;
  await requireProject(row.projectId, "ADMIN");
  await prisma.adSpendDaily.delete({ where: { id: row.id } });
  revalidatePath(path(row.projectId));
}
