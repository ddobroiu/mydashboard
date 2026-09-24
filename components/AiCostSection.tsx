import type { AiCosts } from "@/lib/ai-costs";
import { formatMoney } from "@/lib/metrics";
import { Tile } from "./KpiTiles";

const usd = (v: number, digits = 2) =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);

export function AiCostSection({ ai, revenue, currency }: { ai: AiCosts; revenue: number; currency: string }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Cost AI (Replicate)</h2>
        <p className="text-xs text-text-3">
          Calculat din durata fiecărei rulări × tariful public Replicate (Replicate nu dă prețul prin API), în dolari. Poate diferi
          puțin de factura lor.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Cost AI total"
          value={usd(ai.costUsd)}
          sub={revenue > 0 ? `încasări în perioadă: ${formatMoney(revenue, currency)}` : undefined}
        />
        <Tile label="Generări 3D reușite" value={ai.generations.toLocaleString("ro-RO")} />
        <Tile
          label="Cost / generare"
          value={ai.perGeneration === null ? "–" : usd(ai.perGeneration, 3)}
          sub="include și imaginea/traducerea la text→3D"
        />
        <Tile
          label="Rulări eșuate"
          value={ai.failed.toLocaleString("ro-RO")}
          tone={ai.failed > 0 ? "bad" : undefined}
          sub="se plătește și timpul lor"
        />
      </div>
      {ai.models.length > 0 && (
        <div className="card p-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Model</th>
                <th className="py-2 pl-4 font-normal text-right">Rulări</th>
                <th className="py-2 pl-4 font-normal text-right">Eșuate</th>
                <th className="py-2 pl-4 font-normal text-right">Timp GPU</th>
                <th className="py-2 pl-4 font-normal text-right">Cost</th>
                <th className="py-2 pl-4 font-normal text-right">Cost / rulare</th>
              </tr>
            </thead>
            <tbody>
              {ai.models.map((m) => (
                <tr key={m.model} className="border-t border-border">
                  <td className="py-2">
                    {m.model}
                    {m.isGeneration && <span className="ml-2 text-xs text-text-3">model 3D</span>}
                  </td>
                  <td className="py-2 pl-4 text-right">{m.runs}</td>
                  <td className="py-2 pl-4 text-right">{m.failed}</td>
                  <td className="py-2 pl-4 text-right">{Math.round(m.seconds / 60)} min</td>
                  <td className="py-2 pl-4 text-right">{usd(m.costUsd)}</td>
                  <td className="py-2 pl-4 text-right">{m.runs + m.failed > 0 ? usd(m.costUsd / (m.runs + m.failed), 3) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
