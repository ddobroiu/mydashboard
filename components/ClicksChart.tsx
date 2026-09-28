"use client";

import { useEffect, useRef, useState } from "react";

const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 40 };

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });
const nf = (v: number) => v.toLocaleString("ro-RO");

function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow * 4 >= v)! * pow;
  return step * 4;
}

// Clicurile din Google pe zi: coloane subtiri, o singura culoare, detalii la atingere
export function ClicksChart({ data }: { data: { date: string; clicks: number; impressions: number }[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(700);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.clicks)));
  const slot = innerW / Math.max(1, data.length);
  const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
  const bw = Math.max(1, slot - gap);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((t) => (max / 4) * t);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 64)));
  const r = Math.min(4, bw / 2);

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((px - PAD.left) / slot);
    setHover(i >= 0 && i < data.length ? i : null);
  }
  const h = hover !== null ? data[hover] : null;
  const hx = hover !== null ? PAD.left + hover * slot + slot / 2 : 0;

  return (
    <div>
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Clicuri din Google pe zi"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-3)">
                {nf(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * slot + gap / 2;
            const top = y(d.clicks);
            const bh = PAD.top + innerH - top;
            return (
              <g key={d.date}>
                {bh > 0 && (
                  <path
                    d={bh > r ? `M${x},${top + bh} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${top + bh} Z` : `M${x},${top + bh} V${top} H${x + bw} V${top + bh} Z`}
                    fill="var(--accent)"
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                    {fmtDay(d.date)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {h && (
          <div
            className="absolute top-1 pointer-events-none card px-3 py-2 text-sm shadow-lg whitespace-nowrap"
            style={hx > width / 2 ? { right: width - hx + 10 } : { left: hx + 10 }}
          >
            <div className="text-xs text-text-3">{fmtDay(h.date)}</div>
            <div>
              <strong className="tabular">{nf(h.clicks)}</strong> <span className="text-text-2">clicuri</span>
            </div>
            <div className="text-xs text-text-2 tabular">{nf(h.impressions)} afișări</div>
          </div>
        )}
      </div>
      <details className="mt-1 text-sm">
        <summary className="cursor-pointer text-text-3">Vezi ca tabel</summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <table className="w-full tabular">
            <thead className="text-left text-text-3">
              <tr>
                <th className="py-1 font-normal">Zi</th>
                <th className="py-1 text-right font-normal">Clicuri</th>
                <th className="py-1 text-right font-normal">Afișări</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="py-1">{fmtDay(d.date)}</td>
                  <td className="py-1 text-right">{nf(d.clicks)}</td>
                  <td className="py-1 text-right">{nf(d.impressions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
