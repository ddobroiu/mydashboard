// ElevenLabs (vocea din PostingClips): doar citire, GET /v1/user/subscription (gratuit, nu consuma caractere).
// Cheia: ELEVENLABS_API_KEY. Fara cheie nu facem niciun apel.

export type ElevenLabsSubscription = {
  tier: string;
  characterCount: number;
  characterLimit: number;
  // cand se reseteaza caracterele (inceputul noii perioade de facturare)
  resetAt: Date | null;
  status: string | null;
  currency: string | null;
  // ce ar urma sa plateasca la urmatoarea factura, daca API-ul o spune (in moneda de mai sus)
  nextInvoice: number | null;
};

export type ElevenLabsResult =
  | { ok: true; sub: ElevenLabsSubscription }
  | { ok: false; reason: "no-key" | "auth" | "error"; detail: string };

const URL_SUB = "https://api.elevenlabs.io/v1/user/subscription";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export async function fetchElevenLabsSubscription(key = process.env.ELEVENLABS_API_KEY?.trim()): Promise<ElevenLabsResult> {
  if (!key) return { ok: false, reason: "no-key", detail: "lipsește cheia ElevenLabs (ELEVENLABS_API_KEY)" };
  let res: Response;
  try {
    res = await fetch(URL_SUB, { headers: { "xi-api-key": key, Accept: "application/json" }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  } catch (e) {
    return { ok: false, reason: "error", detail: `ElevenLabs nu răspunde (${e instanceof Error && e.name === "TimeoutError" ? "peste 15 secunde" : "nu se poate conecta"})` };
  }
  // 401 = cheie gresita / revocata; 403 = cheia nu are dreptul „user_read”
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "auth", detail: `ElevenLabs a refuzat cheia (HTTP ${res.status})` };
  }
  if (!res.ok) return { ok: false, reason: "error", detail: `ElevenLabs a răspuns cu eroarea HTTP ${res.status}` };
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!j) return { ok: false, reason: "error", detail: "ElevenLabs a trimis un răspuns ilizibil" };
  const reset = num(j.next_character_count_reset_unix);
  const inv = j.next_invoice as Record<string, unknown> | null | undefined;
  const cents = num(inv?.amount_due_cents);
  return {
    ok: true,
    sub: {
      tier: typeof j.tier === "string" ? j.tier : "necunoscut",
      characterCount: num(j.character_count) ?? 0,
      characterLimit: num(j.character_limit) ?? 0,
      resetAt: reset ? new Date(reset * 1000) : null,
      status: typeof j.status === "string" ? j.status : null,
      currency: typeof j.currency === "string" ? j.currency.toUpperCase() : null,
      nextInvoice: cents == null ? null : cents / 100,
    },
  };
}
