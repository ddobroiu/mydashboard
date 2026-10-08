import { prisma } from "@/lib/prisma";
import { TZ, dayDate } from "@/lib/dates";
import { raiseAlert, resolveAlert } from "@/lib/alerts";
import { matchProject } from "@/lib/ai-usage";
import { fetchElevenLabsSubscription, type ElevenLabsResult } from "@/lib/integrations/elevenlabs";

// ElevenLabs = vocea din PostingClips. Doua lucruri:
//  1. costul: abonamentul lunar (ELEVENLABS_MONTHLY_USD, implicit 6 $ = Starter; Creator = 22 $), impartit pe zile
//     si pus la costurile AI ale proiectului PostingClips (deci si in profit);
//  2. consumul de caractere din luna (GET /v1/user/subscription, gratuit), cu alerte la 80%, 95% si 100%
//     si daca cheia e refuzata (401). Citirea e tinuta in memorie o ora; /api/cron/sync o reimprospateaza.

const CACHE_MS = 60 * 60 * 1000;
const DEFAULT_MONTHLY_USD = 6;

// Proiectul caruia ii apartine costul (dupa nume sau domeniu), implicit „postingclips”
export const elevenLabsProject = () => process.env.ELEVENLABS_PROJECT?.trim() || "postingclips";

const hasKey = () => Boolean(process.env.ELEVENLABS_API_KEY?.trim());

// Abonamentul lunar in USD. Se socoteste doar daca avem cheia sau daca pretul e pus explicit (0 = nu socoti).
export function elevenLabsMonthlyUsd(): number {
  const raw = process.env.ELEVENLABS_MONTHLY_USD?.trim();
  const v = raw ? Number(raw.replace(",", ".")) : NaN;
  if (Number.isFinite(v) && v >= 0) return v;
  return hasKey() ? DEFAULT_MONTHLY_USD : 0;
}

// Costul pe zi: abonamentul lunar * 12 / 365
export const elevenLabsDailyUsd = () => (elevenLabsMonthlyUsd() * 12) / 365;

type Ref = { id: string; name: string; domain?: string | null };

// Costul ElevenLabs pe interval, atribuit proiectului PostingClips (pentru „Bani” si prima pagina)
export function elevenLabsUsdByProject(projects: Ref[], since: string, until: string): Map<string, number> {
  const out = new Map<string, number>();
  const daily = elevenLabsDailyUsd();
  if (daily <= 0 || until < since) return out;
  const p = matchProject(elevenLabsProject(), projects.map((x) => ({ ...x, domain: x.domain ?? null })));
  if (!p) return out;
  const days = Math.round((dayDate(until).getTime() - dayDate(since).getTime()) / 86_400_000) + 1;
  out.set(p.id, daily * days);
  return out;
}

// ─── Consumul de caractere ──────────────────────────────────────────────────

type Cached = { at: number; r: ElevenLabsResult };
const g = globalThis as unknown as { __elevenlabs?: Cached };

export async function getElevenLabs(force = false): Promise<ElevenLabsResult> {
  const c = g.__elevenlabs;
  if (!force && c && Date.now() - c.at < CACHE_MS) return c.r;
  const r = await fetchElevenLabsSubscription();
  g.__elevenlabs = { at: Date.now(), r };
  return r;
}

export const resetLabel = (d: Date | null) =>
  d ? d.toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: TZ }) : "resetarea lunară";

export type VoiceStatus =
  | { ok: true; tier: string; used: number; limit: number; pct: number; resetAt: Date | null; monthlyUsd: number }
  | { ok: false; reason: string; monthlyUsd: number };

// Randul „Voce (ElevenLabs)” de pe cardul PostingClips. Nu tine pagina in loc mai mult decat cererea (15 s, apoi cache).
export async function getVoiceStatus(): Promise<VoiceStatus> {
  const monthlyUsd = elevenLabsMonthlyUsd();
  const r = await getElevenLabs().catch(() => ({ ok: false as const, reason: "error" as const, detail: "eroare la citire" }));
  if (!r.ok) {
    const reason = r.reason === "no-key" ? "lipsește cheia ElevenLabs" : r.reason === "auth" ? "ElevenLabs refuză cheia (ștearsă sau greșită)" : "ElevenLabs nu răspunde acum";
    return { ok: false, reason, monthlyUsd };
  }
  const { tier, characterCount: used, characterLimit: limit, resetAt } = r.sub;
  return { ok: true, tier, used, limit, pct: limit > 0 ? (used / limit) * 100 : 0, resetAt, monthlyUsd };
}

