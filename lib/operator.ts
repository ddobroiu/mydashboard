// API-ul pentru robotul-operator (Telegram): DOAR CITIRE, protejat cu antetul  Authorization: Bearer <OPERATOR_TOKEN>.
// Robotul vede tot ce vede proprietarul in mydashboard despre aplicatii (conturi noi, vanzari, e-mailuri, alerte,
// erori, „De facut”) fara parole de baze de date. Fara OPERATOR_TOKEN (sau prea scurt) API-ul e oprit (404).
// Doar aplicatiile: print are panoul lui, platformele 3D vor avea panoul lor.
import crypto from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAppStats, type AppStats } from "@/lib/app-stats";
import { countersByProject, latestImportant, listThreads, missingTable, syncStatus, type ThreadRow } from "@/lib/email-inbox/admin";
import { keyOfProject, MAIL_PROJECTS, PROJECT_KEYS, type MailProjectKey } from "@/lib/email-inbox/projects";
import { activeAppAlerts, getTasks } from "@/lib/tasks";

const sha = (s: string) => crypto.createHash("sha256").update(s).digest();

/** null = acces permis; altfel raspunsul de refuz. */
export function operatorDenied(req: Request): NextResponse | null {
  const token = process.env.OPERATOR_TOKEN || "";
  if (token.length < 32) return NextResponse.json({ error: "not found" }, { status: 404 });
  const got = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!got || !crypto.timingSafeEqual(sha(got), sha(token))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

/** ?since= : „24h”, „7d”, „90m” sau o data ISO. Implicit 24 h, cel mult 31 de zile in urma. */
export function parseSince(v: string | null, now = new Date(), def = 24 * 3600_000): Date {
  const max = 31 * 86_400_000;
  let ms = def;
  const m = String(v || "").trim().match(/^(\d{1,4})\s*(m|h|d)$/i);
  if (m) ms = Number(m[1]) * ({ m: 60_000, h: 3600_000, d: 86_400_000 } as const)[m[2].toLowerCase() as "m" | "h" | "d"];
  else if (v) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) ms = now.getTime() - d.getTime();
  }
  return new Date(now.getTime() - Math.min(Math.max(ms, 60_000), max));
}

