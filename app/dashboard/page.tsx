import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Mail, Wallet } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NOT_LOCAL_ALERT } from "@/lib/alert-explain";
import { addAmount, approxRon, formatAmounts, formatMoneyFine, type Amounts } from "@/lib/metrics";
import { addDays, dayDate, dayKey } from "@/lib/dates";
import { getMoney } from "@/lib/money";
import { gscClicksByProject } from "@/lib/gsc-report";
import { Stat, Trend, nf } from "@/components/Stat";
import InboxTodo from "@/components/InboxTodo";

export const dynamic = "force-dynamic";

// Vizitatori distincti pe proiect intr-un interval
async function visitorsByProject(ids: string[], since: string, until: string) {
  const rows = await prisma.trackSession.groupBy({
    by: ["projectId", "visitorId"],
    where: { projectId: { in: ids }, date: { gte: dayDate(since), lte: dayDate(until) } },
  });
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.projectId, (m.get(r.projectId) ?? 0) + 1);
  return m;
}

// Pagina principala: cum stai azi si luna asta, cu un card pe proiect
export default async function Overview() {
  const userId = await requireUser();
  const projects = await projectsForUser(userId);

  if (projects.length === 0) {
    return (
      <div className="card p-8 text-center space-y-3 max-w-lg mx-auto mt-12">
        <h1 className="text-xl font-semibold">Niciun proiect încă</h1>
        <p className="text-text-2 text-sm">Creează primul proiect (ex. tablou.net), apoi conectează Stripe și Meta Ads.</p>
        <Link href="/dashboard/projects/new" className="btn">
          Proiect nou
        </Link>
      </div>
    );
  }

  const ids = projects.map((p) => p.id);
  const today = dayKey(new Date());
  const yesterday = addDays(today, -1);
  const money = await getMoney(projects, "luna");
  const { cur, prev } = money;
  const gscEnd = addDays(today, -1);

  const [todayTx, yTx, visToday, visYesterday, visMonth, visPrevMonth, gsc, gscPrev, alerts] = await Promise.all([
    prisma.transaction.groupBy({ by: ["currency"], where: { projectId: { in: ids }, date: dayDate(today) }, _sum: { amount: true } }),
    prisma.transaction.groupBy({ by: ["currency"], where: { projectId: { in: ids }, date: dayDate(yesterday) }, _sum: { amount: true } }),
    visitorsByProject(ids, today, today),
    visitorsByProject(ids, yesterday, yesterday),
    visitorsByProject(ids, cur.since, cur.until),
    visitorsByProject(ids, prev.since, prev.until),
    gscClicksByProject(ids, addDays(gscEnd, -27), gscEnd),
    gscClicksByProject(ids, addDays(gscEnd, -55), addDays(gscEnd, -28)),
    prisma.alertState.findMany({ where: { active: true, ...NOT_LOCAL_ALERT }, select: { project: true } }),
  ]);
  // pe moneda: vanzarile in euro raman in euro, cele in lei in lei
  const byCur = (rows: { currency: string; _sum: { amount: unknown } }[]) =>
    rows.reduce((a, r) => addAmount(a, r.currency, Number(r._sum.amount ?? 0)), {} as Amounts);
  const salesToday = byCur(todayTx);
  const salesYesterday = byCur(yTx);
  const sumMap = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

  const alertsBy = new Map<string, number>();
  for (const a of alerts) {
    const k = (a.project ?? "").toLowerCase();
    alertsBy.set(k, (alertsBy.get(k) ?? 0) + 1);
  }
  const alertsOf = (name: string, domain: string | null) =>
    (alertsBy.get(name.toLowerCase()) ?? 0) + (domain ? alertsBy.get(domain.toLowerCase().replace(/^www\./, "")) ?? 0 : 0);

  const t = money.total;
  const pt = money.prevTotal;
  const cards = money.rows
    .map((r) => {
      const p = projects.find((x) => x.id === r.id)!;
      return { r, p, alerts: alertsOf(p.name, p.domain) };
    })
    .sort((a, b) => b.alerts - a.alerts || b.r.curRon.revenue - a.r.curRon.revenue || (visMonth.get(b.p.id) ?? 0) - (visMonth.get(a.p.id) ?? 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cum stai</h1>
        <p className="text-sm text-text-2">
          {new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" })} · toate proiectele, fiecare sumă în moneda ei
        </p>
      </div>

      {alerts.length > 0 ? (
        <Link href="/dashboard/alerte" className="flex items-center gap-3 rounded-xl border border-bad/30 bg-bad-bg px-4 py-3 text-bad hover:opacity-90">
          <AlertTriangle size={20} className="shrink-0" />
          <span className="font-medium">
            {alerts.length === 1 ? "O problemă activă" : `${alerts.length} probleme active`} pe site-uri
          </span>
          <span className="ml-auto flex items-center gap-1 text-sm">
            Vezi alertele <ArrowRight size={14} />
          </span>
        </Link>
      ) : (
        <Link href="/dashboard/alerte" className="flex items-center gap-3 rounded-xl border border-good/30 bg-good-bg px-4 py-3 text-good">
          <CheckCircle2 size={20} className="shrink-0" />
          <span className="font-medium">Toate site-urile merg, nicio problemă activă</span>
        </Link>
      )}

      <InboxTodo />

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-3">Azi, până acum</h2>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Vânzări azi" value={formatAmounts(salesToday)} sub={`ieri: ${formatAmounts(salesYesterday)}`} />
          <Stat label="Vizitatori azi" value={nf(sumMap(visToday))} sub={`ieri: ${nf(sumMap(visYesterday))}`} />
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-text-3">Luna asta · {cur.label}</h2>
          <span className="text-xs text-text-3">față de {prev.label}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Vânzări" value={formatAmounts(t.by.revenue)} cur={t.revenue} prev={pt.revenue} sub={[`${t.orders} plăți`, approxRon(t.by.revenue, t.revenue)].filter(Boolean).join(" · ")} />
          <Stat label="Costuri" value={formatAmounts(t.by.costs)} cur={t.costs} prev={pt.costs} lowerIsBetter sub={approxRon(t.by.costs, t.costs)} />
          <Stat
            label={t.profit >= 0 ? "Profit" : "Pierdere"}
            value={formatAmounts(t.by.profit)}
            tone={t.profit >= 0 ? "good" : "bad"}
            cur={t.profit}
            prev={pt.profit}
            sub={approxRon(t.by.profit, t.profit)}
          />
          <Stat label="Vizitatori" value={nf(sumMap(visMonth))} cur={sumMap(visMonth)} prev={sumMap(visPrevMonth)} />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/dashboard/bani" className="btn btn-ghost text-sm">
            <Wallet size={14} /> Toate proiectele — bani
          </Link>
          <Link href="/dashboard/raport" className="btn btn-ghost text-sm">
            <Mail size={14} /> Raportul de dimineață
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium uppercase tracking-wide text-text-3">Pe proiect, luna asta</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map(({ r, p, alerts: n }) => {
            const v = visMonth.get(p.id) ?? 0;
            const g = gsc.get(p.id);
            const gp = gscPrev.get(p.id);
            const money = (x: number) => formatMoneyFine(x, r.currency);
            return (
              <Link key={p.id} href={`/dashboard/projects/${p.id}`} className="card block p-4 hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    {p.domain && <div className="truncate text-xs text-text-3">{p.domain}</div>}
                  </div>
                  {n > 0 ? (
                    <span className="shrink-0 rounded-full bg-bad-bg px-2 py-0.5 text-xs font-medium text-bad">
                      {n === 1 ? "1 alertă" : `${n} alerte`}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-good-bg px-2 py-0.5 text-xs text-good">OK</span>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-text-3">Vânzări</dt>
                    <dd className="font-semibold tabular">{money(r.cur.revenue)}</dd>
                    <dd>
                      <Trend cur={r.cur.revenue} prev={r.prev.revenue} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-3">Vizitatori</dt>
                    <dd className="font-semibold tabular">{nf(v)}</dd>
                    <dd>
                      <Trend cur={v} prev={visPrevMonth.get(p.id) ?? 0} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-3">{r.cur.profit >= 0 ? "Profit" : "Pierdere"}</dt>
                    <dd className={`font-semibold tabular ${r.cur.profit >= 0 ? "text-good" : "text-bad"}`}>{money(r.cur.profit)}</dd>
                  </div>
                </dl>
                <div className="mt-3 border-t border-border pt-2 text-xs text-text-2">
                  {g && g.clicks + (gp?.clicks ?? 0) > 0 ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      Clicuri din Google (28 zile): <strong className="tabular">{nf(g.clicks)}</strong>
                      {gp && gp.days > 0 && <Trend cur={g.clicks} prev={gp.clicks} />}
                    </span>
                  ) : (
                    <span className="text-text-3">Încă fără clicuri din Google</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
