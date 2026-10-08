// Sume si numere pe romaneste: „1.234 lei”, „12,50 lei”, „89 €”. Sumele mici (sub 100) cu doua zecimale.
export function money(v: number, currency = "RON") {
  const abs = Math.abs(v);
  const fine = abs > 0 && abs < 100;
  const s = abs.toLocaleString("ro-RO", { minimumFractionDigits: fine ? 2 : 0, maximumFractionDigits: fine ? 2 : 0 });
  const sign = v < 0 && abs >= 0.005 ? "−" : "";
  const c = currency.toUpperCase();
  if (c === "RON") return `${sign}${s} lei`;
  if (c === "EUR") return `${sign}${s} €`;
  if (c === "USD") return `${sign}${s} $`;
  return `${sign}${s} ${c}`;
}

export const count = (v: number) => Math.round(v).toLocaleString("ro-RO");
