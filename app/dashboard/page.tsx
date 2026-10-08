import Link from "next/link";
import { AlertTriangle, CircleAlert, Megaphone, PartyPopper, Plus, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { getOverview, totals, type Tone } from "@/lib/overview";
import { count, money } from "@/lib/format";
import { Trend } from "@/components/Stat";
import { BusinessCard } from "@/components/BusinessCard";

export const dynamic = "force-dynamic";

const ORDER: Record<Tone, number> = { bad: 0, warn: 1, good: 2 };

function Tile({
  icon: Icon,
  label,
  value,
  cur,
  prev,
  lowerIsBetter,
  tone,
  sub,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  cur: number;
  prev: number;
  lowerIsBetter?: boolean;
  tone?: "good" | "bad";
  sub?: string;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm text-text-2">
        <span className="grid size-7 place-items-center rounded-lg bg-bg text-text-2">
          <Icon size={15} aria-hidden />
        </span>
        {label}
      </div>
      <div className={`mt-3 truncate text-2xl font-semibold tabular sm:text-3xl ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-3">
        <Trend cur={cur} prev={prev} lowerIsBetter={lowerIsBetter} label="față de perioada dinainte" />
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

// Prima pagina: cum merge fiecare afacere, in cuvinte simple si cu cifre reale
export default async function Overview({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const userId = await requireUser();
  const { p } = await searchParams;
  const period: "7" | "30" = p === "7" ? "7" : "30";
  const projects = await projectsForUser(userId);

  if (projects.length === 0) {
    return (
      <div className="card mx-auto mt-12 max-w-lg space-y-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Nicio afacere adăugată încă</h1>
        <p className="text-sm text-text-2">Adaugă primul site, apoi leagă plățile (Stripe) și reclamele, ca să vezi aici cât vinzi și cât câștigi.</p>
        <Link href="/dashboard/projects/new" className="btn">
          <Plus size={16} /> Adaugă o afacere
        </Link>
      </div>
    );
  }

  const list = (await getOverview(projects)).sort(
    (a, b) => ORDER[a.status.tone] - ORDER[b.status.tone] || (b.w.d30.revenue ?? -1) - (a.w.d30.revenue ?? -1) || a.name.localeCompare(b.name),
  );
  const cur = totals(list, period === "7" ? "d7" : "d30");
  // sageata: doar afacerile care au si cifrele perioadei dinainte (cele citite din aplicatie n-au)
  const comparable = list.filter((b) => b.sources.revenue !== "aplicatie");
  const same = totals(comparable, period === "7" ? "d7" : "d30");
  const prev = totals(comparable, period === "7" ? "p7" : "p30");
  const today = totals(list, "azi");
  const attention = list.flatMap((b) => b.issues.filter((i) => i.tone !== "good").map((i) => ({ b, i })));
  const periodLabel = period === "7" ? "ultimele 7 zile" : "ultimele 30 de zile";

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm capitalize text-text-3">
            {new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Cum merg afacerile</h1>
          <p className="mt-1 text-sm text-text-2">
            Azi ai încasat <strong className="tabular text-text">{money(today.revenue)}</strong>
            {today.orders > 0 && <> din {today.orders === 1 ? "o comandă" : `${count(today.orders)} comenzi`}</>}.
          </p>
        </div>
        <nav className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm" aria-label="Perioada">
          {(["7", "30"] as const).map((v) => (
            <Link
              key={v}
              href={v === "30" ? "/dashboard" : "/dashboard?p=7"}
              className={`rounded-lg px-3 py-1.5 font-medium ${period === v ? "bg-accent text-white" : "text-text-2 hover:text-text"}`}
              aria-current={period === v ? "page" : undefined}
            >
              {v === "7" ? "7 zile" : "30 de zile"}
            </Link>
          ))}
        </nav>
      </header>

      <section aria-label="Toate afacerile împreună" className="space-y-3">
        <h2 className="text-sm font-medium text-text-3">Toate afacerile împreună · {periodLabel} · în lei</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile icon={Wallet} label="Încasări" value={money(cur.revenue)} cur={same.revenue} prev={prev.revenue} />
          <Tile icon={Megaphone} label="Cheltuit pe reclame" value={money(cur.ads)} cur={same.ads} prev={prev.ads} lowerIsBetter />
          <Tile
            icon={TrendingUp}
            label={cur.profit < 0 ? "Pierdere" : "Profit"}
            value={money(cur.profit)}
            cur={same.profit}
            prev={prev.profit}
            tone={cur.profit >= 0 ? "good" : "bad"}
            sub={cur.ai > 0 ? `după reclame și ${money(cur.ai)} AI` : "după reclame"}
          />
          <Tile icon={ShoppingBag} label="Comenzi" value={count(cur.orders)} cur={same.orders} prev={prev.orders} sub={cur.orders > 0 ? `în medie ${money(cur.revenue / cur.orders)}` : undefined} />
        </div>
      </section>

      <section aria-label="De văzut" className="space-y-3">
        {attention.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-good/30 bg-good-bg px-5 py-4 text-good">
            <PartyPopper size={20} className="shrink-0" aria-hidden />
            <span className="font-medium">Totul merge. Nicio problemă de rezolvat acum.</span>
          </div>
        ) : (
          <div className="card divide-y divide-border">
            <h2 className="px-5 py-3 text-sm font-semibold">
              {attention.length === 1 ? "Un lucru de văzut" : `${attention.length} lucruri de văzut`}
            </h2>
            {attention.slice(0, 6).map(({ b, i }, n) => (
              <Link key={`${b.id}-${n}`} href={`/dashboard/projects/${b.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-bg">
                {i.tone === "bad" ? (
                  <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                ) : (
                  <CircleAlert size={18} className="mt-0.5 shrink-0 text-warn" aria-hidden />
                )}
                <span className="min-w-0 text-sm">
                  <strong>{b.name}:</strong> {i.text}
                  {i.action && <span className="block text-xs text-text-2">{i.action}</span>}
                </span>
              </Link>
            ))}
            {attention.length > 6 && (
              <Link href="/dashboard/alerte" className="block px-5 py-3 text-sm text-accent hover:underline">
                Vezi toate în Alerte
              </Link>
            )}
          </div>
        )}
      </section>

      <section aria-label="Fiecare afacere" className="space-y-3">
        <h2 className="text-sm font-medium text-text-3">Fiecare afacere · comenzi, vizitatori, reclame și profit pe {periodLabel}</h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((b) => (
            <BusinessCard key={b.id} b={b} period={period} />
          ))}
        </div>
        <p className="text-xs leading-relaxed text-text-3">
          Profit = încasări − reclame − costuri AI. Comisioanele Stripe și costurile fixe (server, abonamente) sunt în pagina{" "}
          <Link href="/dashboard/bani" className="underline">
            Bani
          </Link>
          . Vizitatorii vin din Google Analytics unde e legat, altfel din codul nostru de măsurare. „—” înseamnă că nu avem cifra, nu că e zero.
        </p>
      </section>
    </div>
  );
}
