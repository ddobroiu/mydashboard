import { ExternalLink } from "lucide-react";
import type { SocialGroup, SocialMetrics } from "@/lib/social";
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

          <div className="card p-4">
            <h2 className="font-medium mb-3">Cele mai văzute clipuri</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm tabular">
                <thead className="text-text-3 text-left">
                  <tr>
                    <th className="py-2 font-normal">Clip</th>
                    <th className="py-2 pl-4 font-normal">Publicat</th>
                    <th className="py-2 pl-4 font-normal text-right">Vizualizări</th>
                    <th className="py-2 pl-4 font-normal text-right">Aprecieri</th>
                    <th className="py-2 pl-4 font-normal text-right">Comentarii</th>
                    <th className="py-2 pl-4 font-normal text-right">Distribuiri</th>
                  </tr>
                </thead>
                <tbody>
                  {s.top.map((p) => (
                    <tr key={p.id} className="border-t border-border align-top">
                      <td className="py-2 pr-4">
                        <div className="font-medium line-clamp-2">{p.caption || p.campaignName}</div>
                        <div className="text-xs text-text-3">
                          {platformName(p.platform)} · {p.account} · {p.campaignName}
                          {p.url && (
                            <a
                              href={p.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 inline-flex items-center gap-0.5 text-accent"
                            >
                              deschide <ExternalLink size={11} />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pl-4 whitespace-nowrap">{fmtDay(p.date)}</td>
                      <td className="py-2 pl-4 text-right">{fmt(p.views)}</td>
                      <td className="py-2 pl-4 text-right">{fmt(p.likes)}</td>
                      <td className="py-2 pl-4 text-right">{fmt(p.comments)}</td>
                      <td className="py-2 pl-4 text-right">{fmt(p.shares)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
