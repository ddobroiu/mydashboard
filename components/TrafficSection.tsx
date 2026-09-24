import Link from "next/link";
import { Settings2 } from "lucide-react";
import { formatMoney } from "@/lib/metrics";
import type { Traffic } from "@/lib/tracking/report";
import { Tile } from "./KpiTiles";

const n = (v: number) => v.toLocaleString("ro-RO");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("ro-RO", { maximumFractionDigits: 1 })}%` : "–");

function Roas({ revenue, spend }: { revenue: number; spend: number }) {
  if (spend <= 0) return <>–</>;
  const r = revenue / spend;
  return <span className={r < 1 ? "text-bad" : "text-good"}>{r.toFixed(2)}x</span>;
}

export function TrafficSection({ t, currency, projectId }: { t: Traffic; currency: string; projectId: string }) {
  const money = (v: number) => formatMoney(v, currency);
  const trackingHref = `/dashboard/projects/${projectId}/tracking`;

  if (!t.lastHitAt) {
    return (
      <section className="card p-6 space-y-3 text-center">
        <h2 className="text-lg font-semibold">De unde vin clienții</h2>
        <p className="text-sm text-text-2 max-w-xl mx-auto">
          Pune codul de tracking pe site (se lipește o singură dată, fără programator) și aici vezi pe fiecare canal: cât ai
          cheltuit, câte vizite a adus, câte comenzi și câți bani.
        </p>
        <Link href={trackingHref} className="btn">
          <Settings2 size={14} /> Configurează tracking-ul
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">De unde vin clienții</h2>
          <p className="text-xs text-text-3">
            Din tracking-ul propriu. Comanda merge la ultima sursă prin care a venit clientul în ultimele 30 de zile (nu la „direct”).
          </p>
        </div>
        <Link href={trackingHref} className="btn btn-ghost text-sm">
          <Settings2 size={14} /> Tracking, obiective, linkuri
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile label="Vizite" value={n(t.sessions)} sub={`${n(t.visitors)} vizitatori · ${n(t.pageviews)} pagini`} />
        <Tile label="Comenzi urmărite" value={n(t.orders)} sub={`${pct(t.orders, t.sessions)} din vizite`} />
        <Tile label="Încasări urmărite" value={money(t.revenue)} />
        <Tile label="Obiective atinse" value={n(t.goals)} sub={t.goalsByName.slice(0, 2).map((g) => `${g.name}: ${g.count}`).join(" · ") || "niciun obiectiv setat"} />
        <Tile
          label="Fără sursă"
          value={n(t.unattributedOrders)}
          sub={t.unattributedOrders ? `${money(t.unattributedRevenue)} din plăți fără vizită urmărită` : "toate comenzile au sursă"}
        />
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Pe canal</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tabular whitespace-nowrap">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Canal</th>
                <th className="py-2 pl-4 font-normal text-right">Cheltuit</th>
                <th className="py-2 pl-4 font-normal text-right">Vizite</th>
                <th className="py-2 pl-4 font-normal text-right">Cost / vizită</th>
                <th className="py-2 pl-4 font-normal text-right">Comenzi</th>
                <th className="py-2 pl-4 font-normal text-right">Conversie</th>
                <th className="py-2 pl-4 font-normal text-right">Încasat</th>
                <th className="py-2 pl-4 font-normal text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {t.channels.map((c) => (
                <tr key={c.channel} className="border-t border-border">
                  <td className="py-2 font-medium">{c.channel}</td>
                  <td className="py-2 pl-4 text-right">{c.spend > 0 ? money(c.spend) : "–"}</td>
                  <td className="py-2 pl-4 text-right">{n(c.sessions)}</td>
                  <td className="py-2 pl-4 text-right">{c.spend > 0 && c.sessions > 0 ? (c.spend / c.sessions).toFixed(2) : "–"}</td>
                  <td className="py-2 pl-4 text-right">{n(c.orders)}</td>
                  <td className="py-2 pl-4 text-right">{pct(c.orders, c.sessions)}</td>
                  <td className="py-2 pl-4 text-right">{money(c.revenue)}</td>
                  <td className="py-2 pl-4 text-right">
                    <Roas revenue={c.revenue} spend={c.spend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-medium">Pe sursă și campanie</h2>
        <p className="text-xs text-text-3 mb-3">
          Cheltuiala apare pe campanie când numele din link (utm_campaign) e același cu cel din Meta sau din cheltuielile manuale.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Sursă / tip</th>
                <th className="py-2 pl-4 font-normal">Campanie</th>
                <th className="py-2 pl-4 font-normal text-right">Cheltuit</th>
                <th className="py-2 pl-4 font-normal text-right">Vizite</th>
                <th className="py-2 pl-4 font-normal text-right">Obiective</th>
                <th className="py-2 pl-4 font-normal text-right">Comenzi</th>
                <th className="py-2 pl-4 font-normal text-right">Încasat</th>
                <th className="py-2 pl-4 font-normal text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {t.sources.map((s) => (
                <tr key={`${s.source}|${s.medium}|${s.campaign}`} className="border-t border-border align-top">
                  <td className="py-2 whitespace-nowrap">
                    <div className="font-medium">{s.source}</div>
                    <div className="text-xs text-text-3">{s.medium} · {s.channel}</div>
                  </td>
                  <td className="py-2 pl-4 break-words max-w-64">{s.campaign ?? <span className="text-text-3">–</span>}</td>
                  <td className="py-2 pl-4 text-right whitespace-nowrap">{s.spend > 0 ? money(s.spend) : "–"}</td>
                  <td className="py-2 pl-4 text-right">{n(s.sessions)}</td>
                  <td className="py-2 pl-4 text-right">{n(s.goals)}</td>
                  <td className="py-2 pl-4 text-right">{n(s.orders)}</td>
                  <td className="py-2 pl-4 text-right whitespace-nowrap">{money(s.revenue)}</td>
                  <td className="py-2 pl-4 text-right">
                    <Roas revenue={s.revenue} spend={s.spend} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="font-medium mb-3">Pagini pe care intră oamenii</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Pagină</th>
                <th className="py-2 pl-4 font-normal text-right">Vizite</th>
                <th className="py-2 pl-4 font-normal text-right">Comenzi</th>
                <th className="py-2 pl-4 font-normal text-right">Încasat</th>
              </tr>
            </thead>
            <tbody>
              {t.landingPages.map((p) => (
                <tr key={p.path} className="border-t border-border">
                  <td className="py-2 break-all">{p.path}</td>
                  <td className="py-2 pl-4 text-right">{n(p.sessions)}</td>
                  <td className="py-2 pl-4 text-right">{n(p.orders)}</td>
                  <td className="py-2 pl-4 text-right whitespace-nowrap">{money(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
