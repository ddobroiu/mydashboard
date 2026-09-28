import Link from "next/link";
import { Lightbulb, Search, FileText, Sparkles } from "lucide-react";
import { opportunitySentence, roCount, type GoogleReport, type GscRow } from "@/lib/gsc-report";
import { ClicksChart } from "./ClicksChart";
import { Stat, Trend, nf } from "./Stat";

export const CHART_RANGES = [
  { days: 28, label: "28 zile" },
  { days: 90, label: "3 luni" },
  { days: 480, label: "16 luni" },
] as const;

// null = alegem singuri (28 de zile la site-urile noi in Google, altfel 3 luni)
export function parseChartDays(v: string | undefined): number | null {
  return CHART_RANGES.find((r) => String(r.days) === v)?.days ?? null;
}

const fmtDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "UTC" });

// "https://www.anexa1.ro/modele/contract?x=1" -> "/modele/contract"
function pagePath(url: string) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname) || "/";
  } catch {
    return url;
  }
}

function RankedList({ rows, label, empty, hasPrev }: { rows: GscRow[]; label: (r: GscRow) => React.ReactNode; empty: string; hasPrev: boolean }) {
  if (!rows.length) return <p className="text-sm text-text-3">{empty}</p>;
  // La site-urile noi, fara clicuri inca, barele arata afisarile
  const byClicks = rows.some((r) => r.clicks > 0);
  const val = (r: GscRow) => (byClicks ? r.clicks : r.impressions);
  const max = Math.max(1, ...rows.map(val));
  return (
    <ol className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 break-words">{label(r)}</span>
            <span className="shrink-0 text-right tabular">
              <strong>{nf(r.clicks)}</strong>
              <span className="ml-2 inline-block min-w-12 text-right">
                {hasPrev && (r.clicks > 0 || (r.prevClicks ?? 0) > 0) && <Trend cur={r.clicks} prev={r.prevClicks ?? 0} />}
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-bg">
            <div className={`h-1.5 rounded-full ${byClicks ? "bg-accent" : "bg-accent/40"}`} style={{ width: `${Math.max(2, (val(r) / max) * 100)}%` }} />
          </div>
          <div className="mt-0.5 text-xs text-text-3 tabular">
            {roCount(r.impressions, "afișare", "afișări")} · locul {Math.round(r.position)}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function GoogleSection({ g, basePath }: { g: GoogleReport; basePath: string }) {
  const chartDays = g.chartDays;
  if (!g.lastDate) {
    return (
      <section className="card p-6 text-center space-y-2">
        <h2 className="text-lg font-semibold">Google</h2>
        {g.lastError ? (
          <p className="text-sm text-bad max-w-xl mx-auto">Nu putem citi datele din Google: {g.lastError}</p>
        ) : (
          <p className="text-sm text-text-2 max-w-xl mx-auto">
            {g.siteUrl
              ? "Google nu are încă date pentru acest site (a apărut de curând în Search Console). Datele apar aici în câteva zile, singure."
              : "Datele din Google apar după prima sincronizare de noapte."}
          </p>
        )}
      </section>
    );
  }

  const t = g.totals;
  const p = g.prevTotals;
  const hasPrev = p.impressions > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Google</h2>
          <p className="text-xs text-text-3">
            Ultimele 28 de zile, până pe {fmtDate(g.lastDate)}, față de cele 28 de zile dinainte · din Google Search Console
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Clicuri din Google" value={nf(t.clicks)} cur={t.clicks} prev={hasPrev ? p.clicks : null} sub={hasPrev ? `înainte: ${nf(p.clicks)}` : "prima lună cu date"} />
        <Stat
          label="De câte ori ai apărut în Google"
          value={nf(t.impressions)}
          cur={t.impressions}
          prev={hasPrev ? p.impressions : null}
          sub={hasPrev ? `înainte: ${nf(p.impressions)}` : undefined}
        />
        <Stat
          label="Locul mediu în Google"
          value={t.position === null ? "–" : `locul ${t.position.toLocaleString("ro-RO", { maximumFractionDigits: 0 })}`}
          cur={t.position ?? 0}
          prev={hasPrev && p.position !== null && t.position !== null ? p.position : null}
          lowerIsBetter
          sub={hasPrev && p.position !== null ? `înainte: locul ${Math.round(p.position)} · 1 = primul rezultat` : "1 = primul rezultat"}
        />
      </div>

      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Clicuri din Google, pe zi</h3>
          <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
            {CHART_RANGES.map((r) => (
              <Link
                key={r.days}
                href={`${basePath}?tab=google&g=${r.days}`}
                scroll={false}
                className={`px-3 py-1 rounded-md ${r.days === chartDays ? "bg-accent text-white" : "text-text-2 hover:text-text"}`}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
        <ClicksChart data={g.daily} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-1 flex items-center gap-2 font-medium">
            <Search size={16} className="text-text-3" /> Ce caută oamenii
          </h3>
          <p className="mb-3 text-xs text-text-3">Ce au scris în Google cei care au dat de site · cifra = clicuri în 28 de zile</p>
          <RankedList hasPrev={g.hasPrevTop} rows={g.queries.slice(0, 10)} label={(r) => r.key} empty="Google nu a arătat încă site-ul la nicio căutare." />
        </div>
        <div className="card p-4">
          <h3 className="mb-1 flex items-center gap-2 font-medium">
            <FileText size={16} className="text-text-3" /> Paginile care aduc vizite
          </h3>
          <p className="mb-3 text-xs text-text-3">Paginile pe care intră oamenii din Google · cifra = clicuri în 28 de zile</p>
          <RankedList hasPrev={g.hasPrevTop} rows={g.pages.slice(0, 10)} label={(r) => <span className="text-text-2">{pagePath(r.key)}</span>} empty="Încă nicio pagină cu clicuri." />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <h3 className="mb-1 flex items-center gap-2 font-medium">
            <Lightbulb size={16} className="text-warn" /> Oportunități
          </h3>
          <p className="mb-3 text-xs text-text-3">
            Căutări la care ești aproape de primele locuri: dacă îmbunătățești pagina, vin mai mulți oameni.
          </p>
          {g.opportunities.length ? (
            <ul className="space-y-2 text-sm">
              {g.opportunities.map((q) => (
                <li key={q.key} className="rounded-lg bg-warn-bg/60 px-3 py-2">
                  {opportunitySentence(q)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-3">Nicio căutare între locurile 5 și 20 cu destule afișări, deocamdată.</p>
          )}
        </div>
        <div className="card p-4">
          <h3 className="mb-1 flex items-center gap-2 font-medium">
            <Sparkles size={16} className="text-good" /> Căutări noi și în creștere
          </h3>
          <p className="mb-3 text-xs text-text-3">Față de cele 28 de zile dinainte</p>
          {g.rising.length === 0 && g.newQueries.length === 0 ? (
            <p className="text-sm text-text-3">
              {hasPrev ? "Nimic nou care să iasă în evidență." : "Apare după ce Google are două luni de date pentru site."}
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {g.rising.map((q) => (
                <li key={`r-${q.key}`} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">{q.key}</span>
                  <span className="shrink-0 tabular text-good">
                    {nf(q.prevClicks ?? 0)} → {nf(q.clicks)}
                  </span>
                </li>
              ))}
              {g.newQueries.map((q) => (
                <li key={`n-${q.key}`} className="flex justify-between gap-3">
                  <span className="min-w-0 break-words">
                    {q.key} <span className="ml-1 rounded bg-good-bg px-1.5 py-0.5 text-xs text-good">nou</span>
                  </span>
                  <span className="shrink-0 tabular text-text-2">{q.clicks > 0 ? roCount(q.clicks, "clic", "clicuri") : roCount(q.impressions, "afișare", "afișări")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {g.lastError && <p className="text-xs text-bad">Ultima sincronizare a eșuat: {g.lastError}</p>}
    </section>
  );
}
