// Preturile AI folosite la recalcularea costului raportat de aplicatii (POST /api/ingest/ai-usage).
// Acelasi tabel ca in _deploy/shared/ai-usage.ts (copia din aplicatii): cand se schimba un pret, se schimba in ambele.
// USD pe 1M tokeni; cachedMul = cat costa un token citit din cache fata de unul normal; scrierea in cache (Anthropic) 1,25x.

type Price = { in: number; out: number; cachedMul: number };

export const AI_PRICES: Record<string, Price> = {
  // OpenAI
  "gpt-5.6-luna": { in: 0.2, out: 1.2, cachedMul: 0.1 },
  "gpt-5.6-terra": { in: 2, out: 12, cachedMul: 0.1 },
  "gpt-5.6-sol": { in: 4, out: 20, cachedMul: 0.1 },
  "gpt-5-mini": { in: 0.25, out: 2, cachedMul: 0.1 },
  "gpt-4o-mini": { in: 0.15, out: 0.6, cachedMul: 0.5 },
  "gpt-4o": { in: 2.5, out: 10, cachedMul: 0.5 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6, cachedMul: 0.25 },
  // Anthropic
  "claude-haiku-4-5": { in: 1, out: 5, cachedMul: 0.1 },
  "claude-sonnet-5": { in: 2, out: 10, cachedMul: 0.1 },
  "claude-opus-5": { in: 5, out: 25, cachedMul: 0.1 },
  "claude-opus-5-5": { in: 4, out: 20, cachedMul: 0.1 },
};
const CACHE_WRITE_MUL = 1.25;
const KEYS = Object.keys(AI_PRICES).sort((a, b) => b.length - a.length);

// Cel mai lung prefix: „claude-haiku-4-5-20251001” -> claude-haiku-4-5, „gpt-4o-mini-2024-07-18” -> gpt-4o-mini
export function priceOf(model: string): Price | null {
  const m = String(model || "").toLowerCase().replace(/^(openai|anthropic)\//, "");
  const k = KEYS.find((key) => m === key || m.startsWith(`${key}-`) || m.startsWith(`${key}@`));
  return k ? AI_PRICES[k] : null;
}

// Costul din tokeni; null cand modelul nu e in tabel (atunci ramane costul trimis de aplicatie)
export function tokenCostUsd(
  model: string,
  t: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number },
): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const input = Math.max(0, t.inputTokens);
  const cached = Math.min(input, Math.max(0, t.cachedTokens));
  const written = Math.min(input - cached, Math.max(0, t.cacheWriteTokens));
  const plain = input - cached - written;
  const out = Math.max(0, t.outputTokens);
  return (plain * p.in + cached * p.in * p.cachedMul + written * p.in * CACHE_WRITE_MUL + out * p.out) / 1e6;
}
