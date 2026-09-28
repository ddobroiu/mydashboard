import Link from "next/link";
import { Trash2 } from "lucide-react";
import { formatMoneyFine } from "@/lib/metrics";
import type { MoneyView, Period, ProjectMoney } from "@/lib/money";
import { addFixedCost, deleteFixedCost, updateFixedCost } from "@/app/dashboard/bani/actions";
import { Stat, Trend } from "./Stat";

export const MONEY_VIEWS: { key: MoneyView; label: string }[] = [
  { key: "luna", label: "Luna asta" },
  { key: "luna-trecuta", label: "Luna trecută" },
];

export function MoneyViewTabs({ href, view }: { href: (v: MoneyView) => string; view: MoneyView }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
      {MONEY_VIEWS.map((v) => (
        <Link key={v.key} href={href(v.key)} className={`px-3 py-1 rounded-md ${v.key === view ? "bg-accent text-white" : "text-text-2 hover:text-text"}`}>
          {v.label}
        </Link>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "muted" }) {
  return (
    <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone === "warn" ? "bg-warn-bg text-warn" : "bg-bg text-text-3"}`}>{children}</span>
  );
}

// Vanzari, costuri si profit pentru un proiect, cu fiecare cost explicat
export function MoneySection({
  m,
  cur,
  prev,
  view,
  basePath,
  organizationId,
  canEdit,
  sharedWith,
  hasAi,
}: {
  m: ProjectMoney;
  cur: Period;
  prev: Period;
  view: MoneyView;
  basePath: string;
  organizationId: string;
  canEdit: boolean;
  sharedWith: number;
  hasAi: boolean;
}) {
  const money = (v: number) => formatMoneyFine(v, m.currency);
  const c = m.cur;
  const p = m.prev;
  const costRows = [
    {
      label: "Comision Stripe",
      cur: c.stripeFees,
      prev: p.stripeFees,
      source: "Stripe",
      badge: c.feesEstimated ? "estimat" : null,
      note: c.feesEstimated ? "1,5% + 0,25 € pe plată, unde Stripe nu ne-a dat comisionul exact" : null,
    },
    {
      label: "AI",
      cur: c.ai,
      prev: p.ai,
      source: hasAi ? "Replicate (calculat din timpul de rulare)" : "neurmărit",
      badge: null,
      note: hasAi ? "Anthropic și alte AI nu sunt încă incluse" : "Nu e legat niciun cont de AI (Anthropic nu e încă urmărit)",
    },
    { label: "Reclame", cur: c.ads, prev: p.ads, source: "Meta Ads, Google Ads și cheltuieli introduse de mână", badge: null, note: null },
    {
      label: "Costuri fixe",
      cur: c.fixed,
      prev: p.fixed,
      source: "introduse de tine, mai jos",
      badge: m.fixedToVerify ? "de verificat" : null,
      note: view === "luna" ? "socotite doar pentru zilele trecute din lună" : null,
    },
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Bani</h2>
          <p className="text-xs text-text-3">
            {cur.label} față de {prev.label} · sume în {m.currency}
          </p>
        </div>
        <MoneyViewTabs view={view} href={(v) => `${basePath}?tab=bani&m=${v}`} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Vânzări" value={money(c.revenue)} cur={c.revenue} prev={p.revenue} sub={`${c.orders} ${c.orders === 1 ? "plată" : "plăți"} · minus rambursări`} />
        <Stat label="Costuri" value={money(c.costs)} cur={c.costs} prev={p.costs} lowerIsBetter sub={`înainte: ${money(p.costs)}`} />
        <Stat
          label={c.profit >= 0 ? "Profit" : "Pierdere"}
          value={money(c.profit)}
          tone={c.profit >= 0 ? "good" : "bad"}
          cur={c.profit}
          prev={p.profit}
          sub={`înainte: ${money(p.profit)}`}
        />
      </div>

      <div className="card p-4">
        <h3 className="mb-3 font-medium">Pe ce se duc banii</h3>
        <ul className="divide-y divide-border">
          {costRows.map((r) => (
            <li key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {r.label}
                  {r.badge && <Badge>{r.badge}</Badge>}
                </div>
                <div className="text-xs text-text-3">
                  sursa: {r.source}
                  {r.note && ` · ${r.note}`}
                </div>
              </div>
              <div className="text-right tabular">
                <div className="text-sm font-semibold">{money(r.cur)}</div>
                <div className="text-xs">
                  <Trend cur={r.cur} prev={r.prev} lowerIsBetter />
                </div>
              </div>
            </li>
          ))}
          <li className="flex items-baseline justify-between py-2.5 text-sm font-semibold">
            <span>Total costuri</span>
            <span className="tabular">{money(c.costs)}</span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-text-3">Fără TVA și fără impozite. Sumele în alte monede sunt schimbate la cursul BNR.</p>
      </div>

      <FixedCosts m={m} basePath={basePath} organizationId={organizationId} canEdit={canEdit} sharedWith={sharedWith} />
    </section>
  );
}

function FixedCosts({
  m,
  organizationId,
  canEdit,
  sharedWith,
}: {
  m: ProjectMoney;
  basePath: string;
  organizationId: string;
  canEdit: boolean;
  sharedWith: number;
}) {
  const own = m.fixedItems.filter((f) => !f.shared);
  const shared = m.fixedItems.filter((f) => f.shared);
  const fmt = (v: number, cur: string) =>
    new Intl.NumberFormat("ro-RO", { style: "currency", currency: cur, minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(v);

  const Row = ({ f }: { f: (typeof m.fixedItems)[number] }) =>
    canEdit ? (
      <li className="py-2">
        <form action={updateFixedCost} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={f.id} />
          <input type="hidden" name="projectId" value={m.id} />
          <input name="name" defaultValue={f.name} className="input min-w-0 flex-1 basis-40" aria-label="Nume cost" />
          <input name="monthly" defaultValue={String(f.monthly)} inputMode="decimal" className="input w-24 text-right tabular" aria-label="Sumă pe lună" />
          <select name="currency" defaultValue={f.currency} className="input w-20" aria-label="Monedă">
            <option>EUR</option>
            <option>RON</option>
            <option>USD</option>
          </select>
          <button className="btn btn-ghost text-sm">Salvează</button>
          <button formAction={deleteFixedCost} className="rounded-md p-2 text-text-3 hover:text-bad" aria-label={`Șterge ${f.name}`}>
            <Trash2 size={16} />
          </button>
        </form>
        <div className="mt-1 text-xs text-text-3">
          {f.shared ? `pe lună, împărțit la ${sharedWith} proiecte: ${fmt(f.share, f.currency)} pentru acest proiect` : "pe lună, doar acest proiect"}
          {f.toVerify && <Badge>de verificat</Badge>}
        </div>
      </li>
    ) : (
      <li className="flex justify-between py-2 text-sm">
        <span>
          {f.name}
          {f.toVerify && <Badge>de verificat</Badge>}
        </span>
        <span className="tabular">{fmt(f.share, f.currency)}/lună</span>
      </li>
    );

  return (
    <div className="card p-4">
      <h3 className="font-medium">Costuri fixe lunare</h3>
      <p className="mb-2 text-xs text-text-3">
        Servere, domenii, unelte de e-mail, SerpAPI… Cele comune se împart în mod egal la toate cele {sharedWith} proiecte. Valorile marcate „de verificat” sunt
        puse de noi: corectează-le și apasă Salvează.
      </p>
      <div className="space-y-4">
        <div>
          <h4 className="text-sm text-text-2">Doar pentru acest proiect</h4>
          <ul className="divide-y divide-border">{own.length ? own.map((f) => <Row key={f.id} f={f} />) : <li className="py-2 text-sm text-text-3">Niciunul.</li>}</ul>
        </div>
        <div>
          <h4 className="text-sm text-text-2">Comune (toate proiectele)</h4>
          <ul className="divide-y divide-border">{shared.length ? shared.map((f) => <Row key={f.id} f={f} />) : <li className="py-2 text-sm text-text-3">Niciunul.</li>}</ul>
        </div>
      </div>
      {canEdit && (
        <form action={addFixedCost} className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="projectId" value={m.id} />
          <input name="name" placeholder="ex. Domeniu, SerpAPI, Resend" required className="input min-w-0 flex-1 basis-48" aria-label="Nume cost nou" />
          <input name="monthly" placeholder="sumă/lună" required inputMode="decimal" className="input w-28 text-right" aria-label="Sumă pe lună" />
          <select name="currency" defaultValue="EUR" className="input w-20" aria-label="Monedă">
            <option>EUR</option>
            <option>RON</option>
            <option>USD</option>
          </select>
          <select name="scope" defaultValue="project" className="input w-auto" aria-label="Pentru cine">
            <option value="project">doar acest proiect</option>
            <option value="shared">comun, împărțit la toate</option>
          </select>
          <button className="btn">Adaugă</button>
        </form>
      )}
    </div>
  );
}
