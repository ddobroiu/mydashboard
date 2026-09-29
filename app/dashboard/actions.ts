"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Provider } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { adminOrganizations, requireProject, requireUser } from "@/lib/access";
import { signOut } from "@/auth";
import { SYNCABLE, storeClarity, syncConnection } from "@/lib/sync";
import { testStripe } from "@/lib/integrations/stripe";
import { normalizeAccountId, testMeta } from "@/lib/integrations/meta";
import { testPostingClips } from "@/lib/integrations/postingclips";
import { sendOblioEinvoice, testOblio, type OblioCredentials } from "@/lib/integrations/oblio";
import { testReplicate } from "@/lib/integrations/replicate";
import { testOrdersDb } from "@/lib/integrations/orders-db";
import { newScriptSecret } from "@/lib/integrations/google-ads";
import { fetchClarityInsights, type ClarityRow } from "@/lib/integrations/clarity";
import { PROVIDERS } from "@/lib/integrations/types";

export async function logout() {
  await signOut({ redirectTo: "/login" });
}

export async function createProject(_prev: string | null, formData: FormData): Promise<string | null> {
  const userId = await requireUser();
  const parsed = z
    .object({
      organizationId: z.string().min(1),
      name: z.string().trim().min(2, "Numele e prea scurt"),
      domain: z.string().trim().optional(),
      currency: z.string().length(3),
    })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return parsed.error.issues[0].message;

  const orgs = await adminOrganizations(userId);
  if (!orgs.some((o) => o.id === parsed.data.organizationId)) return "Nu ai drept de administrare în această organizație.";

  const project = await prisma.project.create({
    data: { ...parsed.data, domain: parsed.data.domain || null, currency: parsed.data.currency.toUpperCase() },
  });
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/projects/${project.id}`);
}

export async function addConnection(_prev: string | null, formData: FormData): Promise<string | null> {
  const projectId = String(formData.get("projectId"));
  const provider = String(formData.get("provider")) as Provider;
  await requireProject(projectId, "ADMIN");

  const info = PROVIDERS.find((p) => p.provider === provider && p.available);
  if (!info) return "Integrare necunoscută.";

  const creds: Record<string, string> = {};
  for (const f of info.fields) {
    const v = String(formData.get(f.key) ?? "").trim();
    if (!v && f.type !== "checkbox" && !f.label.includes("(opțional)")) return `Completează: ${f.label}`;
    creds[f.key] = v;
  }
  let externalId = String(formData.get("externalId") ?? "").trim() || null;
  let label: string | null = null;
  let clarity: ClarityRow | null = null;

  // Verificam cheia inainte s-o salvam, ca eroarea sa apara imediat, nu la prima sincronizare.
  try {
    if (provider === "STRIPE") {
      await testStripe({ secretKey: creds.secretKey });
      if (creds.project) {
        creds.project = creds.project.toLowerCase();
        label = `proiect ${creds.project}${creds.includeUntagged === "1" ? " · și plățile vechi" : ""}`;
      }
    } else if (provider === "META") {
      if (!externalId) return "Completează Ad account ID.";
      externalId = normalizeAccountId(externalId);
      const acc = await testMeta({ accessToken: creds.accessToken }, externalId);
      label = `${acc.name} (${acc.currency})`;
    } else if (provider === "REPLICATE") {
      const acc = await testReplicate({ apiToken: creds.apiToken });
      label = `${acc.username}${creds.models ? ` · ${creds.models}` : " · toate modelele"}`;
    } else if (provider === "OBLIO") {
      if (!externalId) return "Completează CIF-ul firmei.";
      externalId = externalId.replace(/^RO/i, "").trim();
      creds.series = creds.series.toUpperCase();
      const { count } = await testOblio({ email: creds.email, apiSecret: creds.apiSecret, series: creds.series }, externalId);
      label = `seria ${creds.series} · ${count} facturi în ultimul an${creds.asRevenue === "1" ? " · la încasări" : ""}`;
    } else if (provider === "ORDERS_DB") {
      const { count } = await testOrdersDb({ connectionString: creds.connectionString, methods: creds.methods });
      label = `${creds.methods || "Ramburs, OP"} · ${count} comenzi`;
    } else if (provider === "GOOGLE_ADS") {
      creds.project = creds.project.toLowerCase();
      creds.scriptSecret = newScriptSecret();
      label = `așteaptă scriptul din Google Ads${creds.project ? ` · [${creds.project}]` : ""}`;
    } else if (provider === "CLARITY") {
      if (!externalId) return "Completează Project ID-ul din Clarity.";
      // Aceeasi cerere verifica tokenul si aduce primele cifre (Clarity da doar 10 cereri pe zi)
      clarity = await fetchClarityInsights({ apiToken: creds.apiToken });
      label = `proiect ${externalId}`;
    } else if (provider === "POSTINGCLIPS") {
      const me = await testPostingClips({ apiKey: creds.apiKey });
      label = me.brand ? `${me.brand.name} · ${me.email}` : `${me.email} · toate brandurile`;
    }
  } catch (e) {
    return `Conexiunea nu a mers: ${e instanceof Error ? e.message : String(e)}`;
  }

  const conn = await prisma.connection.create({
    data: { projectId, provider, externalId, label, credentials: encryptJson(creds) },
  });

  // Google Ads trimite el datele: mergi la pagina cu scriptul de pus in cont
  if (provider === "GOOGLE_ADS") redirect(`/dashboard/projects/${projectId}/google-ads?c=${conn.id}`);

  // Clarity: cifrele citite la verificare devin randul de ieri; urmatoarea citire, maine dimineata
  if (clarity) {
    await storeClarity(conn, clarity);
    await prisma.connection.update({ where: { id: conn.id }, data: { lastSyncAt: new Date() } });
    revalidatePath(`/dashboard/projects/${projectId}`);
    return null;
  }

  // Prima sincronizare aduce ultimele 90 de zile.
  const res = await syncConnection(conn.id, 90);
  revalidatePath(`/dashboard/projects/${projectId}`);
  return res.ok ? null : `Conectat, dar sincronizarea a eșuat: ${res.error}`;
}

export async function syncProject(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const days = Math.min(Number(formData.get("days") ?? 7) || 7, 365);
  const { project } = await requireProject(projectId, "ADMIN");
  const conns = await prisma.connection.findMany({
    where: { projectId: project.id, status: { not: "DISABLED" }, provider: { in: [...SYNCABLE] } },
    select: { id: true },
  });
  for (const c of conns) await syncConnection(c.id, days);
  revalidatePath(`/dashboard/projects/${projectId}`);
}

export async function deleteConnection(formData: FormData) {
  const connectionId = String(formData.get("connectionId"));
  const conn = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!conn) return;
  await requireProject(conn.projectId, "ADMIN");
  await prisma.connection.delete({ where: { id: connectionId } });
  revalidatePath(`/dashboard/projects/${conn.projectId}`);
}

// Trimite in SPV (e-Factura) prin Oblio o factura (invoiceId) sau toate cele netrimise / cu erori ale proiectului
export async function sendInvoicesToSpv(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  const invoiceId = formData.get("invoiceId") ? String(formData.get("invoiceId")) : null;
  await requireProject(projectId, "ADMIN");
  const invoices = await prisma.invoice.findMany({
    where: invoiceId
      ? { id: invoiceId, projectId }
      : { projectId, canceled: false, einvoiceCode: { in: [-1, 2] } },
    orderBy: { issueDate: "asc" },
    take: 50,
    include: { connection: { select: { credentials: true, externalId: true } } },
  });
  for (const inv of invoices) {
    try {
      const creds = decryptJson<OblioCredentials>(inv.connection.credentials);
      const r = await sendOblioEinvoice(creds, inv.connection.externalId ?? "", inv.series, inv.number);
      await prisma.invoice.update({ where: { id: inv.id }, data: { einvoiceStatus: r.text, einvoiceCode: r.code } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await prisma.invoice.update({ where: { id: inv.id }, data: { einvoiceStatus: `Eroare: ${msg}`.slice(0, 190), einvoiceCode: 2 } });
    }
  }
  revalidatePath(`/dashboard/projects/${projectId}`);
}
