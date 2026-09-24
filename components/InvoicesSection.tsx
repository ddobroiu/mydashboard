import { ExternalLink } from "lucide-react";
import { formatMoney } from "@/lib/metrics";
import type { Invoices } from "@/lib/invoices";
import { Tile } from "./KpiTiles";

const fmtDay = (d: Date) => d.toISOString().slice(0, 10).split("-").reverse().join(".");

export function InvoicesSection({ inv }: { inv: Invoices }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Facturi</h2>
        <p className="text-xs text-text-3">Din Oblio, doar seria acestui proiect.</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Facturi emise" value={inv.count.toLocaleString("ro-RO")} sub={inv.canceled ? `${inv.canceled} anulate` : "niciuna anulată"} />
        {inv.totals.length === 0 ? (
          <Tile label="Total facturat" value="–" />
        ) : (
          inv.totals.map((t) => <Tile key={t.currency} label={`Total facturat (${t.currency})`} value={formatMoney(t.total, t.currency)} />)
        )}
      </div>
      <div className="card p-4">
        {inv.rows.length === 0 ? (
          <p className="text-sm text-text-2">Nicio factură în perioada aleasă.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm tabular">
              <thead className="text-text-3 text-left">
                <tr>
                  <th className="py-2 font-normal">Factură</th>
                  <th className="py-2 pl-4 font-normal">Data</th>
                  <th className="py-2 pl-4 font-normal">Client</th>
                  <th className="py-2 pl-4 font-normal text-right">Total</th>
                  <th className="py-2 pl-4 font-normal">e-Factura</th>
                </tr>
              </thead>
              <tbody>
                {inv.rows.map((r) => (
                  <tr key={r.id} className={`border-t border-border ${r.canceled ? "text-text-3 line-through" : ""}`}>
                    <td className="py-2 whitespace-nowrap">
                      {r.link ? (
                        <a href={r.link} target="_blank" rel="noreferrer" className="text-accent inline-flex items-center gap-1">
                          {r.series} {r.number} <ExternalLink size={11} />
                        </a>
                      ) : (
                        `${r.series} ${r.number}`
                      )}
                    </td>
                    <td className="py-2 pl-4 whitespace-nowrap">{fmtDay(r.issueDate)}</td>
                    <td className="py-2 pl-4">
                      {r.clientName ?? "–"}
                      {r.clientCif && <span className="text-xs text-text-3"> · {r.clientCif}</span>}
                    </td>
                    <td className="py-2 pl-4 text-right whitespace-nowrap">{formatMoney(r.total, r.currency)}</td>
                    <td className="py-2 pl-4 text-xs text-text-2">{r.canceled ? "anulată" : (r.einvoiceStatus ?? "–")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
