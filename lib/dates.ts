export const TZ = "Europe/Bucharest";

// "YYYY-MM-DD" in fusul orar al Romaniei
export function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Coloanele @db.Date se salveaza ca miezul noptii UTC al zilei respective
export function dayDate(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

export function addDays(key: string, n: number): string {
  const d = dayDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function lastNDays(n: number): { since: string; until: string } {
  const until = dayKey(new Date());
  return { since: addDays(until, -(n - 1)), until };
}

export function eachDay(since: string, until: string): string[] {
  const out: string[] = [];
  for (let k = since; k <= until; k = addDays(k, 1)) out.push(k);
  return out;
}
