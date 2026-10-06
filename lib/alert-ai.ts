import { prisma } from "@/lib/prisma";
import { type AlertExplanation, type AlertInput, explainByRules, messageSignature, readStoredExplanation, scrubSecrets } from "@/lib/alert-explain";

// Stratul 2: explicatia cu AI (Claude Haiku 4.5) doar pentru alertele pe care regulile nu le recunosc.
// Limitat: cel mult ALERT_AI_MAX_PER_HOUR apeluri pe ora (implicit 10, numarate in baza de date), mesaj scurt fara secrete,
// rezultatul salvat pe alerta (AlertState.explanation) si refolosit cat timp mesajul are aceeasi forma.
// Fara ANTHROPIC_API_KEY: doar reguli.
const MODEL = "claude-haiku-4-5";
const HOUR_MS = 60 * 60 * 1000;
const RETRY_FAILED_MS = 24 * HOUR_MS;
const maxPerHour = () => Math.max(0, Number(process.env.ALERT_AI_MAX_PER_HOUR ?? 10) || 0);

const SYSTEM = `Explici erori tehnice ale unui site unui proprietar de firmă din România care NU e programator.
Răspunzi DOAR cu un obiect JSON, fără alt text:
{"title":"...","what":"...","customers":"...","severity":"Urgent|Important|Mic","action":"...","who":"programator|tu|amândoi|nimeni"}
- title: max 8 cuvinte, fără numele site-ului, ce nu merge (ex. "pagina de facturi nu se deschide").
- what: o propoziție, fără jargon (fără cuvinte ca Prisma, stack, undefined, ENOENT).
- customers: începe cu "Da —", "Nu —" sau "Puțin —" și spune ce ar observa un client.
- severity: Urgent = site/plăți căzute; Important = o pagină sau funcție nu merge; Mic = efect mărunt.
- action: concret; spune cine face: programatorul (Claude) repară codul/serverul, proprietarul ("tu") doar plăți, conturi, credite.`;

type Row = { key: string; kind: string; project: string | null; message: string; explanation: unknown; explainedAt: Date | null };

let localCalls: number[] = []; // a doua plasa de siguranta, in memorie (cereri paralele)

async function underLimit(): Promise<boolean> {
  const max = maxPerHour();
  if (!max) return false;
  const since = Date.now() - HOUR_MS;
  localCalls = localCalls.filter((t) => t > since);
  if (localCalls.length >= max) return false;
  const used = await prisma.alertState.count({ where: { explainedAt: { gte: new Date(since) } } });
  return used < max;
}

async function callHaiku(a: AlertInput, key: string): Promise<AlertExplanation | null> {
  const msg = scrubSecrets(a.message).slice(0, 700);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 350,
      system: SYSTEM,
      messages: [{ role: "user", content: `Tip alertă: ${a.kind}\nSite: ${a.project ?? "necunoscut"}\nMesaj tehnic:\n${msg}` }],
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { content?: { type: string; text?: string }[] } | null;
  const text = data?.content?.find((c) => c.type === "text")?.text ?? "";
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    return readStoredExplanation({ ...JSON.parse(json), source: "ai" });
  } catch {
    return null;
  }
}

/**
 * Daca regulile nu recunosc cauza, cere (o data) explicatia de la AI si o salveaza pe alerta.
 * Se apeleaza dupa ce randul AlertState exista. Nu arunca erori.
 */
export async function ensureAiExplanation(key: string): Promise<void> {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return;
    const row = (await prisma.alertState.findUnique({
      where: { key },
      select: { key: true, kind: true, project: true, message: true, explanation: true, explainedAt: true },
    })) as Row | null;
    if (!row) return;
    const rules = explainByRules(row);
    if (rules?.source === "reguli" || rules?.local) return; // regulile stiu deja cauza / test local
    const sig = messageSignature(row.message);
    const stored = row.explanation as { sig?: string; source?: string } | null;
    if (stored?.sig === sig) {
      if (stored.source === "ai") return; // deja explicata
      if (row.explainedAt && Date.now() - row.explainedAt.getTime() < RETRY_FAILED_MS) return; // a esuat recent
    }
    if (!(await underLimit())) return;
    localCalls.push(Date.now());
    const e = await callHaiku(row, apiKey);
    await prisma.alertState.update({
      where: { key },
      data: { explanation: e ? { ...e, sig } : { source: "ai-failed", sig }, explainedAt: new Date() },
    });
  } catch (err) {
    console.error("[alert-ai]", err instanceof Error ? err.message : "eroare");
  }
}
