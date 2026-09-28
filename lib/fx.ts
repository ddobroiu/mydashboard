// Cursul BNR (lei pentru 1 unitate), ca sa adunam sume in monede diferite (EUR, USD, RON).
// Citit o data la 12 ore; daca BNR nu raspunde folosim ultimul curs stiut sau unul aproximativ.
const FALLBACK: Record<string, number> = { RON: 1, EUR: 5.25, USD: 4.6, GBP: 6.1 };
const TTL = 12 * 60 * 60 * 1000;

let cache: { at: number; rates: Record<string, number>; live: boolean } | null = null;

export type Rates = { rates: Record<string, number>; live: boolean };

export async function getRates(): Promise<Rates> {
  if (cache && Date.now() - cache.at < TTL) return cache;
  try {
    const res = await fetch("https://curs.bnr.ro/nbrfxrates.xml", { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const xml = await res.text();
    const rates: Record<string, number> = { RON: 1 };
    for (const m of xml.matchAll(/<Rate currency="([A-Z]{3})"(?: multiplier="(\d+)")?>([\d.]+)<\/Rate>/g)) {
      rates[m[1]] = Number(m[3]) / Number(m[2] ?? 1);
    }
    if (!rates.EUR) throw new Error("fără EUR");
    cache = { at: Date.now(), rates, live: true };
  } catch {
    // reincercam peste 10 minute
    cache = { at: Date.now() - TTL + 10 * 60 * 1000, rates: cache?.rates ?? FALLBACK, live: cache?.live ?? false };
  }
  return cache;
}

// Suma din moneda `from` in moneda `to`
export function convert(r: Rates, amount: number, from: string, to: string): number {
  if (!amount || from === to) return amount;
  const a = r.rates[from.toUpperCase()] ?? FALLBACK[from.toUpperCase()];
  const b = r.rates[to.toUpperCase()] ?? FALLBACK[to.toUpperCase()];
  if (!a || !b) return amount;
  return (amount * a) / b;
}
