"use client";

import { useEffect, useRef, useState } from "react";
import type { DailyPoint } from "@/lib/metrics";

const H = 260;
const PAD = { top: 16, right: 72, bottom: 28, left: 56 };

const SERIES = [
  { key: "revenue", label: "Încasări", color: "var(--series-revenue)" },
  { key: "spend", label: "Reclame", color: "var(--series-spend)" },
] as const;

function niceMax(v: number) {
  if (v <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 4 >= v)! * pow;
  return step * 4;
}

const fmtShort = (v: number) =>
  new Intl.NumberFormat("ro-RO", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

export function SpendRevenueChart({ data, currency }: { data: DailyPoint[]; currency: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(300, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmtMoney = (v: number) =>
    new Intl.NumberFormat("ro-RO", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.spend, d.revenue)), 0));
  const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((t) => (max / 4) * t);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70)));

  // Etichetele directe din dreapta: le departam daca se suprapun.
  const last = data[data.length - 1];
  let endY = SERIES.map((s) => y(last?.[s.key] ?? 0));
  if (Math.abs(endY[0] - endY[1]) < 16) {
    const mid = (endY[0] + endY[1]) / 2;
    const up = endY[0] <= endY[1] ? 0 : 1;
    endY = endY.map((_, i) => (i === up ? mid - 8 : mid + 8));
  }

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - PAD.left) / innerW) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  const h = hover !== null ? data[hover] : null;

  if (!data.some((d) => d.spend > 0 || d.revenue > 0)) {
    return (
      <div ref={wrap} className="card p-8 text-center text-sm text-text-2">
        Nicio încasare sau cheltuială în perioada aleasă. Conectează Stripe și Meta Ads mai jos, iar datele apar aici
        după prima sincronizare.
      </div>
    );
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="font-medium">Încasări vs. cheltuieli pe reclame, pe zi</h2>
        <div className="flex gap-4 text-sm text-text-2">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 rounded" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Grafic încasări și cheltuieli pe reclame pe zi"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-3)">
                {fmtShort(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                {fmtDay(d.date)}
              </text>
            ) : null,
          )}

          {SERIES.map((s, si) => (
            <g key={s.key}>
              <polyline
                points={data.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {last && (
                <text x={x(data.length - 1) + 8} y={endY[si]} dy="0.32em" fontSize={12} fill="var(--text-2)">
                  {s.label}
                </text>
              )}
            </g>
          ))}

          {h && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--text-3)" strokeWidth={1} />
              {SERIES.map((s) => (
                <circle
                  key={s.key}
                  cx={x(hover)}
                  cy={y(h[s.key])}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
        </svg>

        {h && hover !== null && (
          <div
            className="absolute top-2 pointer-events-none card px-3 py-2 text-sm shadow-lg min-w-44"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}
          >
            <div className="text-text-3 text-xs mb-1">{fmtDay(h.date)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: s.color }} />
                <strong className="tabular">{fmtMoney(h[s.key])}</strong>
                <span className="text-text-2">{s.label}</span>
              </div>
            ))}
            <div className="text-text-2 text-xs mt-1 tabular">
              ROAS {h.spend > 0 ? `${(h.revenue / h.spend).toFixed(2)}x` : "–"}
            </div>
          </div>
        )}
      </div>

      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-text-3">Vezi ca tabel</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-1 font-normal">Zi</th>
                <th className="py-1 font-normal text-right">Încasări</th>
                <th className="py-1 font-normal text-right">Reclame</th>
                <th className="py-1 font-normal text-right">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="py-1">{fmtDay(d.date)}</td>
                  <td className="py-1 text-right">{fmtMoney(d.revenue)}</td>
                  <td className="py-1 text-right">{fmtMoney(d.spend)}</td>
                  <td className="py-1 text-right">{d.spend > 0 ? `${(d.revenue / d.spend).toFixed(2)}x` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
