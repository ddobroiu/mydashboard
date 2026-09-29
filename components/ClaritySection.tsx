import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { ClarityReport, ClarityTotals } from "@/lib/clarity";
import { clarityDashboardUrl } from "@/lib/integrations/clarity";
import { Trend, nf } from "./Stat";

const pct = (v: number | null) => (v === null ? "–" : `${v.toLocaleString("ro-RO", { maximumFractionDigits: 0 })}%`);
const share = (v: number | null) => (v === null ? null : `în ${v.toLocaleString("ro-RO", { maximumFractionDigits: 1 })}% din vizite`);

function duration(sec: number | null) {
  if (sec === null) return "–";
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

type Item = {
  label: string;
  value: string;
  help: string;
  // cifra pe zi, ca trendul sa fie corect si cand perioadele au un numar diferit de zile cu date
  cur: number | null;
  prev: number | null;
  lowerIsBetter?: boolean;
  sub?: string | null;
  warn?: boolean;
};

function items(c: ClarityTotals, p: ClarityTotals | null): Item[] {
  const perDay = (t: ClarityTotals | null, v: (t: ClarityTotals) => number) => (t && t.days > 0 ? v(t) / t.days : null);
  return [
    {
      label: "Vizite",
      value: nf(c.sessions),
      help: "Câte vizite a înregistrat Clarity (fără roboți).",
      cur: perDay(c, (t) => t.sessions),
      prev: perDay(p, (t) => t.sessions),
    },
    {
      label: "Timp activ pe vizită",
      value: duration(c.activeTime),
      help: "Cât a stat omul efectiv pe site: a derulat, a dat clic, a scris.",
      cur: c.activeTime,
      prev: p?.activeTime ?? null,
    },
    {
      label: "Cât derulează",
      value: pct(c.scrollDepth),
      help: "Cât din pagină văd oamenii, în medie. Sub 50% = jumătatea de jos a paginii e văzută rar.",
      cur: c.scrollDepth,
      prev: p?.scrollDepth ?? null,
    },
    {
      label: "Clicuri de nervi",
      value: nf(c.rageClicks),
      help: "Clicuri repetate rapid pe același loc: ceva nu răspunde cum se așteaptă omul.",
      cur: perDay(c, (t) => t.rageClicks),
      prev: perDay(p, (t) => t.rageClicks),
      lowerIsBetter: true,
      sub: c.rageClicks ? share(c.ragePct) : null,
      warn: c.rageClicks > 0,
    },
    {
      label: "Clicuri fără efect",
      value: nf(c.deadClicks),
      help: "Clicuri pe ceva care nu face nimic (text sau imagine care arată a buton).",
      cur: perDay(c, (t) => t.deadClicks),
      prev: perDay(p, (t) => t.deadClicks),
      lowerIsBetter: true,
      sub: c.deadClicks ? share(c.deadPct) : null,
    },
    {
      label: "Erori JavaScript",
      value: nf(c.scriptErrors),
      help: "Erori în codul paginii, la vizitatori. Pot strica butoane sau formulare.",
      cur: perDay(c, (t) => t.scriptErrors),
      prev: perDay(p, (t) => t.scriptErrors),
      lowerIsBetter: true,
      sub: c.scriptErrors ? share(c.errorPct) : null,
      warn: c.scriptErrors > 0,
    },
  ];
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "UTC" });

// Cum se poarta vizitatorii pe site, din Microsoft Clarity (o citire pe zi)
export function ClaritySection({ c, basePath, days }: { c: ClarityReport | null; basePath: string; days: number }) {
  if (!c) {
    return (
      <section className="card p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Cum se poartă vizitatorii (Microsoft Clarity)</h2>
          <p className="text-sm text-text-2 max-w-xl">
            Leagă Clarity (token din Settings → Data Export) ca să vezi aici cât derulează oamenii, cât stau pe site și unde se
            enervează sau dau de erori.
          </p>
        </div>
        <Link href={`${basePath}?tab=conexiuni&days=${days}`} className="btn btn-ghost">
          Conectează Clarity
        </Link>
      </section>
    );
  }

  const link = c.clarityId ? (
    <a href={clarityDashboardUrl(c.clarityId)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-accent">
      Deschide Clarity <ExternalLink size={14} aria-hidden />
    </a>
  ) : null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Cum se poartă vizitatorii</h2>
          <p className="text-xs text-text-3">
            Din Microsoft Clarity, citit o dată pe zi, dimineața
            {c.lastDate ? ` · ultima zi cu date: ${fmtDay(c.lastDate)}` : ""}
            {c.cur && c.prev ? " · săgețile compară media pe zi cu perioada dinainte" : ""}
          </p>
        </div>
        {link}
      </div>

      {c.lastError && <p className="text-sm text-bad">Clarity nu a răspuns la ultima citire: {c.lastError}</p>}

      {!c.cur ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-text-2 max-w-md mx-auto">
            {c.lastDate
              ? "Nicio zi cu date în perioada aleasă. Alege o perioadă mai lungă sau vezi direct în Clarity."
              : "Clarity e conectat. Primele cifre apar mâine dimineață: Clarity dă datele o singură dată pe zi."}
          </p>
        </div>
      ) : c.cur.sessions === 0 ? (
        <div className="card p-6 text-center">
          <p className="text-sm text-text-2 max-w-md mx-auto">
            Clarity nu a înregistrat nicio vizită în perioada aleasă. Dacă site-ul are vizitatori, verifică dacă scriptul Clarity e pus
            pe site și dacă oamenii au acceptat cookie-urile de analiză.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          {items(c.cur, c.prev).map((i) => (
            <div key={i.label} className="card p-4">
              <div className="text-sm text-text-2">{i.label}</div>
              <div className={`mt-1 text-2xl font-semibold tabular ${i.warn ? "text-bad" : ""}`}>{i.value}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-3">
                {i.cur !== null && i.prev !== null && <Trend cur={i.cur} prev={i.prev} lowerIsBetter={i.lowerIsBetter} />}
                {i.sub}
              </div>
              <p className="mt-2 text-xs text-text-3">{i.help}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
