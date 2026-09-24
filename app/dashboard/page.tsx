import Link from "next/link";
import { projectsForUser, requireUser } from "@/lib/access";
import { getMetrics, formatMoney } from "@/lib/metrics";
import { lastNDays } from "@/lib/dates";
import { providerName } from "@/lib/integrations/types";
import { KpiTiles, CurrencyWarning } from "@/components/KpiTiles";
import { SpendRevenueChart } from "@/components/SpendRevenueChart";
import { RangeTabs, parseRange } from "@/components/RangeTabs";
import { SocialSection } from "@/components/SocialSection";
import { getSocialMetrics } from "@/lib/social";

export default async function Overview({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const userId = await requireUser();
  const days = parseRange((await searchParams).days);
  const { since, until } = lastNDays(days);
  const projects = await projectsForUser(userId);

  if (projects.length === 0) {
    return (
      <div className="card p-8 text-center space-y-3 max-w-lg mx-auto mt-12">
        <h1 className="text-xl font-semibold">Niciun proiect încă</h1>
        <p className="text-text-2 text-sm">
          Creează primul proiect (ex. tablou.net), apoi conectează Stripe și Meta Ads.
        </p>
        <Link href="/dashboard/projects/new" className="btn">
          Proiect nou
        </Link>
      </div>
    );
  }

  const currency = projects[0].currency;
  const socialIds = projects.filter((p) => p.connections.some((c) => c.provider === "POSTINGCLIPS")).map((p) => p.id);
  const [total, perProject, social] = await Promise.all([
    getMetrics(projects.map((p) => p.id), since, until),
    Promise.all(projects.map(async (p) => ({ p, m: await getMetrics([p.id], since, until) }))),
    socialIds.length > 0 ? getSocialMetrics(socialIds, since, until) : null,
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Toate proiectele</h1>
        <RangeTabs basePath="/dashboard" days={days} />
      </div>
      <CurrencyWarning currencies={total.currencies} currency={currency} />
      <KpiTiles m={total} currency={currency} />
      <SpendRevenueChart data={total.daily} currency={currency} />

      <div className="card p-4">
        <h2 className="font-medium mb-3">Pe proiect</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm tabular whitespace-nowrap">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Proiect</th>
                <th className="py-2 font-normal text-right">Încasări</th>
                <th className="py-2 font-normal text-right">Reclame</th>
                <th className="py-2 font-normal text-right">ROAS</th>
                <th className="py-2 font-normal text-right">Rămas după reclame</th>
                <th className="py-2 font-normal pl-4">Conexiuni</th>
              </tr>
            </thead>
            <tbody>
              {perProject
                .sort((a, b) => b.m.revenue - a.m.revenue)
                .map(({ p, m }) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2">
                      <Link href={`/dashboard/projects/${p.id}?days=${days}`} className="font-medium hover:text-accent">
                        {p.name}
                      </Link>
                    </td>
                    <td className="py-2 text-right">{formatMoney(m.revenue, p.currency)}</td>
                    <td className="py-2 text-right">{formatMoney(m.spend, p.currency)}</td>
                    <td className={`py-2 text-right ${m.roas !== null && m.roas < 1 ? "text-bad" : ""}`}>
                      {m.roas === null ? "–" : `${m.roas.toFixed(2)}x`}
                    </td>
                    <td className={`py-2 text-right ${m.profitAfterAds < 0 ? "text-bad" : ""}`}>
                      {formatMoney(m.profitAfterAds, p.currency)}
                    </td>
                    <td className="py-2 pl-4 text-xs text-text-2">
                      {p.connections.length === 0
                        ? "–"
                        : p.connections.map((c) => (
                            <span key={c.id} className={c.status === "ERROR" ? "text-bad mr-2" : "mr-2"}>
                              {providerName(c.provider)}
                              {c.status === "ERROR" && " (eroare)"}
                            </span>
                          ))}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {social && <SocialSection s={social} />}
    </div>
  );
}
