import { formatMoney } from "@/lib/metrics";
import type { SiteRow } from "@/lib/sites";

export function SitesSection({ rows, currency }: { rows: SiteRow[]; currency: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Pe site</h2>
        <p className="text-xs text-text-3">Încasările după eticheta pusă de fiecare site pe plăți; vizitele după domeniul vizitat.</p>
      </div>
      <div className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Site</th>
                <th className="py-2 pl-4 font-normal text-right">Încasări</th>
                <th className="py-2 pl-4 font-normal text-right">Comenzi</th>
                <th className="py-2 pl-4 font-normal text-right">Vizite</th>
                <th className="py-2 pl-4 font-normal text-right">Conversie</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.site ?? "-"} className="border-t border-border">
                  <td className="py-2">{r.site ?? <span className="text-text-3">fără etichetă</span>}</td>
                  <td className="py-2 pl-4 text-right whitespace-nowrap">{formatMoney(r.revenue, currency)}</td>
                  <td className="py-2 pl-4 text-right">{r.orders.toLocaleString("ro-RO")}</td>
                  <td className="py-2 pl-4 text-right">{r.visits ? r.visits.toLocaleString("ro-RO") : "–"}</td>
                  <td className="py-2 pl-4 text-right">
                    {r.visits ? `${((r.orders / r.visits) * 100).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}%` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
