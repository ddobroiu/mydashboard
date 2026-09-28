import { formatMoney } from "@/lib/metrics";
import type { Traffic } from "@/lib/tracking/report";
import { nf } from "./Stat";

const pct = (a: number, b: number) =>
  b > 0 ? `${((a / b) * 100).toLocaleString("ro-RO", { maximumFractionDigits: a / b < 0.1 ? 1 : 0 })}%` : "–";

// „Cine îți aduce bani”: canalele simple, ordonate dupa bani (apoi dupa vizitatori), cu bare
export function SourcesMoney({ t, currency, periodLabel }: { t: Traffic; currency: string; periodLabel: string }) {
  const rows = t.simple;
  const byMoney = rows.some((r) => r.revenue > 0);
  const max = Math.max(1, ...rows.map((r) => (byMoney ? r.revenue : r.visitors)));

  return (
    <section className="card p-4">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Cine îți aduce bani</h2>
        <p className="text-xs text-text-3">
          De unde au venit vizitatorii și cumpărătorii · {periodLabel} · din tracking-ul propriu. O vânzare merge la ultima sursă prin care a venit omul în
          ultimele 30 de zile.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-text-3">Nicio vizită urmărită în perioada aceasta.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((r) => (
            <li key={r.channel}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                <span className="font-medium">{r.channel}</span>
                <span className="tabular">
                  {r.revenue > 0 ? <strong>{formatMoney(r.revenue, currency)}</strong> : <span className="text-text-3">fără vânzări</span>}
                </span>
              </div>
              <div className="mt-1 h-2 rounded-full bg-bg">
                <div
                  className={`h-2 rounded-full ${byMoney ? "bg-good" : "bg-accent"}`}
                  style={{ width: `${Math.max(1.5, ((byMoney ? r.revenue : r.visitors) / max) * 100)}%` }}
                />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-text-2 tabular">
                <span>{nf(r.visitors)} vizitatori</span>
                <span>{nf(r.orders)} {r.orders === 1 ? "vânzare" : "vânzări"}</span>
                {r.orders > 0 && <span>cumpără {pct(r.orders, r.visitors)} din vizitatori</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {t.unattributedOrders > 0 && (
        <p className="mt-3 text-xs text-text-3">
          Plus {nf(t.unattributedOrders)} {t.unattributedOrders === 1 ? "vânzare" : "vânzări"} ({formatMoney(t.unattributedRevenue, currency)}) fără sursă cunoscută
          (plată făcută fără vizită urmărită pe site).
        </p>
      )}
    </section>
  );
}
