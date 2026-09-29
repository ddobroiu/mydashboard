import { AI_PROVIDER_NAMES, type AiProviderKey, type ByProvider } from "@/lib/ai-api-costs";

export const AI_COLORS: Record<AiProviderKey, string> = {
  ANTHROPIC: "var(--series-spend)",
  OPENAI: "var(--good)",
  REPLICATE: "var(--accent)",
};
const ORDER: AiProviderKey[] = ["REPLICATE", "OPENAI", "ANTHROPIC"];

const W = 900;
const H = 200;
const PAD = { top: 10, right: 8, bottom: 24, left: 48 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 4 >= v)! * pow;
  return step * 4;
}

const usd = (v: number) => `$${v.toLocaleString("ro-RO", { maximumFractionDigits: v < 10 ? 2 : 0 })}`;
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

// Costul AI pe zi, ultimele 30 de zile, cu bare stivuite pe furnizor. Desenat pe server (fara JS); detaliile la hover din <title>.
export function AiTrendChart({ data }: { data: ({ date: string } & ByProvider)[] }) {
  const totals = data.map((d) => d.ANTHROPIC + d.OPENAI + d.REPLICATE);
  const max = niceMax(Math.max(0, ...totals));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(2, slot - 3);
  const y = (v: number) => (v / max) * innerH;
  const labelEvery = Math.ceil(data.length / 8);

  return (
    <div className="card p-4 space-y-2">
      <div className="flex flex-wrap gap-4 text-xs text-text-2">
        {ORDER.slice()
          .reverse()
          .map((p) => (
            <span key={p} className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: AI_COLORS[p] }} />
              {AI_PROVIDER_NAMES[p]}
            </span>
          ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Costul AI pe zi, ultimele 30 de zile">
        {[0, 1, 2, 3, 4].map((t) => {
          const v = (max / 4) * t;
          const yy = PAD.top + innerH - y(v);
          return (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 6} y={yy + 4} textAnchor="end" fontSize={11} fill="var(--text-3)">
                {usd(v)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          let base = PAD.top + innerH;
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const tip = `${fmtDay(d.date)}: ${usd(totals[i])}` + ORDER.filter((p) => d[p] > 0).map((p) => ` · ${AI_PROVIDER_NAMES[p]} ${usd(d[p])}`).join("");
          return (
            <g key={d.date}>
              <title>{tip}</title>
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {ORDER.map((p) => {
                const h = y(d[p]);
                if (h <= 0) return null;
                base -= h;
                return <rect key={p} x={x} y={base} width={barW} height={h} fill={AI_COLORS[p]} />;
              })}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                  {fmtDay(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
