import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { formatMoneyFine } from "@/lib/metrics";
import { getMoney, parseMoneyView, type MoneyLine, type MoneyView } from "@/lib/money";
import { Badge, MoneyViewTabs } from "@/components/MoneySection";
import { Stat, Trend } from "@/components/Stat";

export const dynamic = "force-dynamic";

const SORTS = { vanzari: "Vânzări", costuri: "Costuri", profit: "Profit", nume: "Proiect" } as const;
type Sort = keyof typeof SORTS;

const lei = (v: number) => formatMoneyFine(v, "RON");

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

// Toate proiectele — bani: vanzari, costuri si profit pe proiect, in lei, sortabil
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
    { label: "Comision Stripe", v: t.stripeFees, pv: p.stripeFees, badge: t.feesEstimated ? "estimat" : null },
    { label: "AI", v: t.ai, pv: p.ai, badge: null },
    { label: "Reclame", v: t.ads, pv: p.ads, badge: null },
    { label: "Costuri fixe", v: t.fixed, pv: p.fixed, badge: rows.some((r) => r.fixedToVerify) ? "de verificat" : null },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Toate proiectele — bani</h1>
          <p className="text-sm text-text-2">
            {money.cur.label} față de {money.prev.label} · toate sumele în lei
            {money.ratesLive ? ` (curs BNR: 1 € = ${money.eur.toLocaleString("ro-RO", { maximumFractionDigits: 4 })} lei)` : " (curs aproximativ, BNR nu a răspuns)"}
          </p>
        </div>
        <MoneyViewTabs view={view} href={(v) => href(v)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Vânzări" value={lei(t.revenue)} cur={t.revenue} prev={p.revenue} sub={`${t.orders} plăți`} />
        <Stat label="Costuri" value={lei(t.costs)} cur={t.costs} prev={p.costs} lowerIsBetter sub={`înainte: ${lei(p.costs)}`} />
        <Stat label={t.profit >= 0 ? "Profit" : "Pierdere"} value={lei(t.profit)} tone={t.profit >= 0 ? "good" : "bad"} cur={t.profit} prev={p.profit} sub={`înainte: ${lei(p.profit)}`} />
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
              <div className="text-lg font-semibold tabular">{lei(c.v)}</div>
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
                <span className={`font-semibold tabular ${r.curRon.profit >= 0 ? "text-good" : "text-bad"}`}>{lei(r.curRon.profit)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-text-2 tabular">
                <span>vânzări {lei(r.curRon.revenue)}</span>
                <span>costuri {lei(r.curRon.costs)}</span>
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
                  <div>{lei(r.curRon.revenue)}</div>
                  <Trend cur={r.curRon.revenue} prev={r.prevRon.revenue} />
                </td>
                <td className="py-2.5 text-right">
                  <div>{lei(r.curRon.costs)}</div>
                  <Trend cur={r.curRon.costs} prev={r.prevRon.costs} lowerIsBetter />
                </td>
                <td className="py-2.5 text-right">
                  <div className={`font-semibold ${r.curRon.profit >= 0 ? "text-good" : "text-bad"}`}>{lei(r.curRon.profit)}</div>
                  <Trend cur={r.curRon.profit} prev={r.prevRon.profit} />
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2.5">Total</td>
              <td className="py-2.5 text-right">{lei(t.revenue)}</td>
              <td className="py-2.5 text-right">{lei(t.costs)}</td>
              <td className={`py-2.5 text-right ${t.profit >= 0 ? "text-good" : "text-bad"}`}>{lei(t.profit)}</td>
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
