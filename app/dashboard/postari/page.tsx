import Link from "next/link";
import { Clapperboard, ExternalLink, Eye, Facebook, Globe, Heart, Instagram, Linkedin, Music2, Twitter, Users, Youtube } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { addDays, dayKey, eachDay } from "@/lib/dates";
import { count } from "@/lib/format";
import { listPosts, type PostRow } from "@/lib/social-posts";
import { ago } from "@/lib/overview";
import { Trend } from "@/components/Stat";
import { ViewsChart } from "@/components/ViewsChart";

export const dynamic = "force-dynamic";

// Toate postarile de pe retelele sociale, pe toate afacerile: cand au iesit, unde, cate vizualizari si interactiuni.
// Cifrele vin de la social-autopost (Facebook / Instagram, la cateva ore) si din PostingClips (TikTok, YouTube...).

const NET: Record<string, { name: string; Icon: typeof Globe; cls: string }> = {
  facebook: { name: "Facebook", Icon: Facebook, cls: "bg-[#1877f2] text-white" },
  instagram: { name: "Instagram", Icon: Instagram, cls: "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white" },
  tiktok: { name: "TikTok", Icon: Music2, cls: "bg-black text-white" },
  youtube: { name: "YouTube", Icon: Youtube, cls: "bg-[#ff0000] text-white" },
  linkedin: { name: "LinkedIn", Icon: Linkedin, cls: "bg-[#0a66c2] text-white" },
  twitter: { name: "X", Icon: Twitter, cls: "bg-black text-white" },
};
const net = (p: string) => NET[p] ?? { name: p.charAt(0).toUpperCase() + p.slice(1), Icon: Globe, cls: "bg-text-3 text-white" };

const PERIODS = { "7": 7, "30": 30, "90": 90 } as const;
type Period = keyof typeof PERIODS;

const fmtDate = (d: Date) =>
  d.toLocaleString("ro-RO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" });

function median(v: number[]) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function totals(rows: PostRow[]) {
  return {
    posts: rows.length,
    views: rows.reduce((s, r) => s + (r.views ?? 0), 0),
    interactions: rows.reduce((s, r) => s + r.interactions, 0),
    reach: rows.reduce((s, r) => s + (r.reach ?? 0), 0),
  };
}

// Cum sta postarea fata de una obisnuita din perioada (mediana vizualizarilor)
function Versus({ views, med }: { views: number | null; med: number }) {
  if (views == null || med < 20) return null;
  const x = views / med;
  if (x >= 2) return <span className="rounded-full bg-good-bg px-2 py-0.5 text-[11px] font-semibold text-good">de {x >= 10 ? "10+" : x.toLocaleString("ro-RO", { maximumFractionDigits: 1 })}× peste obișnuit</span>;
  if (x <= 0.5) return <span className="rounded-full bg-warn-bg px-2 py-0.5 text-[11px] font-medium text-warn">sub obișnuit</span>;
  return null;
}

