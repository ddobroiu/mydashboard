import type { BusinessOverview, Figures } from "@/lib/overview";
import { count, money } from "@/lib/format";
import { Trend } from "@/components/Stat";
import { StatusChip, TechDetails } from "@/components/BusinessCard";

type Row = {
  label: string;
  get: (f: Figures) => number | null;
  fmt: "money" | "count";
  lowerIsBetter?: boolean;
  missing?: string;
};

// „Pe scurt” in pagina proiectului: azi / 7 zile / 30 de zile, cu sageata fata de perioada dinainte
export function BusinessDetail({ b }: { b: BusinessOverview }) {
  const ratio = (a: number | null, n: number | null) => (a != null && n ? a / n : null);
  const rows: Row[] = [
    { label: "Încasări", get: (f) => f.revenue, fmt: "money", missing: b.notes.revenue },
    { label: "Comenzi", get: (f) => f.orders, fmt: "count", missing: b.notes.revenue },
    { label: "Comanda medie", get: (f) => ratio(f.revenue, f.orders), fmt: "money" },
    { label: "Vizitatori", get: (f) => f.visitors, fmt: "count", missing: b.notes.visitors },
    ...(b.sources.visitors === "ga4" ? [{ label: "Vizite (sesiuni)", get: (f: Figures) => f.sessions, fmt: "count" as const }] : []),
    { label: "Cheltuit pe reclame", get: (f) => f.ads, fmt: "money", lowerIsBetter: true, missing: b.notes.ads },
    { label: "Cost reclame pe comandă", get: (f) => (f.ads ? ratio(f.ads, f.orders) : null), fmt: "money", lowerIsBetter: true },
    ...(b.w.d30.ai > 0 ? [{ label: "Costuri AI", get: (f: Figures) => f.ai, fmt: "money" as const, lowerIsBetter: true }] : []),
    { label: "Profit", get: (f) => f.profit, fmt: "money", missing: b.notes.revenue ? "fără încasări nu se poate calcula" : undefined },
  ];
  const show = (v: number | null, r: Row) => (v == null ? "—" : r.fmt === "money" ? money(v * b.rate, b.currency) : count(v));
  const noTrend = b.sources.revenue === "aplicatie";

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="font-semibold">Pe scurt</h2>
          <p className={`mt-1 text-sm font-medium ${b.status.tone === "bad" ? "text-bad" : b.status.tone === "warn" ? "text-warn" : "text-good"}`}>{b.status.text}</p>
          {b.status.action && <p className="text-xs text-text-2">{b.status.action}</p>}
          {b.issues.slice(1).map((i, n) => (
            <p key={n} className="mt-1 text-xs text-text-2">
              <span className={i.tone === "bad" ? "text-bad" : "text-warn"}>{i.text}.</span> {i.action}
            </p>
          ))}
        </div>
        <StatusChip tone={b.status.tone} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <thead className="bg-bg text-xs text-text-3">
            <tr>
              <th className="px-5 py-2 text-left font-normal"></th>
              <th className="px-3 py-2 text-right font-normal">Azi</th>
              <th className="px-3 py-2 text-right font-normal">7 zile</th>
              <th className="px-5 py-2 text-right font-normal">30 de zile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => {
              const all = [r.get(b.w.azi), r.get(b.w.d7), r.get(b.w.d30)];
              const none = all.every((v) => v == null);
              return (
                <tr key={r.label}>
                  <td className="px-5 py-2.5 text-text-2">
                    {r.label}
                    {none && r.missing && <span className="block text-[11px] text-text-3">{r.missing}</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular">{show(all[0], r)}</td>
                  {(["d7", "d30"] as const).map((k) => {
                    const v = r.get(b.w[k]);
                    const p = r.get(b.w[k === "d7" ? "p7" : "p30"]);
                    return (
                      <td key={k} className={`py-2.5 text-right tabular ${k === "d30" ? "px-5 font-semibold" : "px-3"}`}>
                        {show(v, r)}
                        {!noTrend && v != null && p != null && (
                          <span className="block">
                            <Trend cur={v} prev={p} lowerIsBetter={r.lowerIsBetter} />
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 px-5 py-3 text-xs text-text-3">
        <p>
          Profit = încasări − reclame − costuri AI.{" "}
          {b.sources.revenue === "aplicatie" ? "Încasările vin din aplicație (fără comparație cu perioada trecută)." : null}
          {b.sources.visitors === "ga4" ? " Vizitatorii vin din Google Analytics." : b.sources.visitors === "masurare" ? " Vizitatorii vin din codul nostru de măsurare." : null}
        </p>
        <TechDetails issues={b.issues} />
      </div>
    </section>
  );
}