// ─── Alerte (din /api/cron/sync) ───────────────────────────────────────────

const USAGE_PREFIX = "elevenlabs:usage:";
const AUTH_KEY = "elevenlabs:auth";
const THRESHOLDS = [100, 95, 80] as const;
const fmtN = (v: number) => Math.round(v).toLocaleString("ro-RO");

// O singura trimitere pe cheie: daca e-mailul a plecat deja si problema e inca activa, nu mai trimitem
async function raiseOnce(key: string, project: string, message: string) {
  const prev = await prisma.alertState.findUnique({ where: { key }, select: { active: true, lastSentAt: true } });
  if (prev?.active && prev.lastSentAt) return { sent: false, already: true };
  return raiseAlert({ key, kind: "voice", project, message });
}

// Inchide fara e-mail alertele de consum care nu mai sunt valabile (alta perioada / prag mai mic / plan marit)
async function closeUsage(keep: string | null) {
  await prisma.alertState.updateMany({
    where: { key: { startsWith: USAGE_PREFIX }, active: true, ...(keep ? { NOT: { key: keep } } : {}) },
    data: { active: false, failures: 0 },
  });
}

export async function checkElevenLabsAlerts() {
  const r = await getElevenLabs(true);
  if (!r.ok && r.reason === "no-key") return { ok: true as const, skipped: "fără cheie" };

  const projects = await prisma.project.findMany({ select: { id: true, name: true, domain: true } });
  const project = matchProject(elevenLabsProject(), projects)?.name ?? "PostingClips";

  if (!r.ok && r.reason === "auth") {
    await raiseOnce(
      AUTH_KEY,
      project,
      `ElevenLabs nu mai acceptă cheia de acces (cheie greșită sau revocată): mydashboard nu mai vede consumul, iar vocea din PostingClips probabil nu mai merge. Fă o cheie nouă în ElevenLabs și pune-o în setări. [${r.detail}]`,
    );
    return { ok: false as const, error: r.detail };
  }
  if (!r.ok) return { ok: false as const, error: r.detail };

  // Cheia merge iar: alerta de cheie se inchide (cu „si-a revenit”, daca o anuntasem)
  const auth = await prisma.alertState.findUnique({ where: { key: AUTH_KEY }, select: { active: true, lastSentAt: true } });
  if (auth?.active) {
    await resolveAlert(AUTH_KEY, "ElevenLabs acceptă din nou cheia; vocea din PostingClips poate merge.");
  }

  const { characterCount: used, characterLimit: limit, resetAt } = r.sub;
  if (limit <= 0) return { ok: true as const, pct: null };
  const pct = (used / limit) * 100;
  const t = THRESHOLDS.find((x) => pct >= x);
  if (!t) {
    await closeUsage(null);
    return { ok: true as const, pct };
  }
  // O alerta pe prag pe perioada de facturare: perioada = data resetarii
  const period = resetAt ? String(Math.floor(resetAt.getTime() / 1000)) : new Date().toISOString().slice(0, 7);
  const key = `${USAGE_PREFIX}${t}:${period}`;
  const when = resetLabel(resetAt);
  const figures = `(${fmtN(used)} / ${fmtN(limit)} caractere, ${Math.floor(pct)}%; se resetează pe ${when})`;
  const message =
    t === 100
      ? `ElevenLabs a rămas fără credite: vocea din PostingClips nu mai merge până la ${when}. Treci pe un plan mai mare sau așteaptă resetarea. ${figures}`
      : t === 95
        ? `ElevenLabs a rămas aproape fără credite: s-au folosit 95% din caracterele lunii, iar vocea din PostingClips nu mai merge de la limită până la ${when}. Treci pe un plan mai mare sau așteaptă resetarea. ${figures}`
        : `ElevenLabs: s-au folosit 80% din caracterele lunii — vocea din PostingClips se oprește la limită. ${figures}`;
  await closeUsage(key);
  await raiseOnce(key, project, message);
  return { ok: true as const, pct, threshold: t };
}
