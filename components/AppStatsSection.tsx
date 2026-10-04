import { getAppStats, type AppStats } from "@/lib/app-stats";
import { formatMoney } from "@/lib/metrics";

// Cifrele din aplicatie (conturi, comenzi, ce s-a vandut), citite din /api/mydashboard/stats al aplicatiei.
// Incasarile reale raman cele din Stripe (mai sus); aici e ce vede aplicatia.
// Coloana „24 h” apare doar daca aplicatia trimite h24 (ultimele 24 de ore, fereastra mobila).
type Kpi = AppStats["kpi"][number];
const COLS = [
  { key: "h24", label: "24 h" },
  { key: "today", label: "Azi" },
  { key: "d7", label: "7 zile" },
  { key: "d30", label: "30 zile" },
  { key: "total", label: "Total" },
] as const;

function fmt(v: number | null | undefined, unit: Kpi["unit"], currency: string) {
  if (v === null || v === undefined) return "–";
  if (unit === "money") return formatMoney(v, currency);
  if (unit === "percent") return `${v.toLocaleString("ro-RO", { maximumFractionDigits: 1 })}%`;
  return v.toLocaleString("ro-RO");
}

const STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: "plătită", cls: "bg-good-bg text-good" },
  pending: { label: "în așteptare", cls: "bg-warn-bg text-warn" },
  abandoned: { label: "abandonată", cls: "bg-surface text-text-3 border border-border" },
  failed: { label: "eșuată", cls: "bg-bad-bg text-bad" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" });

export async function AppStatsSection({ projectName, domain, currency }: { projectName: string; domain: string | null; currency: string }) {
  const r = await getAppStats(projectName, domain);
  if (!r.ok) {
    if (r.reason === "none") return null;
    return <p className="text-xs text-text-3">Statisticile din aplicație nu s-au putut citi: {r.error}.</p>;
  }
  const s = r.stats;
  const cur = s.currency || currency;
  const cols = s.kpi.some((k) => k.h24 !== undefined && k.h24 !== null) ? COLS : COLS.filter((c) => c.key !== "h24");
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Din aplicație</h2>
        <p className="text-xs text-text-3">
          Conturi, comenzi și ce s-a vândut, raportate de aplicație · actualizat {when(s.generatedAt)}. Încasările de mai sus vin din
          Stripe.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-5">
        <div className="card p-4 lg:col-span-3">
          <div className="overflow-x-auto">
            <table className={`w-full text-sm tabular ${cols.length > 4 ? "min-w-[560px]" : "min-w-[480px]"}`}>
              <thead className="text-left text-text-3">
                <tr>
                  <th className="py-2 font-normal" />
                  {cols.map((c) => (
                    <th key={c.key} className="py-2 pl-4 text-right font-normal">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.kpi.map((k) => (
                  <tr key={k.key} className="border-t border-border">
                    <td className="py-2">
                      {k.label}
                      {k.hint && <div className="text-xs text-text-3">{k.hint}</div>}
                    </td>
                    {cols.map((c) => (
                      <td key={c.key} className={`py-2 pl-4 text-right whitespace-nowrap ${c.key === "d30" || c.key === "h24" ? "font-medium" : ""}`}>
                        {fmt(k[c.key], k.unit, cur)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card p-4 lg:col-span-2">
          <h3 className="text-sm text-text-2">Ultimele comenzi</h3>
          {!s.recent?.length ? (
            <p className="mt-2 text-sm text-text-3">Nicio comandă.</p>
          ) : (
            <ul className="mt-2 divide-y divide-border text-sm">
              {s.recent.slice(0, 10).map((o, i) => {
                const st = o.status ? STATUS[o.status] : undefined;
                // detaliul poate avea clientul si starea facturii („Nume · email · factura CDV 12” sau „FĂRĂ FACTURĂ: motiv”, mereu la final)
                const parts = (o.detail || "").split(" · ").filter(Boolean);
                const cut = parts.findIndex((p) => /^FĂRĂ FACTURĂ/i.test(p.trim()));
                const info = (cut < 0 ? parts : parts.slice(0, cut)).join(" · ");
                const noInvoice = cut < 0 ? null : parts.slice(cut).join(" · ");
                return (
                  <li key={i} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate">{o.title}</div>
                      <div className="text-xs text-text-3">{when(o.at)}</div>
                      {info && <div className="text-xs break-words text-text-2">{info}</div>}
                      {noInvoice && (
                        <span className="mt-0.5 inline-block rounded bg-bad-bg px-1.5 py-0.5 text-[11px] font-medium break-words text-bad">
                          {noInvoice}
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular">{o.amount == null ? "–" : formatMoney(o.amount, cur)}</div>
                      {st ? (
                        <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] ${st.cls}`}>{st.label}</span>
                      ) : o.status ? (
                        <span className="text-[11px] text-text-3">{o.status}</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
