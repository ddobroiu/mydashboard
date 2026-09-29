import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/alerts";
import { tokenCostUsd } from "@/lib/ai-prices";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import type { AiProviderKey } from "@/lib/ai-api-costs";

// Consumul AI raportat de aplicatii (POST /api/ingest/ai-usage): agregare pe zi, erori recente, bugete si alerte pe e-mail.
// Alertele AI pleaca la ALERT_EMAIL_AI (implicit contact@mydashboard.ro):
//  - credit terminat / cheie invalida: imediat, cel mult o data la 24 h pe aplicatie + furnizor + tip
//  - limita de viteza (429): doar daca tine (10+ in 15 minute), tot o data la 24 h
//  - buget: o data pe zi la depasirea bugetului zilnic, o data pe luna la 80% si la 100% din bugetul lunar

export const AI_DEFAULT_BUDGET = { dailyUsd: 2, monthlyUsd: 20 };
const aiAlertTo = () => process.env.ALERT_EMAIL_AI || "contact@mydashboard.ro";

export const REPORTED_PROVIDERS = ["openai", "anthropic", "replicate", "google", "other"] as const;
export type ReportedProvider = (typeof REPORTED_PROVIDERS)[number];
export const ERROR_KINDS = ["credit", "auth", "rate", "other"] as const;
export type AiErrorKind = (typeof ERROR_KINDS)[number];

export const REPORTED_PROVIDER_NAMES: Record<ReportedProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  replicate: "Replicate",
  google: "Google",
  other: "Alt furnizor",
};
export const ERROR_KIND_NAMES: Record<AiErrorKind, string> = {
  credit: "credit terminat",
  auth: "cheie invalidă",
  rate: "limită de cereri (429)",
  other: "eroare",
};
export const toProviderKey = (p: string): AiProviderKey =>
  p === "anthropic" ? "ANTHROPIC" : p === "openai" ? "OPENAI" : p === "replicate" ? "REPLICATE" : "OTHER";

const MAX_EVENTS = 1000;
const RATE_WINDOW_MS = 15 * 60_000;
const RATE_SUSTAINED = 10;
const DAY_MS = 24 * 60 * 60_000;
const ERROR_KEEP_DAYS = 30;

const num = (v: unknown, max = 1e9) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.min(v, max) : 0);
const str = (v: unknown, max: number, fallback: string) =>
  (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "") || fallback;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
const usdFmt = (v: number) => `$${v.toFixed(2)}`;

// ─── Primirea evenimentelor ─────────────────────────────────────────────────

type Agg = {
  date: string;
  provider: ReportedProvider;
  model: string;
  feature: string;
  calls: number;
  errors: number;
  unpriced: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  seconds: number;
  costUsd: number;
  clientCostUsd: number;
};
type ErrRow = { provider: ReportedProvider; model: string; feature: string; kind: AiErrorKind; message: string; at: Date };