/** Proiectele din mydashboard care sunt aplicatii (cheie → proiect). */
export async function appProjects() {
  const all = await prisma.project.findMany({ select: { id: true, name: true, domain: true, currency: true } });
  const out = new Map<MailProjectKey, (typeof all)[number]>();
  for (const p of all) {
    const k = keyOfProject(p);
    if (k && !out.has(k)) out.set(k, p);
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function salesSince(since: Date) {
  const apps = await appProjects();
  const ids = [...apps.values()].map((p) => p.id);
  const keyById = new Map([...apps].map(([k, p]) => [p.id, k]));
  const [groups, recent] = await Promise.all([
    prisma.transaction.groupBy({ by: ["projectId", "currency"], where: { projectId: { in: ids }, occurredAt: { gte: since } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.transaction.findMany({
      where: { projectId: { in: ids }, occurredAt: { gte: since } },
      orderBy: { occurredAt: "desc" },
      take: 50,
      select: { projectId: true, occurredAt: true, amount: true, currency: true, customer: true, provider: true, utmSource: true },
    }),
  ]);
  const byProject: Record<string, { count: number; amounts: Record<string, number> }> = {};
  for (const g of groups) {
    const k = keyById.get(g.projectId)!;
    const r = (byProject[k] ||= { count: 0, amounts: {} });
    r.count += g._count._all;
    r.amounts[g.currency] = round((r.amounts[g.currency] || 0) + Number(g._sum.amount ?? 0));
  }
  const total = { count: 0, amounts: {} as Record<string, number> };
  for (const r of Object.values(byProject)) {
    total.count += r.count;
    for (const [c, v] of Object.entries(r.amounts)) total.amounts[c] = round((total.amounts[c] || 0) + v);
  }
  return {
    since: since.toISOString(),
    total,
    byProject,
    recent: recent.map((t) => ({
      project: keyById.get(t.projectId),
      at: t.occurredAt.toISOString(),
      amount: Number(t.amount),
      currency: t.currency,
      customer: t.customer,
      provider: t.provider,
      source: t.utmSource,
    })),
  };
}

const SIGNUP_RE = /cont|signup|sign-up|inscri|înscri|inregistr|înregistr|utilizator|user|client(i)? no/i;

/** Randul de conturi noi din cifrele aplicatiei (/api/mydashboard/stats). */
export function signupKpi(stats: AppStats) {
  return stats.kpi.find((k) => k.unit === "count" && (SIGNUP_RE.test(k.key) || SIGNUP_RE.test(k.label)));
}

/** Valoarea pentru fereastra ceruta: ≤ 24 h → h24 (sau azi), ≤ 7 zile → d7, altfel d30. */
export function windowValue(k: { h24?: number | null; today?: number | null; d7?: number | null; d30?: number | null }, since: Date, now = new Date()) {
  const ms = now.getTime() - since.getTime();
  if (ms <= 26 * 3600_000) return k.h24 != null ? { value: k.h24, basis: "24h" } : { value: k.today ?? null, basis: "azi" };
  if (ms <= 7 * 86_400_000) return { value: k.d7 ?? null, basis: "7 zile" };
  return { value: k.d30 ?? null, basis: "30 zile" };
}

export async function signupsSince(since: Date, now = new Date()) {
  const apps = await appProjects();
  const rows = await Promise.all(
    [...apps].map(async ([key, p]) => {
      const st = await getAppStats(p.name, p.domain).catch(() => null);
      if (!st || !st.ok) return { project: key, available: false as const, error: st && !st.ok && st.reason === "error" ? st.error ?? "eroare" : null };
      const k = signupKpi(st.stats);
      const recent = (st.stats.recent || []).filter((r) => {
        const d = new Date(r.at);
        return !isNaN(d.getTime()) && d >= since;
      });
      return {
        project: key,
        available: true as const,
        signups: k ? { label: k.label, ...windowValue(k, since, now), total: k.total ?? null } : null,
        // tot ce a raportat aplicatia de la `since` (conturi, comenzi, plati), cel mult 20
        activity: recent.slice(0, 20),
        kpi: st.stats.kpi.map((x) => ({ key: x.key, label: x.label, unit: x.unit, ...windowValue(x, since, now) })),
      };
    }),
  );
  const total = rows.reduce((s, r) => s + (r.available && r.signups?.value ? r.signups.value : 0), 0);
  return { since: since.toISOString(), total, byProject: rows };
}

export async function alertsView() {
  const list = await activeAppAlerts();
  return list.map((a) => ({
    key: a.key,
    project: a.projectKey ?? a.project,
    kind: a.kind,
    severity: a.e.severity,
    title: a.e.title,
    what: a.e.what,
    customers: a.e.customers,
    action: a.e.action,
    who: a.e.who,
    since: a.createdAt.toISOString(),
    lastSeen: a.updatedAt.toISOString(),
    times: a.failures,
  }));
}

export async function errorsSince(since: Date) {
  const rows = await prisma.aiReportedError.groupBy({ by: ["project", "kind"], where: { at: { gte: since } }, _count: { _all: true }, _max: { at: true } });
  return rows
    .map((r) => ({ project: keyOfProject({ name: r.project, domain: null }) ?? r.project, kind: r.kind, count: r._count._all, last: r._max.at?.toISOString() ?? null }))
    .filter((r) => PROJECT_KEYS.includes(r.project as MailProjectKey));
}

/** Pentru robot: conversatia fara HTML (doar text, fara istoricul citat lung). */
export const emailRow = (t: ThreadRow) => ({
  id: t.id,
  project: t.project,
  mailbox: t.mailbox,
  subject: t.subject,
  from: t.email,
  name: t.name,
  category: t.category,
  tag: t.tag,
  status: t.status,
  unread: t.unread,
  possibleLead: t.possibleLead,
  leadSignals: t.leadSignals,
  lastDirection: t.lastDirection,
  lastMessageAt: t.lastMessageAt,
  preview: t.preview,
  messages: t.messageCount,
  hasAttachments: t.hasAttachments,
});

export async function emailsOverview() {
  try {
    const [byProject, important, sync] = await Promise.all([countersByProject(), latestImportant(10), syncStatus()]);
    return {
      ready: true,
      byProject: Object.fromEntries(byProject),
      important: important.map(emailRow),
      mailboxes: sync.configured.map((c) => {
        const st = sync.state.filter((s) => s.address === c.address);
        return {
          address: c.address,
          project: c.project,
          lastSyncAt: st.map((s) => s.lastSyncAt).filter(Boolean).sort().pop() ?? null,
          error: st.find((s) => s.lastError)?.lastError ?? null,
        };
      }),
    };
  } catch (e) {
    if (missingTable(e)) return { ready: false, byProject: {}, important: [], mailboxes: [] };
    throw e;
  }
}

export async function emailsList(opts: { unread?: boolean; project?: string; view?: string; since?: Date; q?: string; limit?: number }) {
  const view = opts.unread ? "unread" : (opts.view as Parameters<typeof listThreads>[0]["view"]) || "inbox";
  const rows = await listThreads({ view, project: opts.project, q: opts.q, since: opts.since, take: Math.min(opts.limit || 50, 200) });
  return rows.map(emailRow);
}

export async function summary(since: Date, now = new Date()) {
  const [sales, signups, alerts, errors, emails, tasks] = await Promise.all([
    salesSince(since),
    signupsSince(since, now),
    alertsView(),
    errorsSince(since),
    emailsOverview(),
    getTasks(now),
  ]);
  const projects = PROJECT_KEYS.map((key) => {
    const s = signups.byProject.find((r) => r.project === key);
    const em = (emails.byProject as Record<string, { unread: number; leads: number; awaiting: number; system: number }>)[key];
    return {
      key,
      name: MAIL_PROJECTS[key].name,
      domain: MAIL_PROJECTS[key].domain,
      sales: sales.byProject[key] ?? { count: 0, amounts: {} },
      signups: s?.available ? s.signups : null,
      appStats: s ? (s.available ? "ok" : s.error ? `eroare: ${s.error}` : "fără endpoint") : "proiect lipsă în mydashboard",
      emails: em ?? { unread: 0, leads: 0, awaiting: 0, system: 0 },
      alerts: alerts.filter((a) => a.project === key).map((a) => ({ severity: a.severity, title: a.title, action: a.action, since: a.since })),
      errors: errors.filter((e) => e.project === key),
    };
  });
  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    totals: {
      sales: sales.total,
      signups: signups.total,
      unreadEmails: Object.values(emails.byProject as Record<string, { unread: number }>).reduce((a, b) => a + b.unread, 0),
      possibleLeads: Object.values(emails.byProject as Record<string, { leads: number }>).reduce((a, b) => a + b.leads, 0),
      awaitingReply: Object.values(emails.byProject as Record<string, { awaiting: number }>).reduce((a, b) => a + b.awaiting, 0),
      activeAlerts: alerts.length,
      urgentAlerts: alerts.filter((a) => a.severity === "Urgent").length,
      aiErrors: errors.reduce((a, b) => a + b.count, 0),
      tasks: tasks.tasks.length,
    },
    projects,
    importantEmails: emails.important,
    tasks: tasks.tasks.slice(0, 20),
    mailboxes: emails.mailboxes,
    emailReady: emails.ready,
    notes: "Doar citire. Trimiterea de răspunsuri, plăți, ștergeri și publicări cer aprobarea proprietarului.",
  };
}
