import { formatMoney, type Metrics } from "@/lib/metrics";

export function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="card p-4">
      <div className="text-sm text-text-2">{label}</div>
      <div
        className={`text-2xl font-semibold tabular mt-1 ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-text-3 mt-1">{sub}</div>}
    </div>
  );
}

export function KpiTiles({ m, currency }: { m: Metrics; currency: string }) {
  const roasTone = m.roas === null ? undefined : m.roas >= 1 ? "good" : "bad";
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <Tile label="Încasări" value={formatMoney(m.revenue, currency)} sub={`${m.orders} plăți`} />
      <Tile label="Cheltuieli reclame" value={formatMoney(m.spend, currency)} />
      <Tile
        label="ROAS"
        value={m.roas === null ? "–" : `${m.roas.toFixed(2)}x`}
        sub={m.roas === null ? "fără cheltuieli" : `${m.roas.toLocaleString("ro-RO", { maximumFractionDigits: 2 })} ${currency} încasați la 1 ${currency} cheltuit`}
        tone={roasTone}
      />
      <Tile label="Cost / comandă" value={m.cpa === null ? "–" : formatMoney(m.cpa, currency)} />
      <Tile
        label="Rămas după reclame"
        value={formatMoney(m.profitAfterAds, currency)}
        sub="încasări − reclame (fără TVA, cost produs)"
        tone={m.profitAfterAds >= 0 ? "good" : "bad"}
      />
    </div>
  );
}

export function CurrencyWarning({ currencies, currency }: { currencies: string[]; currency: string }) {
  const other = currencies.filter((c) => c !== currency);
  if (other.length === 0) return null;
  return (
    <div className="rounded-lg bg-warn-bg text-warn text-sm px-4 py-2">
      Atenție: există sume în {other.join(", ")}, adunate direct cu {currency}. Conversia valutară vine într-o fază
      următoare.
    </div>
  );
}
