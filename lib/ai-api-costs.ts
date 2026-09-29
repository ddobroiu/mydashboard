import { prisma } from "@/lib/prisma";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import { reportedLinesFor } from "@/lib/ai-usage";

// Costul AI din conturile de organizatie (Anthropic, OpenAI) si, pe pagina „Costuri AI”, si Replicate
// plus consumul raportat de aplicatii (lib/ai-usage.ts) acolo unde nu avem costul facturat pentru acel furnizor.
// Costul API se atribuie proiectului la citire, prin legaturile AiProjectLink (workspace / proiect extern -> proiect),
// asa ca o legatura adaugata tarziu se aplica si zilelor deja aduse.

export type AiProviderKey = "ANTHROPIC" | "OPENAI" | "REPLICATE" | "OTHER";
export const AI_PROVIDER_NAMES: Record<AiProviderKey, string> = { ANTHROPIC: "Anthropic", OPENAI: "OpenAI", REPLICATE: "Replicate", OTHER: "Alții" };
const providerKey = (p: string): AiProviderKey => (p === "ANTHROPIC_ADMIN" ? "ANTHROPIC" : p === "OPENAI_ADMIN" ? "OPENAI" : "REPLICATE");

async function linksFor(projectIds: string[]) {
  return prisma.aiProjectLink.findMany({ where: { projectId: { in: projectIds } }, select: { accountId: true, externalId: true, projectId: true } });
}

export type ApiModelLine = {
  provider: AiProviderKey;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requests: number;
};

