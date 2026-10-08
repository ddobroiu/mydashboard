import { Mic } from "lucide-react";
import type { VoiceStatus } from "@/lib/elevenlabs";
import { count, money } from "@/lib/format";

const resetDay = (d: Date | null) => (d ? new Date(d).toLocaleDateString("ro-RO", { day: "numeric", month: "long", timeZone: "Europe/Bucharest" }) : null);

// „Voce (ElevenLabs)” pe cardul PostingClips: caracterele folosite luna asta, bara de consum si data resetarii
export function VoiceRow({ v }: { v: VoiceStatus }) {
  const plan = v.monthlyUsd > 0 ? `abonament ${money(v.monthlyUsd, "USD")}/lună, inclus la costuri AI și în profit` : null;
  if (!v.ok) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs text-text-3">
          <Mic size={13} aria-hidden /> Voce (ElevenLabs)
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-xl font-semibold text-text-3">—</span>
          <span className="text-[11px] leading-snug text-text-3">{v.reason}</span>
        </div>
        {plan && <p className="text-[11px] text-text-3">{plan}</p>}
      </div>
    );
  }
  const pct = Math.min(100, Math.max(0, v.pct));
  const tone = v.pct >= 95 ? "bg-bad" : v.pct >= 80 ? "bg-warn" : "bg-good";
  const reset = resetDay(v.resetAt);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs text-text-3">
        <span className="flex items-center gap-1.5">
          <Mic size={13} aria-hidden /> Voce (ElevenLabs) · {v.tier}
        </span>
        <span className={`font-semibold tabular ${v.pct >= 95 ? "text-bad" : v.pct >= 80 ? "text-warn" : "text-text-2"}`}>{Math.floor(v.pct)}%</span>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg"
        role="progressbar"
        aria-label="Caractere ElevenLabs folosite luna asta"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-text-3">
        consum: {count(v.used)} / {count(v.limit)} caractere luna asta ({Math.floor(v.pct)}%){reset ? ` · se resetează pe ${reset}` : ""}
      </p>
      {plan && <p className="text-[11px] text-text-3">{plan}</p>}
    </div>
  );
}
