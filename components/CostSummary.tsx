import type { Provider } from "@prisma/client";
import { formatMoney } from "@/lib/metrics";
import { Tile } from "./KpiTiles";

const ADS: Partial<Record<Provider, string>> = { META: "Meta Ads", GOOGLE_ADS: "Google Ads", TIKTOK: "TikTok Ads", MANUAL: "Alte cheltuieli" };

const usd = (v: number) =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

// Toate costurile proiectului in perioada: reclame (din care pe clipuri) si AI
export function CostSummary({
  adSpend,
  byProvider,
  clipAdSpend,
  aiUsd,
  aiLabel,
  revenue,
  currency,
}: {
  adSpend: number;
  byProvider: { provider: Provider; spend: number }[];
  clipAdSpend: number;
  aiUsd: number | null;
  aiLabel?: string;
  revenue: number;
  currency: string;
}) {
  const providers = byProvider.filter((p) => p.spend > 0);
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Costuri</h2>
        <p className="text-xs text-text-3">
          Reclamele sunt în moneda conturilor de reclame; costul AI e în dolari, de aceea nu le adunăm.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Reclame"
          value={formatMoney(adSpend, currency)}
          sub={providers.length > 0 ? providers.map((p) => `${ADS[p.provider] ?? p.provider} ${formatMoney(p.spend, currency)}`).join(" · ") : "nicio cheltuială"}
        />
        <Tile
          label="Din care pe clipuri"
          value={formatMoney(clipAdSpend, currency)}
          sub="campaniile „Fă reclamă” (clip:… în nume); detalii în Social"
        />
        <Tile label="Cost AI" value={aiUsd === null ? "–" : usd(aiUsd)} sub={aiUsd === null ? "niciun cont AI legat" : aiLabel || "Replicate"} />
        <Tile
          label="Încasări minus reclame"
          value={formatMoney(revenue - adSpend, currency)}
          tone={revenue - adSpend < 0 ? "bad" : undefined}
          sub={`încasări: ${formatMoney(revenue, currency)}`}
        />
      </div>
    </section>
  );
}