export async function ingestAiUsage(project: string, raw: unknown): Promise<{ accepted: number }> {
  const list = Array.isArray(raw) ? raw.slice(0, MAX_EVENTS) : [];
  const now = Date.now();
  const groups = new Map<string, Agg>();
  const errors: ErrRow[] = [];
  const okProviders = new Set<ReportedProvider>();

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const provider = (REPORTED_PROVIDERS as readonly string[]).includes(String(e.provider)) ? (e.provider as ReportedProvider) : "other";
    const model = str(e.model, 100, "necunoscut");
    const feature = str(e.feature, 60, "general");
    const parsed = typeof e.ts === "string" ? Date.parse(e.ts) : NaN;
    // Ora aplicatiei poate fi gresita: acceptam ultimele 3 zile si cel mult 5 minute in viitor
    const at = new Date(Number.isFinite(parsed) && parsed <= now + 5 * 60_000 && parsed >= now - 3 * DAY_MS ? parsed : now);
    const ok = e.ok !== false;
    const count = Math.max(1, Math.round(num(e.count, 1000)) || 1);
    const t = {
      inputTokens: Math.round(num(e.inputTokens)),
      outputTokens: Math.round(num(e.outputTokens)),
      cachedTokens: Math.round(num(e.cachedTokens)),
      cacheWriteTokens: Math.round(num(e.cacheWriteTokens)),
    };
    const hasTokens = t.inputTokens + t.outputTokens > 0;
    // Costul recalculat aici cand stim modelul (OpenAI / Anthropic); altfel cel trimis de aplicatie (plafonat la 50 $ pe eveniment)
    const server = hasTokens && (provider === "openai" || provider === "anthropic") ? tokenCostUsd(model, t) : null;
    const client = typeof e.costUsd === "number" && Number.isFinite(e.costUsd) && e.costUsd >= 0 ? Math.min(e.costUsd, 50) : null;
    const cost = server ?? client ?? 0;

    const date = dayKey(at);
    const key = `${date}|${provider}|${model}|${feature}`;
    const g = groups.get(key) ?? {
      date,
      provider,
      model,
      feature,
      calls: 0,
      errors: 0,
      unpriced: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      seconds: 0,
      costUsd: 0,
      clientCostUsd: 0,
    };
    g.calls += count;
    if (!ok) g.errors += 1;
    if (ok && server === null && client === null) g.unpriced += count;
    g.inputTokens += t.inputTokens;
    g.outputTokens += t.outputTokens;
    g.cachedTokens += t.cachedTokens;
    g.seconds += num(e.seconds, 86_400);
    g.costUsd += cost;
    g.clientCostUsd += client ?? 0;
    groups.set(key, g);

    if (ok) okProviders.add(provider);
    else {
      const kind = (ERROR_KINDS as readonly string[]).includes(String(e.errorType)) ? (e.errorType as AiErrorKind) : "other";
      errors.push({ provider, model, feature, kind, message: str(e.errorMessage, 500, "Fără detalii."), at });
    }
  }

  for (const g of groups.values()) {
    const inc = {
      calls: { increment: g.calls },
      errors: { increment: g.errors },
      unpriced: { increment: g.unpriced },
      inputTokens: { increment: BigInt(g.inputTokens) },
      outputTokens: { increment: BigInt(g.outputTokens) },
      cachedTokens: { increment: BigInt(g.cachedTokens) },
      seconds: { increment: g.seconds },
      costUsd: { increment: g.costUsd },
      clientCostUsd: { increment: g.clientCostUsd },
    };
    await prisma.aiReportedDaily.upsert({
      where: { project_date_provider_model_feature: { project, date: dayDate(g.date), provider: g.provider, model: g.model, feature: g.feature } },
      create: {
        project,
        date: dayDate(g.date),
        provider: g.provider,
        model: g.model,
        feature: g.feature,
        calls: g.calls,
        errors: g.errors,
        unpriced: g.unpriced,
        inputTokens: BigInt(g.inputTokens),
        outputTokens: BigInt(g.outputTokens),
        cachedTokens: BigInt(g.cachedTokens),
        seconds: g.seconds,
        costUsd: g.costUsd,
        clientCostUsd: g.clientCostUsd,
      },
      update: inc,
    });
  }
  if (errors.length) {
    await prisma.aiReportedError.createMany({ data: errors.map((e) => ({ project, ...e })) });
    // Curatenie ocazionala
    if (Math.random() < 0.05) await prisma.aiReportedError.deleteMany({ where: { at: { lt: new Date(now - ERROR_KEEP_DAYS * DAY_MS) } } });
  }

  await errorAlerts(project, errors, okProviders).catch((e) => console.error("[ai-usage] alerte erori:", e));
  if ([...groups.values()].some((g) => g.costUsd > 0)) {
    await budgetAlerts(project).catch((e) => console.error("[ai-usage] alerte buget:", e));
  }
  return { accepted: list.length };
}

// ─── Alerte ─────────────────────────────────────────────────────────────────

// Rezerva trimiterea: true daca cheia nu a mai fost trimisa (sau a trecut `windowMs` de la ultima trimitere).
// windowMs null = o singura data pentru totdeauna (cheile de buget contin deja ziua / luna).
async function claim(key: string, kind: string, project: string, message: string, windowMs: number | null, active: boolean) {
  const now = new Date();
  const prev = await prisma.alertState.findUnique({ where: { key } });
  if (!prev) {
    try {
      await prisma.alertState.create({ data: { key, kind, project, message, active, failures: 1, lastSentAt: now } });
      return true;
    } catch {
      return false; // alta cerere a creat-o in paralel si trimite ea
    }
  }
  if (windowMs !== null) {
    const r = await prisma.alertState.updateMany({
      where: { key, OR: [{ lastSentAt: null }, { lastSentAt: { lt: new Date(now.getTime() - windowMs) } }] },
      data: { kind, message, active, lastSentAt: now, failures: { increment: 1 } },
    });
    if (r.count) return true;
  }
  await prisma.alertState.update({ where: { key }, data: { message, active, failures: { increment: 1 } } });
  return false;
}

