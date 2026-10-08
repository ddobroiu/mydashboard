import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Megaphone, ShoppingBag, TrendingUp, Users } from "lucide-react";
import type { BusinessOverview, Figures, Issue, Tone } from "@/lib/overview";
import { count, money } from "@/lib/format";
import { Trend } from "@/components/Stat";

const CHIP: Record<Tone, { cls: string; label: string; Icon: typeof CheckCircle2 }> = {
  good: { cls: "bg-good-bg text-good", label: "Merge bine", Icon: CheckCircle2 },
  warn: { cls: "bg-warn-bg text-warn", label: "Atenție", Icon: CircleAlert },
  bad: { cls: "bg-bad-bg text-bad", label: "Problemă", Icon: AlertTriangle },
};

export function StatusChip({ tone }: { tone: Tone }) {
  const { cls, label, Icon } = CHIP[tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <Icon size={13} aria-hidden /> {label}
    </span>
  );
}

// „Detalii tehnice”, ascunse: textul brut al erorilor, pentru programator
export function TechDetails({ issues }: { issues: Issue[] }) {
  const tech = issues.map((i) => i.technical).filter(Boolean);
  if (!tech.length) return null;
  return (
    <details className="group text-xs text-text-3">
      <summary className="cursor-pointer select-none hover:text-text-2">Detalii tehnice</summary>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-bg p-2.5 font-mono text-[11px] leading-relaxed">
        {tech.join("\n\n")}
      </pre>
    </details>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  cur,
  prev,
  lowerIsBetter,
  missing,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: string | null;
  cur?: number | null;
  prev?: number | null;
  lowerIsBetter?: boolean;
  missing?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-text-3">
        <Icon size={13} aria-hidden /> {label}
      </dt>
      {value == null ? (
        <>
          <dd className="mt-1 text-xl font-semibold text-text-3">—</dd>
          {missing && <dd className="text-[11px] leading-snug text-text-3">{missing}</dd>}
        </>
      ) : (
        <>
          <dd className={`mt-1 truncate text-xl font-semibold tabular ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</dd>
          {cur != null && prev != null && (
            <dd>
              <Trend cur={cur} prev={prev} lowerIsBetter={lowerIsBetter} />
            </dd>
          )}
        </>
      )}
    </div>
  );
}

export function BusinessCard({ b, period }: { b: BusinessOverview; period: "7" | "30" }) {
  const cur: Figures = period === "7" ? b.w.d7 : b.w.d30;
  const prev: Figures = period === "7" ? b.w.p7 : b.w.p30;
  const m = (v: number | null) => (v == null ? null : money(v * b.rate, b.currency));
  const st = b.status;
  const more = b.issues.length > 1 ? b.issues.length - 1 : 0;
  const noTrend = b.sources.revenue === "aplicatie";

  return (
    <article className="card flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <header className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold">{b.name}</h3>
          {b.domain && (
            <a href={`https://${b.domain.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="truncate text-xs text-text-3 hover:text-accent">
              {b.domain}
            </a>
          )}
        </div>
        <StatusChip tone={st.tone} />
      </header>

      <div className="px-5 pt-3">
        <p className={`text-sm font-medium ${st.tone === "bad" ? "text-bad" : st.tone === "warn" ? "text-warn" : "text-good"}`}>{st.text}</p>
        {st.action && <p className="mt-0.5 text-xs leading-snug text-text-2">{st.action}</p>}
        {more > 0 && <p className="mt-0.5 text-xs text-text-3">și încă {more === 1 ? "un lucru" : `${more} lucruri`} de verificat</p>}
      </div>

      <div className="mx-5 mt-4 rounded-xl bg-bg px-4 py-3">
        <div className="text-xs text-text-3">Încasări</div>
        {b.w.d30.revenue == null && b.w.azi.revenue == null ? (
          <div className="mt-1">
            <span className="text-2xl font-semibold text-text-3">—</span>
            {b.notes.revenue && <p className="text-[11px] text-text-3">{b.notes.revenue}</p>}
          </div>
        ) : (
          <div className="mt-1 grid grid-cols-3 gap-2">
            {(
              [
                ["Azi", b.w.azi.revenue],
                ["7 zile", b.w.d7.revenue],
                ["30 de zile", b.w.d30.revenue],
              ] as const
            ).map(([label, v]) => (
              <div key={label} className="min-w-0">
                <div className="truncate text-lg font-semibold tabular sm:text-xl">{m(v) ?? "—"}</div>
                <div className="text-[11px] text-text-3">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4">
        <Metric icon={ShoppingBag} label="Comenzi" value={cur.orders == null ? null : count(cur.orders)} cur={noTrend ? null : cur.orders} prev={noTrend ? null : prev.orders} missing={b.notes.revenue} />
        <Metric icon={Users} label="Vizitatori" value={cur.visitors == null ? null : count(cur.visitors)} cur={cur.visitors} prev={prev.visitors} missing={b.notes.visitors} />
        <Metric icon={Megaphone} label="Cheltuit pe reclame" value={m(cur.ads)} cur={cur.ads} prev={prev.ads} lowerIsBetter missing={b.notes.ads} />
        <Metric
          icon={TrendingUp}
          label={cur.profit != null && cur.profit < 0 ? "Pierdere" : "Profit"}
          value={m(cur.profit)}
          cur={noTrend ? null : cur.profit}
          prev={noTrend ? null : prev.profit}
          tone={cur.profit == null ? undefined : cur.profit >= 0 ? "good" : "bad"}
          missing={b.notes.revenue ? "fără încasări nu se poate calcula" : undefined}
        />
      </dl>

      <footer className="mt-auto space-y-2 border-t border-border px-5 py-3">
        <TechDetails issues={b.issues} />
        <Link href={`/dashboard/projects/${b.id}`} className="flex items-center justify-between text-sm font-medium text-accent hover:underline">
          Vezi detalii <ArrowRight size={15} />
        </Link>
      </footer>
    </article>
  );
}
