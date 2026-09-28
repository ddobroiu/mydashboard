import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

// Schimbarea fata de perioada dinainte, ca sageata + procent.
// lowerIsBetter: la costuri si la pozitia in Google, scaderea e de bine.
export function Trend({ cur, prev, lowerIsBetter = false, label }: { cur: number; prev: number | null; lowerIsBetter?: boolean; label?: string }) {
  if (prev === null) return null;
  if (prev === 0 && cur === 0) return <span className="inline-flex items-center gap-0.5 text-xs text-text-3"><Minus size={12} /> la fel</span>;
  if (prev === 0) return <span className="text-xs font-medium text-good">nou{label ? ` ${label}` : ""}</span>;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 1) return <span className="inline-flex items-center gap-0.5 text-xs text-text-3"><Minus size={12} /> la fel{label ? ` ${label}` : ""}</span>;
  const up = pct > 0;
  const good = up !== lowerIsBetter;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular ${good ? "text-good" : "text-bad"}`}>
      <Icon size={14} aria-hidden />
      {up ? "+" : "−"}
      {Math.abs(pct) >= 1000 ? "999+" : Math.abs(pct).toLocaleString("ro-RO", { maximumFractionDigits: 0 })}%
      {label && <span className="font-normal text-text-3">&nbsp;{label}</span>}
    </span>
  );
}

// Cifra mare cu eticheta scurta si sageata fata de perioada dinainte
export function Stat({
  label,
  value,
  cur,
  prev,
  lowerIsBetter,
  sub,
  tone,
  trendLabel,
}: {
  label: string;
  value: string;
  cur?: number;
  prev?: number | null;
  lowerIsBetter?: boolean;
  sub?: React.ReactNode;
  tone?: "good" | "bad";
  trendLabel?: string;
}) {
  return (
    <div className="card p-4">
      <div className="text-sm text-text-2">{label}</div>
      <div className={`mt-1 text-2xl md:text-3xl font-semibold tabular ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-3">
        {cur !== undefined && prev !== undefined && <Trend cur={cur} prev={prev} lowerIsBetter={lowerIsBetter} label={trendLabel} />}
        {sub}
      </div>
    </div>
  );
}

export const nf = (v: number) => Math.round(v).toLocaleString("ro-RO");