function Tile({ icon: Icon, label, value, cur, prev, sub }: { icon: typeof Eye; label: string; value: string; cur: number; prev: number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-sm text-text-2">
        <span className="grid size-7 place-items-center rounded-lg bg-bg text-text-2">
          <Icon size={15} aria-hidden />
        </span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-text-3">
        <Trend cur={cur} prev={prev} label="față de perioada dinainte" />
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

export default async function PostariPage({ searchParams }: { searchParams: Promise<{ p?: string; a?: string }> }) {
  const userId = await requireUser();
  const sp = await searchParams;
  const period: Period = sp.p === "7" || sp.p === "90" ? sp.p : "30";
  const days = PERIODS[period];
  const all = await projectsForUser(userId);
  const chosen = all.find((p) => p.id === sp.a);
  const projects = chosen ? [chosen] : all;

  const until = dayKey(new Date());
  const since = addDays(until, -(days - 1));
  const [rows, prevRows, everyRows] = await Promise.all([
    listPosts(projects, since, until),
    listPosts(projects, addDays(since, -days), addDays(since, -1)),
    // afacerile care au postari (pentru butoanele de filtrare), pe 90 de zile
    chosen ? Promise.resolve(null) : listPosts(all, addDays(until, -89), until),
  ]);
  const cur = totals(rows);
  const prev = totals(prevRows);
  const withViews = rows.filter((r) => r.views != null).map((r) => r.views as number);
  const med = median(withViews);
  const daily = eachDay(since, until).map((date) => {
    const day = rows.filter((r) => dayKey(r.publishedAt) === date);
    return { date, posts: day.length, views: day.reduce((s, r) => s + (r.views ?? 0), 0) };
  });
  const lastUpdate = rows.reduce<Date | null>((m, r) => (r.metricsAt && (!m || r.metricsAt > m) ? r.metricsAt : m), null);
  const active = everyRows ? all.filter((p) => everyRows.some((r) => r.projectId === p.id)) : [];

  const href = (p: Period, a?: string) => {
    const q = new URLSearchParams();
    if (p !== "30") q.set("p", p);
    if (a) q.set("a", a);
    const s = q.toString();
    return `/dashboard/postari${s ? `?${s}` : ""}`;
  };
  const chip = (on: boolean) => `rounded-lg px-3 py-1.5 font-medium ${on ? "bg-accent text-white" : "text-text-2 hover:text-text"}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Postări{chosen ? ` · ${chosen.name}` : ""}</h1>
          <p className="mt-1 text-sm text-text-2">
            Ce am postat pe Facebook, Instagram, TikTok și celelalte rețele, și câți oameni au văzut.
            {lastUpdate && <span className="text-text-3"> Cifre actualizate {ago(lastUpdate)}.</span>}
          </p>
        </div>
        <nav className="inline-flex rounded-xl border border-border bg-surface p-1 text-sm" aria-label="Perioada">
          {(Object.keys(PERIODS) as Period[]).map((v) => (
            <Link key={v} href={href(v, chosen?.id)} className={chip(period === v)} aria-current={period === v ? "page" : undefined}>
              {v} zile
            </Link>
          ))}
        </nav>
      </header>

      {(chosen || active.length > 1) && (
        <nav className="flex flex-wrap gap-2 text-sm" aria-label="Afacerea">
          <Link href={href(period)} className={`rounded-full border border-border px-3 py-1 ${!chosen ? "bg-text text-surface" : "bg-surface text-text-2 hover:text-text"}`}>
            Toate afacerile
          </Link>
          {(chosen ? [chosen] : active).map((p) => (
            <Link
              key={p.id}
              href={href(period, p.id)}
              className={`rounded-full border border-border px-3 py-1 ${chosen?.id === p.id ? "bg-text text-surface" : "bg-surface text-text-2 hover:text-text"}`}
            >
              {p.name}
            </Link>
          ))}
        </nav>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Pe scurt">
        <Tile icon={Clapperboard} label="Postări" value={count(cur.posts)} cur={cur.posts} prev={prev.posts} />
        <Tile icon={Eye} label="Vizualizări" value={count(cur.views)} cur={cur.views} prev={prev.views} sub={cur.posts ? `în medie ${count(cur.views / cur.posts)} / postare` : undefined} />
        <Tile icon={Heart} label="Interacțiuni" value={count(cur.interactions)} cur={cur.interactions} prev={prev.interactions} sub="aprecieri, comentarii, distribuiri, salvări" />
        <Tile icon={Users} label="Oameni atinși" value={count(cur.reach)} cur={cur.reach} prev={prev.reach} />
      </section>

      {rows.length === 0 ? (
        <div className="card space-y-2 p-8 text-center">
          <h2 className="text-lg font-semibold">Nicio postare în ultimele {days} zile</h2>
          <p className="text-sm text-text-2">
            Postările apar aici singure: cele de pe Facebook și Instagram după ce sunt publicate din coada de postări automate, cele din
            TikTok / YouTube din PostingClips.
          </p>
        </div>
      ) : (
        <>
          <section className="card p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">Vizualizări pe ziua postării</h2>
              <p className="text-xs text-text-3">Vizualizările mai cresc câteva zile după postare, așa că zilele recente par mai mici.</p>
            </div>
            <ViewsChart data={daily} />
          </section>

          <section className="card divide-y divide-border" aria-label="Lista postărilor">
            <h2 className="px-4 py-3 text-sm font-semibold">
              {rows.length === 1 ? "O postare" : `${count(rows.length)} postări`} · cele mai noi primele
            </h2>
            {rows.map((r) => {
              const n = net(r.platform);
              const detail = [
                r.likes != null && `${count(r.likes)} aprecieri`,
                r.comments != null && `${count(r.comments)} comentarii`,
                r.shares != null && `${count(r.shares)} distribuiri`,
                r.saves != null && `${count(r.saves)} salvări`,
              ].filter(Boolean).join(" · ");
              return (
                <article key={r.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${n.cls}`} title={n.name}>
                      <n.Icon size={17} aria-hidden />
                      <span className="sr-only">{n.name}</span>
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-3">
                        <span className="font-medium text-text">{r.projectName}</span>
                        <span>{n.name} · {r.account}</span>
                        <span>{fmtDate(r.publishedAt)}</span>
                        {r.source === "automat" && <span className="rounded bg-bg px-1.5 py-0.5">automat</span>}
                        <Versus views={r.views} med={med} />
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-sm">{r.caption || "(fără text)"}</p>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          Deschide postarea <ExternalLink size={11} aria-hidden />
                        </a>
                      )}
                    </div>
                  </div>
                  <dl className="grid shrink-0 grid-cols-3 gap-4 pl-12 text-right tabular sm:w-80 sm:pl-0">
                    <div>
                      <dt className="text-[11px] text-text-3">Vizualizări</dt>
                      <dd className="text-lg font-semibold">{r.views == null ? "—" : count(r.views)}</dd>
                    </div>
                    <div title={detail || undefined}>
                      <dt className="text-[11px] text-text-3">Interacțiuni</dt>
                      <dd className="text-lg font-semibold">{r.metricsAt || r.views != null ? count(r.interactions) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] text-text-3">Oameni</dt>
                      <dd className="text-lg font-semibold">{r.reach == null ? "—" : count(r.reach)}</dd>
                    </div>
                    {detail && <dd className="col-span-3 -mt-2 text-[11px] text-text-3">{detail}</dd>}
                  </dl>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
