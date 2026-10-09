import Link from "next/link";
import { AlertTriangle, ArrowRight, Eye, Megaphone, Plus, ShoppingBag, Users, Wallet } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { ago, getOverview, totals, windows, type BusinessOverview, type WindowKey } from "@/lib/overview";
import { getRates } from "@/lib/fx";
import { getTraffic } from "@/lib/tracking/report";
import { adsByPlatform, recentPayments, socialSummary } from "@/lib/home";
import { count, money } from "@/lib/format";
import { Trend } from "@/components/Stat";

export const dynamic = "force-dynamic";

type Period = "azi" | "7" | "30";
const CUR: Record<Period, WindowKey> = { azi: "azi", "7": "d7", "30": "d30" };
const PREV: Record<Period, WindowKey | null> = { azi: null, "7": "p7", "30": "p30" };
const LABEL: Record<Period, string> = { azi: "azi", "7": "în ultimele 7 zile", "30": "în ultimele 30 de zile" };

function Big({ icon: Icon, label, value, cur, prev, lowerIsBetter, sub }: {
  icon: typeof Wallet; label: string; value: string; cur: number; prev: number | null; lowerIsBetter?: boolean; sub?: string;
}) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center gap-2 text-sm text-text-2">
        <Icon size={16} aria-hidden /> {label}
      </div>
      <div className="mt-2 truncate text-3xl font-semibold tabular">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-3">
        {prev !== null && <Trend cur={cur} prev={prev} lowerIsBetter={lowerIsBetter} label="față de înainte" />}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

function Bar({ value, max, tone = "bg-accent" }: { value: number; max: number; tone?: string }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-bg">
      <div className={`h-2 rounded-full ${tone}`} style={{ width: `${w}%` }} />
    </div>
  );
}

