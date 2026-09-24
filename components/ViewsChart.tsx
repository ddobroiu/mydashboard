"use client";

import { useEffect, useRef, useState } from "react";
import type { SocialDaily } from "@/lib/social";

const H = 200;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };
const GAP = 2;

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

// Vizualizarile clipurilor, puse pe ziua in care a fost publicat fiecare clip.
export function ViewsChart({ data }: { data: SocialDaily[] }) {
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

  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.views), 0));
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.max(1, Math.min(28, slot - GAP));
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((t) => (max / 4) * t);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 70)));
  const r = Math.min(4, barW / 2);

  // Bara cu colturile de sus rotunjite, lipita de axa jos
  const bar = (i: number, v: number) => {
    const x0 = x(i);
    const y0 = y(v);
    const h = PAD.top + innerH - y0;
    if (h <= 0) return "";
    const rr = Math.min(r, h);
    return `M${x0},${y0 + h}V${y0 + rr}Q${x0},${y0} ${x0 + rr},${y0}H${x0 + barW - rr}Q${x0 + barW},${y0} ${x0 + barW},${y0 + rr}V${y0 + h}Z`;
  };

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((px - PAD.left) / slot);
    setHover(i >= 0 && i < data.length ? i : null);
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className="card p-4">
      <h2 className="font-medium mb-2">Vizualizări pe ziua publicării</h2>
      <div ref={wrap} className="relative">
        <svg
          width={width}
          height={H}
          viewBox={`0 0 ${width} ${H}`}
          className="block touch-none"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label="Grafic cu vizualizările clipurilor, pe ziua publicării"
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
              <text key={d.date} x={x(i) + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-3)">
                {fmtDay(d.date)}
              </text>
            ) : null,
          )}
          {hover !== null && (
            <rect x={PAD.left + hover * slot} y={PAD.top} width={slot} height={innerH} fill="var(--grid)" opacity={0.6} />
          )}
          {data.map((d, i) => (
            <path key={d.date} d={bar(i, d.views)} fill="var(--accent)" />
          ))}
        </svg>

        {h && hover !== null && (
          <div
            className="absolute top-2 pointer-events-none card px-3 py-2 text-sm shadow-lg min-w-36"
            style={x(hover) > width / 2 ? { right: width - x(hover) + 8 } : { left: x(hover) + barW + 8 }}
          >
            <div className="text-text-3 text-xs mb-1">{fmtDay(h.date)}</div>
            <div className="tabular">
              <strong>{h.views.toLocaleString("ro-RO")}</strong> <span className="text-text-2">vizualizări</span>
            </div>
            <div className="text-text-2 text-xs tabular">
              {h.posts} {h.posts === 1 ? "clip publicat" : "clipuri publicate"}
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
                <th className="py-1 font-normal text-right">Clipuri</th>
                <th className="py-1 font-normal text-right">Vizualizări</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.date} className="border-t border-border">
                  <td className="py-1">{fmtDay(d.date)}</td>
                  <td className="py-1 text-right">{d.posts}</td>
                  <td className="py-1 text-right">{d.views.toLocaleString("ro-RO")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
