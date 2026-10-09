import { Paperclip, Trash2 } from "lucide-react";
import { COST_CATEGORIES, type CostInvoiceRow } from "@/lib/cost-invoices";
import { deleteCostInvoice } from "@/app/dashboard/bani/cost-invoice-actions";

const money = (n: number, c: string) => new Intl.NumberFormat("ro-RO", { style: "currency", currency: c, maximumFractionDigits: 2 }).format(n);

// Facturile furnizorilor (servere, domenii, AI, reclame...) cu PDF-ul atasat: ale proiectului + cele comune.
export function CostInvoicesSection({ rows, projectId, canEdit, today }: { rows: CostInvoiceRow[] | null; projectId: string; canEdit: boolean; today: string }) {
  return (
    <div className="card p-4">
      <h2 className="mb-1 font-medium">Facturi furnizori</h2>
      <p className="mb-3 text-xs text-text-3">Documentele costurilor (cu PDF). Doar evidență: nu se adună peste costurile de mai sus. „comun” = împărțit între proiecte.</p>
      {rows === null ? (
        <p className="text-sm text-text-2">Tabelul facturilor nu e încă în bază (prisma/sql/2026-10-10_facturi_cost.sql).</p>
      ) : (
        <>
          <ul className="divide-y divide-border text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="w-24 tabular text-text-2">{r.issueDate}</span>
                <span className="min-w-0 flex-1 basis-40">
                  <span className="font-medium">{r.supplier}</span>
                  {r.number && <span className="text-text-3"> · {r.number}</span>}
                  <span className="text-xs text-text-3"> · {COST_CATEGORIES[r.category] || r.category}{r.shared ? " · comun" : ""}</span>
                  {r.note && <span className="block truncate text-xs text-text-3" title={r.note}>{r.note}</span>}
                </span>
                <span className="tabular font-medium">{money(r.total, r.currency)}</span>
                {r.fileName ? (
                  <a href={`/api/cost-invoices/${r.id}`} target="_blank" rel="noreferrer" title={r.fileName} className="rounded-md p-1.5 text-text-2 hover:text-accent" aria-label={`Deschide ${r.fileName}`}>
                    <Paperclip size={16} />
                  </a>
                ) : (
                  <span className="w-7" />
                )}
                {canEdit && (
                  <form action={deleteCostInvoice}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <button className="rounded-md p-1.5 text-text-3 hover:text-bad" aria-label={`Șterge factura ${r.supplier}`}>
                      <Trash2 size={15} />
                    </button>
                  </form>
                )}
              </li>
            ))}
            {!rows.length && <li className="py-3 text-text-3">Nicio factură încă.</li>}
          </ul>
          {canEdit && (
            <form action="/api/cost-invoices" method="post" encType="multipart/form-data" className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <input type="hidden" name="projectId" value={projectId} />
              <input name="supplier" placeholder="Furnizor (ex. Hetzner)" required className="input min-w-0 flex-1 basis-40" aria-label="Furnizor" />
              <input name="number" placeholder="Nr. factură" className="input w-32" aria-label="Număr factură" />
              <input name="issueDate" type="date" defaultValue={today} required className="input w-40" aria-label="Data facturii" />
              <input name="total" placeholder="total" required inputMode="decimal" className="input w-24 text-right" aria-label="Total" />
              <select name="currency" defaultValue="EUR" className="input w-20" aria-label="Monedă">
                <option>EUR</option>
                <option>RON</option>
                <option>USD</option>
              </select>
              <select name="category" defaultValue="server" className="input w-auto" aria-label="Categorie">
                {Object.entries(COST_CATEGORIES).map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </select>
              <select name="scope" defaultValue="project" className="input w-auto" aria-label="Pentru cine">
                <option value="project">doar acest proiect</option>
                <option value="shared">comun</option>
              </select>
              <label className="btn btn-ghost cursor-pointer text-sm">
                <Paperclip size={14} /> PDF
                <input type="file" name="file" accept=".pdf,.xml,.zip,.jpg,.jpeg,.png" className="sr-only" />
              </label>
              <button className="btn">Adaugă factura</button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
