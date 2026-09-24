import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatMoney, type CampaignStat } from "@/lib/metrics";
import { providerName } from "@/lib/integrations/types";

// O campanie care a cheltuit peste prag si nu a raportat nicio achizitie e marcata ca problema.
const NO_RESULT_THRESHOLD = 100;

function Verdict({ c }: { c: CampaignStat }) {
  if (c.conversions === 0 && c.spend >= NO_RESULT_THRESHOLD) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-bad-bg text-bad px-2 py-0.5 text-xs">
        <AlertTriangle size={12} /> Consumă fără vânzări
      </span>
    );
  }
  if (c.spend > 0 && c.conversionValue / c.spend >= 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-good-bg text-good px-2 py-0.5 text-xs">
        <CheckCircle2 size={12} /> Aduce rezultate
      </span>
    );
  }
  return null;
}

export function CampaignTable({ campaigns, currency }: { campaigns: CampaignStat[]; currency: string }) {
  return (
    <div className="card p-4">
      <h2 className="font-medium">Campanii</h2>
      <p className="text-xs text-text-3 mb-3">
        Achizițiile și valoarea sunt cele raportate de platformă (orientativ; platformele își pot atribui aceeași
        vânzare).
      </p>
      {campaigns.length === 0 ? (
        <p className="text-sm text-text-2">Nicio campanie cu cheltuieli în perioada aleasă.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm tabular whitespace-nowrap">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Campanie</th>
                <th className="py-2 pl-4 font-normal text-right">Cheltuit</th>
                <th className="py-2 pl-4 font-normal text-right">Click-uri</th>
                <th className="py-2 pl-4 font-normal text-right">CPC</th>
                <th className="py-2 pl-4 font-normal text-right">Achiziții</th>
                <th className="py-2 pl-4 font-normal text-right">ROAS platformă</th>
                <th className="py-2 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={`${c.provider}-${c.campaignId}`} className="border-t border-border">
                  <td className="py-2 pr-4 whitespace-normal min-w-48">
                    <div className="font-medium">{c.campaignName}</div>
                    <div className="text-xs text-text-3">{providerName(c.provider)}</div>
                  </td>
                  <td className="py-2 pl-4 text-right">{formatMoney(c.spend, currency)}</td>
                  <td className="py-2 pl-4 text-right">{c.clicks.toLocaleString("ro-RO")}</td>
                  <td className="py-2 pl-4 text-right">
                    {c.clicks > 0 ? (c.spend / c.clicks).toFixed(2) : "–"}
                  </td>
                  <td className="py-2 pl-4 text-right">{c.conversions.toLocaleString("ro-RO")}</td>
                  <td className="py-2 pl-4 text-right">
                    {c.spend > 0 && c.conversionValue > 0 ? `${(c.conversionValue / c.spend).toFixed(2)}x` : "–"}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    <Verdict c={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
