import Link from "next/link";
import { AI_PROVIDER_NAMES, type ApiAiCosts } from "@/lib/ai-api-costs";
import { Tile } from "./KpiTiles";

const usd = (v: number, digits = 2) =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
const tokens = (v: number) => (v > 0 ? new Intl.NumberFormat("ro-RO", { notation: "compact", maximumFractionDigits: 1 }).format(v) : "–");

// Costul Anthropic / OpenAI al proiectului (din workspace-urile / proiectele legate de el), facturat de ei
export function ApiAiCostSection({ ai }: { ai: ApiAiCosts }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Cost AI (Anthropic, OpenAI)</h2>
        <p className="text-xs text-text-3">
          Costul facturat de ei, pe zile UTC, din workspace-urile / proiectele legate de acest proiect (în{" "}
          <Link href="/dashboard/ai" className="text-accent">
            Costuri AI
          </Link>
          ). Ziua de azi apare de mâine.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Cost API total" value={usd(ai.costUsd)} />
        {ai.byProvider.map((p) => (
          <Tile key={p.provider} label={AI_PROVIDER_NAMES[p.provider]} value={usd(p.costUsd)} />
        ))}
      </div>
      {ai.models.length > 0 && (
        <div className="card p-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Model</th>
                <th className="py-2 pl-4 font-normal">Furnizor</th>
                <th className="py-2 pl-4 font-normal text-right">Tokeni intrare</th>
                <th className="py-2 pl-4 font-normal text-right">din cache</th>
                <th className="py-2 pl-4 font-normal text-right">Tokeni ieșire</th>
                <th className="py-2 pl-4 font-normal text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {ai.models.map((m) => (
                <tr key={`${m.provider}|${m.model}`} className="border-t border-border">
                  <td className="py-2">{m.model}</td>
                  <td className="py-2 pl-4">{AI_PROVIDER_NAMES[m.provider]}</td>
                  <td className="py-2 pl-4 text-right">{tokens(m.inputTokens)}</td>
                  <td className="py-2 pl-4 text-right">{tokens(m.cachedTokens)}</td>
                  <td className="py-2 pl-4 text-right">{tokens(m.outputTokens)}</td>
                  <td className="py-2 pl-4 text-right">{usd(m.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