function Section({ title, link, children }: { title: string; link?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {link && (
          <Link href={link.href} className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            {link.label} <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

const dot = (b: BusinessOverview) => (b.status.tone === "bad" ? "bg-bad" : b.status.tone === "warn" ? "bg-warn" : "bg-good");

// Prima pagina: totul pe un singur ecran, simplu. Cat am incasat, de unde vin clientii, cat costa reclamele,
// cine a platit ultimul, cum merg postarile si fiecare afacere pe un rand.
export default async function Overview({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const userId = await requireUser();
  const { p } = await searchParams;
  const period: Period = p === "7" ? "7" : p === "30" ? "30" : "azi";
  const projects = await projectsForUser(userId);

  if (projects.length === 0) {
    return (
      <div className="card mx-auto mt-12 max-w-lg space-y-3 p-8 text-center">
        <h1 className="text-xl font-semibold">Nicio afacere adăugată încă</h1>
        <Link href="/dashboard/projects/new" className="btn">
          <Plus size={16} /> Adaugă o afacere
        </Link>
      </div>
    );
  }

  const ids = projects.map((x) => x.id);
  const W = windows();
  const range = W[CUR[period]];
  const rates = await getRates();
  const [list, traffic, payments, ads, social] = await Promise.all([
    getOverview(projects),
    getTraffic(ids, range.since, range.until),
    recentPayments(projects, rates),
    adsByPlatform(ids, range.since, range.until, rates),
    socialSummary(projects, range.since, range.until),
  ]);

  const k = CUR[period];
  const pk = PREV[period];
  const cur = totals(list, k);
  const comparable = list.filter((b) => b.sources.revenue !== "aplicatie");
  const same = totals(comparable, k);
  const prev = pk ? totals(comparable, pk) : null;
  const problems = list.flatMap((b) => b.issues.filter((i) => i.tone === "bad").map((i) => ({ b, i })));
  const adsTotal = ads.reduce((s, a) => s + a.spend, 0);
  const channels = traffic.simple.filter((c) => c.visitors > 0 || c.orders > 0);
  const maxVisitors = Math.max(0, ...channels.map((c) => c.visitors));
  const adRevenue = (name: string) =>
    traffic.simple.find((c) => c.channel === (name === "Google Ads" ? "Google Ads" : name === "Facebook / Instagram" ? "Facebook / Instagram" : "Alte reclame"))?.revenue ?? 0;
  const rows = [...list].sort((a, b) => (b.w[k].revenue ?? -1) - (a.w[k].revenue ?? -1) || a.name.localeCompare(b.name));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm capitalize text-text-3">
            {new Date().toLocaleDateString("ro-RO", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Bucharest" })}
          </p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
            {money(cur.revenue)} încasați {LABEL[period]}
          </h1>
          <p className="mt-1 text-sm text-text-2">
            {cur.orders === 1 ? "o comandă" : `${count(cur.orders)} comenzi`} · {money(adsTotal)} pe reclame · {count(traffic.visitors || cur.visitors)} vizitatori
            {social.views > 0 && <> · {count(social.views)} vizualizări la postări</>}
          </p>
        </div>
        <nav className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm" aria-label="Perioada">
          {(["azi", "7", "30"] as const).map((v) => (
            <Link
              key={v}
              href={v === "azi" ? "/dashboard" : `/dashboard?p=${v}`}
              className={`rounded-lg px-3 py-1.5 font-medium ${period === v ? "bg-accent text-white" : "text-text-2 hover:text-text"}`}
              aria-current={period === v ? "page" : undefined}
            >
              {v === "azi" ? "Azi" : v === "7" ? "7 zile" : "30 zile"}
            </Link>
          ))}
        </nav>
      </header>

      {problems.length > 0 && (
        <Link href="/dashboard/alerte" className="flex items-start gap-3 rounded-2xl border border-bad/30 bg-bad-bg px-5 py-3 text-bad hover:opacity-90">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
          <span className="text-sm">
            <strong>{problems.length === 1 ? "O problemă" : `${problems.length} probleme`}:</strong>{" "}
            {problems.slice(0, 2).map(({ b, i }) => `${b.name}: ${i.text}`).join(" · ")}
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Big icon={Wallet} label="Încasat" value={money(cur.revenue)} cur={same.revenue} prev={prev?.revenue ?? null} />
        <Big icon={ShoppingBag} label="Comenzi" value={count(cur.orders)} cur={same.orders} prev={prev?.orders ?? null} sub={cur.orders > 0 ? `în medie ${money(cur.revenue / cur.orders)}` : undefined} />
        <Big icon={Megaphone} label="Reclame" value={money(adsTotal)} cur={same.ads} prev={prev?.ads ?? null} lowerIsBetter sub={ads.map((a) => `${a.platform.split(" ")[0]} ${money(a.spend)}`).join(" · ") || undefined} />
        <Big icon={Users} label="Vizitatori" value={count(traffic.visitors || cur.visitors)} cur={same.visitors} prev={prev?.visitors ?? null} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Ultimele plăți">
          {payments.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-2">Nicio plată încă.</p>
          ) : (
            <ul className="divide-y divide-border">
              {payments.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{x.customer || "Client"}</div>
                    <div className="truncate text-xs text-text-3">
                      {x.site || x.projectName} · {ago(x.at)}
                      {x.from && <> · din {x.from}</>}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular">{money(x.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={`De unde vin clienții · ${LABEL[period]}`}>
          {channels.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-2">Încă nu avem vizite măsurate pentru perioada asta.</p>
          ) : (
            <div className="px-5 py-3">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 pb-2 text-xs text-text-3">
                <span>Sursa</span>
                <span className="text-right">Vizitatori</span>
                <span className="text-right">Comenzi</span>
                <span className="text-right">Bani</span>
              </div>
              {channels.map((c) => (
                <div key={c.channel} className="py-1.5">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 text-sm">
                    <span className="truncate">{c.channel}</span>
                    <span className="text-right tabular">{count(c.visitors)}</span>
                    <span className="text-right tabular">{count(c.orders)}</span>
                    <span className="text-right font-medium tabular">{c.revenue > 0 ? money(c.revenue) : "—"}</span>
                  </div>
                  <div className="mt-1">
                    <Bar value={c.visitors} max={maxVisitors} />
                  </div>
                </div>
              ))}
              {traffic.unattributedOrders > 0 && (
                <p className="pt-2 text-xs text-text-3">
                  + {count(traffic.unattributedOrders)} comenzi ({money(traffic.unattributedRevenue)}) fără sursă cunoscută (telefon, WhatsApp, transfer).
                </p>
              )}
            </div>
          )}
        </Section>

        <Section title={`Reclame · ${LABEL[period]}`}>
          {ads.length === 0 ? (
            <p className="px-5 py-6 text-sm text-text-2">Nicio cheltuială pe reclame în perioada asta.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ads.map((a) => {
                const back = adRevenue(a.platform);
                return (
                  <li key={a.platform} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{a.platform}</span>
                      <span className="font-semibold tabular">{money(a.spend)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-text-3">
                      {count(a.clicks)} clicuri{a.clicks > 0 && <> · {money(a.spend / a.clicks)} pe click</>} · au adus{" "}
                      <strong className={back >= a.spend ? "text-good" : "text-bad"}>{money(back)}</strong> în comenzi
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title={`Postări · ${LABEL[period]}`} link={{ href: "/dashboard/postari", label: "Toate" }}>
          <div className="grid grid-cols-3 gap-3 px-5 py-4 text-center">
            <div>
              <div className="text-2xl font-semibold tabular">{count(social.posts)}</div>
              <div className="text-xs text-text-3">postări</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular">{count(social.views)}</div>
              <div className="text-xs text-text-3">vizualizări</div>
            </div>
            <div>
              <div className="text-2xl font-semibold tabular">{count(social.interactions)}</div>
              <div className="text-xs text-text-3">aprecieri, comentarii</div>
            </div>
          </div>
          {social.top.length > 0 && (
            <ul className="divide-y divide-border border-t border-border">
              {social.top.map((t) => (
                <li key={t.id}>
                  <a href={t.url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-5 py-2.5 hover:bg-bg">
                    <Eye size={15} className="shrink-0 text-text-3" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <strong>{t.projectName}</strong> · {t.platform} · {(t.caption ?? "").split("\n")[0]}
                    </span>
                    <span className="shrink-0 text-sm tabular">{count(t.views)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title={`Fiecare afacere · ${LABEL[period]}`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-xs text-text-3">
              <tr className="border-b border-border">
                <th className="px-5 py-2 text-left font-normal">Afacerea</th>
                <th className="px-3 py-2 text-right font-normal">Încasat</th>
                <th className="px-3 py-2 text-right font-normal">Comenzi</th>
                <th className="px-3 py-2 text-right font-normal">Reclame</th>
                <th className="px-3 py-2 text-right font-normal">Profit</th>
                <th className="px-3 py-2 text-right font-normal">Vizitatori</th>
                <th className="px-5 py-2 text-right font-normal">Ultima vânzare</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((b) => {
                const f = b.w[k];
                return (
                  <tr key={b.id} className="hover:bg-bg">
                    <td className="px-5 py-2.5">
                      <Link href={`/dashboard/projects/${b.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <span className={`size-2 shrink-0 rounded-full ${dot(b)}`} aria-hidden />
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{f.revenue === null ? "—" : money(f.revenue)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{f.orders === null ? "—" : count(f.orders)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{f.ads ? money(f.ads) : "—"}</td>
                    <td className={`px-3 py-2.5 text-right font-medium tabular ${f.profit === null ? "" : f.profit >= 0 ? "text-good" : "text-bad"}`}>
                      {f.profit === null ? "—" : money(f.profit)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{f.visitors === null ? "—" : count(f.visitors)}</td>
                    <td className="px-5 py-2.5 text-right text-text-3">{b.lastSaleAt ? ago(b.lastSaleAt) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <p className="text-xs text-text-3">
        Profit = încasat − reclame − costuri AI. „—” = nu avem cifra (nu înseamnă zero). Detalii pe bani în{" "}
        <Link href="/dashboard/bani" className="underline">Bani</Link>.
      </p>
    </div>
  );
}
