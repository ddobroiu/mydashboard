import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { approxRon, formatAmounts } from "@/lib/metrics";
import { getMoney, parseMoneyView, type MoneyLine, type MoneyView } from "@/lib/money";
import { Badge, MoneyViewTabs } from "@/components/MoneySection";
import { Stat, Trend } from "@/components/Stat";

export const dynamic = "force-dynamic";

const SORTS = { vanzari: "Vânzări", costuri: "Costuri", profit: "Profit", nume: "Proiect" } as const;
type Sort = keyof typeof SORTS;


const pageHref = (v: MoneyView, s: Sort, d: string) => `/dashboard/bani?m=${v}&sort=${s}&dir=${d}`;

// Capul de coloana care sorteaza (al doilea click inverseaza ordinea)
function SortHead({ k, sort, asc, view, className = "" }: { k: Sort; sort: Sort; asc: boolean; view: MoneyView; className?: string }) {
  const active = sort === k;
  return (
    <th className={`py-2 font-normal ${className}`}>
      <Link href={pageHref(view, k, active && !asc ? "asc" : "desc")} className={`inline-flex items-center gap-1 ${active ? "text-text font-medium" : "hover:text-text"}`}>
        {SORTS[k]}
        {active && (asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </Link>
    </th>
  );
}

// Toate proiectele — bani: vanzari, costuri si profit pe proiect, fiecare suma in moneda ei, sortabil (dupa echivalentul in lei)
export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ m?: string; sort?: string; dir?: string }> }) {
  const userId = await requireUser();
  const sp = await searchParams;
  const view = parseMoneyView(sp.m);
  const sort: Sort = sp.sort && sp.sort in SORTS ? (sp.sort as Sort) : "profit";
  const asc = sp.dir === "asc";
  const projects = await projectsForUser(userId);
  const money = await getMoney(projects, view);

  const value = (l: MoneyLine) => (sort === "vanzari" ? l.revenue : sort === "costuri" ? l.costs : l.profit);
  const rows = [...money.rows].sort((a, b) =>
    sort === "nume" ? a.name.localeCompare(b.name) * (asc ? 1 : -1) : (value(a.curRon) - value(b.curRon)) * (asc ? 1 : -1),
  );
  const t = money.total;
  const p = money.prevTotal;
  const href = (v: MoneyView, s: Sort = sort, d = asc ? "asc" : "desc") => pageHref(v, s, d);
  const head = { sort, asc, view };

  const costTypes = [
    { label: "Comision Stripe", v: t.stripeFees, pv: p.stripeFees, by: t.by.stripeFees, badge: t.feesEstimated ? "estimat" : null },
    { label: "AI", v: t.ai, pv: p.ai, by: t.by.ai, badge: null },
    { label: "Reclame", v: t.ads, pv: p.ads, by: t.by.ads, badge: null },
    { label: "Costuri fixe", v: t.fixed, pv: p.fixed, by: t.by.fixed, badge: rows.some((r) => r.fixedToVerify) ? "de verificat" : null },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Toate proiectele — bani</h1>
          <p className="text-sm text-text-2">
            {money.cur.label} față de {money.prev.label} · fiecare sumă în moneda ei; procentele și ordinea, după echivalentul în lei
            {money.ratesLive ? ` (curs BNR: 1 € = ${money.eur.toLocaleString("ro-RO", { maximumFractionDigits: 4 })} lei)` : " (curs aproximativ, BNR nu a răspuns)"}
          </p>
        </div>
        <MoneyViewTabs view={view} href={(v) => href(v)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Vânzări" value={formatAmounts(t.by.revenue)} cur={t.revenue} prev={p.revenue} sub={[`${t.orders} plăți`, approxRon(t.by.revenue, t.revenue)].filter(Boolean).join(" · ")} />
        <Stat label="Costuri" value={formatAmounts(t.by.costs)} cur={t.costs} prev={p.costs} lowerIsBetter sub={`înainte: ${formatAmounts(p.by.costs)}`} />
        <Stat
          label={t.profit >= 0 ? "Profit" : "Pierdere"}
          value={formatAmounts(t.by.profit)}
          tone={t.profit >= 0 ? "good" : "bad"}
          cur={t.profit}
          prev={p.profit}
          sub={[approxRon(t.by.profit, t.profit), `înainte: ${formatAmounts(p.by.profit)}`].filter(Boolean).join(" · ")}
        />
      </div>

      <div className="card p-4">
        <h2 className="mb-2 font-medium">Pe ce se duc banii</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {costTypes.map((c) => (
            <div key={c.label}>
              <div className="text-sm text-text-2">
                {c.label}
                {c.badge && <Badge>{c.badge}</Badge>}
              </div>
              <div className="text-lg font-semibold tabular">{formatAmounts(c.by)}</div>
              <Trend cur={c.v} prev={c.pv} lowerIsBetter />
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h2 className="mb-2 font-medium">Pe proiect</h2>
        {/* telefon: carduri */}
        <ul className="divide-y divide-border md:hidden">
          <li className="flex gap-2 pb-2 text-xs text-text-3">
            Ordonează:
            {(Object.keys(SORTS) as Sort[]).map((k) => (
              <Link key={k} href={href(view, k, "desc")} className={sort === k ? "font-medium text-accent" : ""}>
                {SORTS[k]}
              </Link>
            ))}
          </li>
          {rows.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-baseline justify-between">
                <Link href={`/dashboard/projects/${r.id}?tab=bani&m=${view}`} className="font-medium hover:text-accent">
                  {r.name}
                </Link>
                <span className={`font-semibold tabular ${r.curRon.profit >= 0 ? "text-good" : "text-bad"}`}>{formatAmounts(r.curRon.by.profit)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-text-2 tabular">
                <span>vânzări {formatAmounts(r.curRon.by.revenue)}</span>
                <span>costuri {formatAmounts(r.curRon.by.costs)}</span>
                <Trend cur={r.curRon.profit} prev={r.prevRon.profit} label="profit" />
              </div>
            </li>
          ))}
        </ul>
        {/* ecran mare: tabel sortabil */}
        <table className="hidden w-full text-sm tabular md:table">
          <thead className="text-left text-text-3">
            <tr>
              <SortHead k="nume" {...head} />
              <SortHead k="vanzari" className="text-right" {...head} />
              <SortHead k="costuri" className="text-right" {...head} />
              <SortHead k="profit" className="text-right" {...head} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="py-2.5">
                  <Link href={`/dashboard/projects/${r.id}?tab=bani&m=${view}`} className="font-medium hover:text-accent">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2.5 text-right">
                  <div>{formatAmounts(r.curRon.by.revenue)}</div>
                  <Trend cur={r.curRon.revenue} prev={r.prevRon.revenue} />
                </td>
                <td className="py-2.5 text-right">
                  <div>{formatAmounts(r.curRon.by.costs)}</div>
                  <Trend cur={r.curRon.costs} prev={r.prevRon.costs} lowerIsBetter />
                </td>
                <td className="py-2.5 text-right">
                  <div className={`font-semibold ${r.curRon.profit >= 0 ? "text-good" : "text-bad"}`}>{formatAmounts(r.curRon.by.profit)}</div>
                  <Trend cur={r.curRon.profit} prev={r.prevRon.profit} />
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2.5">Total</td>
              <td className="py-2.5 text-right">{formatAmounts(t.by.revenue)}</td>
              <td className="py-2.5 text-right">{formatAmounts(t.by.costs)}</td>
              <td className={`py-2.5 text-right ${t.profit >= 0 ? "text-good" : "text-bad"}`}>{formatAmounts(t.by.profit)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-xs text-text-3">
          Vânzări = plățile încasate minus rambursări. Costuri = comision Stripe + AI + reclame + costuri fixe (cele comune împărțite egal). Fără TVA și impozite.
          {view === "luna" && " Luna asta e comparată cu aceleași zile din luna trecută."}
        </p>
      </div>
    </div>
  );
}
