import { ExternalLink } from "lucide-react";
import type { ClipStat, SocialGroup, SocialMetrics } from "@/lib/social";
import { Tile } from "./KpiTiles";
import { ViewsChart } from "./ViewsChart";

const PLATFORMS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  twitter: "X",
  linkedin: "LinkedIn",
  threads: "Threads",
  snapchat: "Snapchat",
  bluesky: "Bluesky",
};

const platformName = (p: string) => PLATFORMS[p] ?? p;
const fmt = (v: number | null) => (v === null ? "–" : v.toLocaleString("ro-RO"));
const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("ro-RO", { day: "numeric", month: "short", timeZone: "UTC" });

function GroupTable({ title, rows, label }: { title: string; rows: SocialGroup[]; label: (k: string) => string }) {
  return (
    <div className="card p-4">
      <h2 className="font-medium mb-3">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular whitespace-nowrap">
          <thead className="text-text-3 text-left">
            <tr>
              <th className="py-2 font-normal"></th>
              <th className="py-2 pl-4 font-normal text-right">Clipuri</th>
              <th className="py-2 pl-4 font-normal text-right">Vizualizări</th>
              <th className="py-2 pl-4 font-normal text-right">Medie / clip</th>
              <th className="py-2 pl-4 font-normal text-right">Aprecieri</th>
              <th className="py-2 pl-4 font-normal text-right">Comentarii</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <td className="py-2 pr-4 whitespace-normal font-medium">{label(r.key)}</td>
                <td className="py-2 pl-4 text-right">{r.posts}</td>
                <td className="py-2 pl-4 text-right">{fmt(r.views)}</td>
                <td className="py-2 pl-4 text-right">{fmt(Math.round(r.views / r.posts))}</td>
                <td className="py-2 pl-4 text-right">{fmt(r.likes)}</td>
                <td className="py-2 pl-4 text-right">{fmt(r.comments)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Ce clip a prins: fiecare clip adunat pe toate platformele, cu eticheta „Câștigător”
function ClipsTable({ clips, median }: { clips: ClipStat[]; median: number }) {
  const winners = clips.filter((c) => c.winner).length;
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Ce clip a prins</h2>
        <p className="text-xs text-text-3">
          {winners > 0
            ? `${winners} ${winners === 1 ? "clip câștigător" : "clipuri câștigătoare"} · `
            : ""}
          Câștigător = cel puțin dublul unui clip obișnuit ({fmt(median)} vizualizări) și minimum 300
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm tabular">
          <thead className="text-text-3 text-left">
            <tr>
              <th className="py-2 font-normal">Clip</th>
              <th className="py-2 pl-4 font-normal">Postat pe</th>
              <th className="py-2 pl-4 font-normal text-right">Vizualizări</th>
              <th className="py-2 pl-4 font-normal text-right">Aprecieri</th>
              <th className="py-2 pl-4 font-normal text-right">Comentarii</th>
              <th className="py-2 pl-4 font-normal text-right">Interacțiune</th>
            </tr>
          </thead>
          <tbody>
            {clips.map((c) => (
              <tr key={c.key} className="border-t border-border align-top">
                <td className="py-2 pr-4">
                  <div className="flex items-start gap-2">
                    {c.winner && (
                      <span className="mt-0.5 shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[11px] font-medium text-accent">
                        Câștigător
                      </span>
                    )}
                    <div className="font-medium line-clamp-2">{c.caption || c.campaignName}</div>
                  </div>
                  <div className="text-xs text-text-3">
                    {c.campaignName} · {fmtDay(c.firstDate)}
                    {c.videoUrl && (
                      <a href={c.videoUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-0.5 text-accent">
                        vezi clipul <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </td>
                <td className="py-2 pl-4 text-xs">
                  {c.posts.map((p, i) => (
                    <div key={i} className="whitespace-nowrap">
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-accent">
                          {platformName(p.platform)}
                        </a>
                      ) : (
                        platformName(p.platform)
                      )}
                      <span className="text-text-3"> {fmt(p.views)}</span>
                    </div>
                  ))}
                </td>
                <td className="py-2 pl-4 text-right font-medium">{fmt(c.views)}</td>
                <td className="py-2 pl-4 text-right">{fmt(c.likes)}</td>
                <td className="py-2 pl-4 text-right">{fmt(c.comments)}</td>
                <td className="py-2 pl-4 text-right">{c.engagement === null ? "–" : `${c.engagement.toLocaleString("ro-RO")}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SocialSection({ s }: { s: SocialMetrics }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Clipuri social media</h2>
        <p className="text-xs text-text-3">
          Din PostingClips. Cifrele sunt cele raportate de platforme, cumulate de la publicare; Threads, Snapchat și
          Bluesky nu dau statistici.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Tile
          label="Clipuri publicate"
          value={fmt(s.published)}
          sub={s.failed > 0 ? `${s.failed} eșuate` : "niciuna eșuată"}
          tone={s.failed > 0 ? "bad" : undefined}
        />
        <Tile label="Programate" value={fmt(s.upcoming)} sub="urmează să apară" />
        <Tile
          label="Vizualizări"
          value={fmt(s.views)}
          sub={s.withMetrics > 0 ? `${fmt(Math.round(s.views / s.withMetrics))} în medie pe clip` : "încă fără cifre"}
        />
        <Tile label="Aprecieri" value={fmt(s.likes)} />
        <Tile label="Comentarii" value={fmt(s.comments)} sub={`${fmt(s.shares)} distribuiri`} />
      </div>

      {s.published === 0 ? (
        <div className="card p-6 text-center text-sm text-text-2">
          Niciun clip publicat în perioada aleasă.
        </div>
      ) : (
        <>
          <ViewsChart data={s.daily} />
          <div className="grid lg:grid-cols-2 gap-3">
            <GroupTable title="Pe platformă" rows={s.byPlatform} label={platformName} />
            <GroupTable title="Pe campanie" rows={s.byCampaign} label={(k) => k} />
          </div>

          <ClipsTable clips={s.clips} median={s.clipMedianViews} />
        </>
      )}
    </section>
  );
}