// E-mailul n-a plecat: eliberam cheia ca sa reincercam la urmatorul raport
const release = (key: string) => prisma.alertState.update({ where: { key }, data: { lastSentAt: null } }).catch(() => undefined);

async function mail(key: string, title: string, lines: string[], color = "#b91c1c") {
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
    <h2 style="color:${color};margin:0 0 8px">${esc(title)}</h2>
    ${lines.map((l) => `<p style="font-size:15px;color:#222;margin:0 0 8px">${esc(l)}</p>`).join("")}
    <p style="color:#888;font-size:12px">${new Date().toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })} · <a href="https://mydashboard.ro/dashboard/ai">Costuri AI în mydashboard</a></p>
  </div>`;
  const sent = await sendEmail(`⚠ ${title}`, html, aiAlertTo());
  if (!sent) await release(key);
}

async function errorAlerts(project: string, errors: ErrRow[], okProviders: Set<ReportedProvider>) {
  const seen = new Set<string>();
  for (const e of errors) {
    const id = `${e.kind}|${e.provider}`;
    if (seen.has(id) || e.kind === "other") continue;
    seen.add(id);
    const name = REPORTED_PROVIDER_NAMES[e.provider];
    const key = `ai-${e.kind}:${project}:${e.provider}`;
    if (e.kind === "rate") {
      const recent = await prisma.aiReportedError.count({
        where: { project, provider: e.provider, kind: "rate", at: { gte: new Date(Date.now() - RATE_WINDOW_MS) } },
      });
      if (recent < RATE_SUSTAINED) continue;
      const msg = `${project}: ${name} respinge cererile pentru limită de viteză (${recent} în ultimele 15 minute). Ultimul mesaj: ${e.message}`;
      if (await claim(key, "ai-rate", project, msg, DAY_MS, true)) {
        await mail(key, `AI: limită de cereri – ${project} (${name})`, [
          msg,
          "Utilizatorii pot primi erori sau răspunsuri de rezervă. Verifică limitele contului (tier) sau redu frecvența apelurilor.",
        ]);
      }
      continue;
    }
    const msg =
      e.kind === "credit"
        ? `${project}: ${name} spune că s-au terminat creditele / cota (model ${e.model}, funcția „${e.feature}”). Mesaj: ${e.message}`
        : `${project}: ${name} refuză cheia API (invalidă, revocată sau fără drepturi; model ${e.model}, funcția „${e.feature}”). Mesaj: ${e.message}`;
    if (await claim(key, `ai-${e.kind}`, project, msg, DAY_MS, true)) {
      await mail(key, `AI: ${e.kind === "credit" ? "credit terminat" : "cheie invalidă"} – ${project} (${name})`, [
        msg,
        e.kind === "credit"
          ? "Funcțiile AI ale site-ului nu merg până nu reîncarci contul (sau crești limita de cheltuieli)."
          : "Funcțiile AI ale site-ului nu merg până nu pui o cheie validă în .env-ul aplicației.",
        "Primești cel mult un e-mail pe zi pentru aceeași problemă.",
      ]);
    }
  }
  // A mers din nou un apel la acel furnizor: alerta credit / cheie nu mai e activa (fara e-mail)
  const back = [...okProviders].filter((p) => !errors.some((e) => e.provider === p && (e.kind === "credit" || e.kind === "auth")));
  if (back.length) {
    await prisma.alertState.updateMany({
      where: { key: { in: back.flatMap((p) => [`ai-credit:${project}:${p}`, `ai-auth:${project}:${p}`]) }, active: true },
      data: { active: false, failures: 0 },
    });
  }
}

export async function budgetFor(project: string) {
  const b = await prisma.aiBudget.findUnique({ where: { project } });
  return b ? { dailyUsd: Number(b.dailyUsd), monthlyUsd: Number(b.monthlyUsd), custom: true } : { ...AI_DEFAULT_BUDGET, custom: false };
}

async function budgetAlerts(project: string) {
  const today = dayKey(new Date());
  const month = today.slice(0, 7);
  const [budget, day, mon] = await Promise.all([
    budgetFor(project),
    prisma.aiReportedDaily.aggregate({ where: { project, date: dayDate(today) }, _sum: { costUsd: true } }),
    prisma.aiReportedDaily.aggregate({ where: { project, date: { gte: dayDate(`${month}-01`), lte: dayDate(today) } }, _sum: { costUsd: true } }),
  ]);
  const dayUsd = Number(day._sum.costUsd ?? 0);
  const monthUsd = Number(mon._sum.costUsd ?? 0);
  const note = "Sumele sunt cele raportate de aplicație (estimate din tokeni). Bugetul se schimbă în mydashboard → Costuri AI.";

  if (budget.dailyUsd > 0 && dayUsd >= budget.dailyUsd) {
    const key = `ai-budget-day:${project}:${today}`;
    const msg = `${project} a consumat azi ${usdFmt(dayUsd)} pe AI, peste bugetul zilnic de ${usdFmt(budget.dailyUsd)}.`;
    if (await claim(key, "ai-budget", project, msg, null, false)) await mail(key, `AI: buget zilnic depășit – ${project}`, [msg, note]);
  }
  if (budget.monthlyUsd > 0 && monthUsd >= budget.monthlyUsd) {
    const key = `ai-budget-month:${project}:${month}`;
    const msg = `${project} a consumat luna aceasta ${usdFmt(monthUsd)} pe AI, peste bugetul lunar de ${usdFmt(budget.monthlyUsd)}.`;
    if (await claim(key, "ai-budget", project, msg, null, false)) await mail(key, `AI: buget lunar depășit – ${project}`, [msg, note]);
  } else if (budget.monthlyUsd > 0 && monthUsd >= budget.monthlyUsd * 0.8) {
    const key = `ai-budget-80:${project}:${month}`;
    const msg = `${project} a ajuns la ${usdFmt(monthUsd)} pe AI luna aceasta, ${Math.round((monthUsd / budget.monthlyUsd) * 100)}% din bugetul lunar de ${usdFmt(budget.monthlyUsd)}.`;
    if (await claim(key, "ai-budget", project, msg, null, false)) await mail(key, `AI: 80% din bugetul lunar – ${project}`, [msg, note], "#b45309");
  }
}

// ─── Citire: potrivirea cu proiectele din mydashboard si evitarea dublarii ──

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type ProjectRef = { id: string; name: string; domain: string | null };

// Numele raportat („PostingClips”, „3dview”) -> proiectul cu acelasi nume sau domeniu (postingclips.com)
export function matchProject(reported: string, projects: ProjectRef[]): ProjectRef | null {
  const r = norm(reported);
  if (!r) return null;
  return (
    projects.find((p) => norm(p.name) === r) ??
    projects.find((p) => {
      const host = (p.domain ?? "").replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/:]/)[0];
      return host && (norm(host.split(".")[0]) === r || norm(host) === r);
    }) ??
    null
  );
}

// Pentru ce proiect + furnizor avem deja costul facturat (cont Admin legat / conexiune Replicate): acolo nu adunam si costul raportat
export async function coveredSources(projectIds: string[]) {
  const [links, repl] = await Promise.all([
    prisma.aiProjectLink.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, account: { select: { provider: true } } } }),
    prisma.connection.findMany({ where: { projectId: { in: projectIds }, provider: "REPLICATE" }, select: { projectId: true } }),
  ]);
  const set = new Set<string>();
  for (const l of links) set.add(`${l.projectId}|${l.account.provider === "ANTHROPIC_ADMIN" ? "anthropic" : "openai"}`);
  for (const c of repl) set.add(`${c.projectId}|replicate`);
  return { has: (projectId: string, provider: string) => set.has(`${projectId}|${provider}`) };
}

export type ReportedLine = { projectId: string; provider: AiProviderKey; model: string; date: string; costUsd: number; inputTokens: number; outputTokens: number };

// Costurile raportate care NU sunt deja acoperite de o sursa facturata, pe proiect (pentru totaluri)
export async function reportedLinesFor(projects: ProjectRef[], since: string, until: string): Promise<ReportedLine[]> {
  if (!projects.length) return [];
  const rows = await prisma.aiReportedDaily.groupBy({
    by: ["project", "provider", "model", "date"],
    where: { date: { gte: dayDate(since), lte: dayDate(until) } },
    _sum: { costUsd: true, inputTokens: true, outputTokens: true },
  });
  const covered = await coveredSources(projects.map((p) => p.id));
  const out: ReportedLine[] = [];
  for (const r of rows) {
    const p = matchProject(r.project, projects);
    if (!p || covered.has(p.id, r.provider)) continue;
    const costUsd = Number(r._sum.costUsd ?? 0);
    if (!costUsd) continue;
    out.push({
      projectId: p.id,
      provider: toProviderKey(r.provider),
      model: r.model,
      date: r.date.toISOString().slice(0, 10),
      costUsd,
      inputTokens: Number(r._sum.inputTokens ?? 0),
      outputTokens: Number(r._sum.outputTokens ?? 0),
    });
  }
  return out;
}

// Costul raportat (neacoperit de alta sursa) pe proiect, in USD (pentru „Bani”)
export async function reportedUsdByProject(projectIds: string[], since: string, until: string) {
  const projects = await prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true, domain: true } });
  const out = new Map<string, number>();
  for (const l of await reportedLinesFor(projects, since, until)) out.set(l.projectId, (out.get(l.projectId) ?? 0) + l.costUsd);
  return out;
}

// ─── Pagina „Costuri AI”: sectiunea „Consum raportat de site-uri” ───────────

export async function getReportedOverview(projects: ProjectRef[], includeUnmatched: boolean) {
  const today = dayKey(new Date());
  const monthStart = `${today.slice(0, 8)}01`;
  const since30 = addDays(today, -29);
  const from = monthStart < since30 ? monthStart : since30;

  const [rows, errs, budgets, covered] = await Promise.all([
    prisma.aiReportedDaily.findMany({ where: { date: { gte: dayDate(from), lte: dayDate(today) } } }),
    prisma.aiReportedError.findMany({ where: { at: { gte: new Date(Date.now() - ERROR_KEEP_DAYS * DAY_MS) } }, orderBy: { at: "desc" }, take: 500 }),
    prisma.aiBudget.findMany(),
    coveredSources(projects.map((p) => p.id)),
  ]);

  type Prov = { today: number; month: number; last30: number; calls30: number; source: "raportat" | "facturat" };
  type Site = {
    project: string;
    projectId: string | null;
    projectName: string | null;
    today: number;
    month: number;
    last30: number;
    calls30: number;
    errors30: number;
    unpriced30: number;
    providers: Record<string, Prov>;
    features: Map<string, number>;
    lastError: { kind: string; provider: string; message: string; at: Date } | null;
    budget: { dailyUsd: number; monthlyUsd: number; custom: boolean };
  };
  const sites = new Map<string, Site>();
  const site = (name: string): Site | null => {
    let s = sites.get(name);
    if (s) return s;
    const p = matchProject(name, projects);
    if (!p && !includeUnmatched) return null;
    const b = budgets.find((x) => x.project === name);
    s = {
      project: name,
      projectId: p?.id ?? null,
      projectName: p?.name ?? null,
      today: 0,
      month: 0,
      last30: 0,
      calls30: 0,
      errors30: 0,
      unpriced30: 0,
      providers: {},
      features: new Map(),
      lastError: null,
      budget: b ? { dailyUsd: Number(b.dailyUsd), monthlyUsd: Number(b.monthlyUsd), custom: true } : { ...AI_DEFAULT_BUDGET, custom: false },
    };
    sites.set(name, s);
    return s;
  };

  for (const r of rows) {
    const s = site(r.project);
    if (!s) continue;
    const d = r.date.toISOString().slice(0, 10);
    const cost = Number(r.costUsd);
    const pv = (s.providers[r.provider] ??= {
      today: 0,
      month: 0,
      last30: 0,
      calls30: 0,
      source: s.projectId && covered.has(s.projectId, r.provider) ? "facturat" : "raportat",
    });
    if (d === today) {
      s.today += cost;
      pv.today += cost;
    }
    if (d >= monthStart) {
      s.month += cost;
      pv.month += cost;
    }
    if (d >= since30) {
      s.last30 += cost;
      pv.last30 += cost;
      pv.calls30 += r.calls;
      s.calls30 += r.calls;
      s.errors30 += r.errors;
      s.unpriced30 += r.unpriced;
      s.features.set(r.feature, (s.features.get(r.feature) ?? 0) + cost);
    }
  }
  for (const e of errs) {
    const s = site(e.project);
    if (s && !s.lastError) s.lastError = { kind: e.kind, provider: e.provider, message: e.message, at: e.at };
  }

  return {
    today,
    sites: [...sites.values()]
      .map((s) => ({
        ...s,
        features: [...s.features].sort((a, b) => b[1] - a[1]).slice(0, 4),
        providers: Object.entries(s.providers).sort((a, b) => b[1].last30 - a[1].last30),
      }))
      .sort((a, b) => b.month - a.month || a.project.localeCompare(b.project)),
  };
}

export type ReportedOverview = Awaited<ReturnType<typeof getReportedOverview>>;