// Costurile API (Anthropic, OpenAI) ale proiectelor, pe furnizor si model
export async function getApiAiCosts(projectIds: string[], since: string, until: string) {
  const links = await linksFor(projectIds);
  if (!links.length) return { costUsd: 0, linked: 0, byProvider: [] as { provider: AiProviderKey; costUsd: number }[], models: [] as ApiModelLine[] };
  const rows = await prisma.aiCostDaily.groupBy({
    by: ["provider", "model"],
    where: {
      date: { gte: dayDate(since), lte: dayDate(until) },
      OR: links.map((l) => ({ accountId: l.accountId, externalId: l.externalId })),
    },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true, cachedTokens: true, requests: true },
  });
  const models: ApiModelLine[] = rows
    .map((r) => ({
      provider: providerKey(r.provider),
      model: r.model,
      costUsd: Number(r._sum.costUsd ?? 0),
      inputTokens: Number(r._sum.inputTokens ?? 0),
      outputTokens: Number(r._sum.outputTokens ?? 0),
      cachedTokens: Number(r._sum.cachedTokens ?? 0),
      requests: r._sum.requests ?? 0,
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const by = new Map<AiProviderKey, number>();
  for (const m of models) by.set(m.provider, (by.get(m.provider) ?? 0) + m.costUsd);
  return {
    costUsd: models.reduce((s, m) => s + m.costUsd, 0),
    linked: links.length,
    byProvider: [...by].map(([provider, costUsd]) => ({ provider, costUsd })),
    models,
  };
}

export type ApiAiCosts = Awaited<ReturnType<typeof getApiAiCosts>>;

// Costul API pe proiect, in USD (pentru „Bani”)
export async function apiAiUsdByProject(projectIds: string[], since: string, until: string) {
  const out = new Map<string, number>();
  const links = await linksFor(projectIds);
  if (!links.length) return out;
  const rows = await prisma.aiCostDaily.groupBy({
    by: ["accountId", "externalId"],
    where: { date: { gte: dayDate(since), lte: dayDate(until) }, OR: links.map((l) => ({ accountId: l.accountId, externalId: l.externalId })) },
    _sum: { costUsd: true },
  });
  const owner = new Map(links.map((l) => [`${l.accountId}|${l.externalId}`, l.projectId]));
  for (const r of rows) {
    const pid = owner.get(`${r.accountId}|${r.externalId}`);
    if (pid) out.set(pid, (out.get(pid) ?? 0) + Number(r._sum.costUsd ?? 0));
  }
  return out;
}

// ─── Pagina „Costuri AI”: toate proiectele, toti furnizorii ─────────────────

type Line = {
  provider: AiProviderKey;
  projectId: string | null;
  accountId?: string;
  externalId?: string;
  model: string;
  date: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};
export type ByProvider = Record<AiProviderKey, number>;
const zero = (): ByProvider => ({ ANTHROPIC: 0, OPENAI: 0, REPLICATE: 0, OTHER: 0 });
const sum = (r: ByProvider) => r.ANTHROPIC + r.OPENAI + r.REPLICATE + r.OTHER;

export async function getAiOverview(organizationIds: string[]) {
  const today = dayKey(new Date());
  const monthStart = `${today.slice(0, 8)}01`;
  const since30 = addDays(today, -29);
  // Cele 30 de zile dinainte, pentru comparatie
  const prevSince = addDays(since30, -30);
  const from = monthStart < prevSince ? monthStart : prevSince;
  const range = { gte: dayDate(from), lte: dayDate(today) };

  const [projects, accounts, api, replicate] = await Promise.all([
    prisma.project.findMany({
      where: { organizationId: { in: organizationIds } },
      select: { id: true, name: true, domain: true, organizationId: true },
      orderBy: { name: "asc" },
    }),
    prisma.aiAccount.findMany({
      where: { organizationId: { in: organizationIds } },
      select: {
        id: true,
        organizationId: true,
        provider: true,
        label: true,
        names: true,
        status: true,
        lastSyncAt: true,
        lastError: true,
        links: { select: { id: true, externalId: true, projectId: true } },
      },
      orderBy: { provider: "asc" },
    }),
    prisma.aiCostDaily.findMany({
      where: { organizationId: { in: organizationIds }, date: range },
      select: { accountId: true, provider: true, externalId: true, model: true, date: true, costUsd: true, inputTokens: true, outputTokens: true },
    }),
    prisma.aiUsageDaily.findMany({
      where: { project: { organizationId: { in: organizationIds } }, date: range },
      select: { projectId: true, model: true, date: true, costUsd: true },
    }),
  ]);

  // Consumul raportat de aplicatii, doar unde nu avem costul facturat (cont Admin legat / conexiune Replicate)
  const reported = await reportedLinesFor(projects, from, today);

  const owner = new Map(accounts.flatMap((a) => a.links.map((l) => [`${a.id}|${l.externalId}`, l.projectId] as const)));
  const lines: Line[] = [
    ...api.map((r) => ({
      provider: providerKey(r.provider),
      projectId: owner.get(`${r.accountId}|${r.externalId}`) ?? null,
      accountId: r.accountId,
      externalId: r.externalId,
      model: r.model,
      date: r.date.toISOString().slice(0, 10),
      costUsd: Number(r.costUsd),
      inputTokens: Number(r.inputTokens),
      outputTokens: Number(r.outputTokens),
    })),
    ...replicate.map((r) => ({
      provider: "REPLICATE" as const,
      projectId: r.projectId,
      model: r.model,
      date: r.date.toISOString().slice(0, 10),
      costUsd: Number(r.costUsd),
      inputTokens: 0,
      outputTokens: 0,
    })),
    ...reported,
  ];

  const nameOf = (accountId: string, externalId: string) => {
    if (externalId === "default") return "Default";
    const names = (accounts.find((a) => a.id === accountId)?.names ?? {}) as Record<string, string>;
    return names[externalId] ?? null;
  };

  const totals = { month: zero(), last30: zero(), prev30: zero() };
  const perProject = new Map<string, { month: number; last30: number; by: ByProvider }>();
  const unassigned = new Map<string, { provider: AiProviderKey; accountId: string; externalId: string; name: string | null; month: number; last30: number }>();
  const perModel = new Map<string, { provider: AiProviderKey; model: string; month: number; last30: number; inputTokens: number; outputTokens: number }>();
  const daily = new Map<string, ByProvider>();
  for (let d = since30; d <= today; d = addDays(d, 1)) daily.set(d, zero());

  for (const l of lines) {
    const inMonth = l.date >= monthStart;
    const in30 = l.date >= since30;
    const inPrev = l.date >= prevSince && l.date < since30;
    if (inPrev) totals.prev30[l.provider] += l.costUsd;
    if (!inMonth && !in30) continue;
    const month = inMonth ? l.costUsd : 0;
    const last30 = in30 ? l.costUsd : 0;
    totals.month[l.provider] += month;
    totals.last30[l.provider] += last30;
    const day = daily.get(l.date);
    if (day) day[l.provider] += l.costUsd;

    const mk = `${l.provider}|${l.model}`;
    const m = perModel.get(mk) ?? { provider: l.provider, model: l.model, month: 0, last30: 0, inputTokens: 0, outputTokens: 0 };
    m.month += month;
    m.last30 += last30;
    if (in30) {
      m.inputTokens += l.inputTokens;
      m.outputTokens += l.outputTokens;
    }
    perModel.set(mk, m);

    if (l.projectId) {
      const p = perProject.get(l.projectId) ?? { month: 0, last30: 0, by: zero() };
      p.month += month;
      p.last30 += last30;
      p.by[l.provider] += last30;
      perProject.set(l.projectId, p);
    } else if (l.accountId && l.externalId !== undefined) {
      // Workspace / proiect extern nelegat de niciun proiect: „neatribuit”, ca sa nu se piarda nimic
      const k = `${l.accountId}|${l.externalId}`;
      const u = unassigned.get(k) ?? {
        provider: l.provider,
        accountId: l.accountId,
        externalId: l.externalId,
        name: nameOf(l.accountId, l.externalId),
        month: 0,
        last30: 0,
      };
      u.month += month;
      u.last30 += last30;
      unassigned.set(k, u);
    }
  }

  const unassignedTotal = { month: 0, last30: 0 };
  for (const u of unassigned.values()) {
    unassignedTotal.month += u.month;
    unassignedTotal.last30 += u.last30;
  }

  return {
    today,
    monthStart,
    since30,
    totals: {
      month: { ...totals.month, total: sum(totals.month) },
      last30: { ...totals.last30, total: sum(totals.last30) },
      prev30: { ...totals.prev30, total: sum(totals.prev30) },
    },
    projects: projects
      .map((p) => ({ ...p, ...(perProject.get(p.id) ?? { month: 0, last30: 0, by: zero() }) }))
      .sort((a, b) => b.last30 - a.last30 || a.name.localeCompare(b.name)),
    unassigned: [...unassigned.values()].filter((u) => u.last30 !== 0 || u.month !== 0).sort((a, b) => b.last30 - a.last30),
    unassignedTotal,
    models: [...perModel.values()].filter((m) => m.last30 !== 0 || m.month !== 0).sort((a, b) => b.last30 - a.last30),
    daily: [...daily].map(([date, v]) => ({ date, ...v })),
    accounts: accounts.map((a) => ({
      ...a,
      names: (a.names ?? {}) as Record<string, string>,
      links: a.links.map((l) => ({ ...l, project: projects.find((p) => p.id === l.projectId)?.name ?? "?" })),
    })),
    // Proiectele cu Replicate: costul e estimat, iar cele cu acelasi cont nu se pot desparti exact
    replicateProjects: [...new Set(replicate.map((r) => r.projectId))].map((id) => projects.find((p) => p.id === id)?.name ?? id),
  };
}

export type AiOverview = Awaited<ReturnType<typeof getAiOverview>>;
