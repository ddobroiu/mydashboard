import { prisma } from "@/lib/prisma";
import { dayDate, eachDay } from "@/lib/dates";

export type SocialDaily = { date: string; posts: number; views: number };

export type SocialGroup = {
  key: string;
  posts: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
};

// Un clip adunat pe toate platformele pe care a fost postat
export type ClipStat = {
  key: string;
  campaignName: string;
  caption: string | null;
  videoUrl: string | null;
  firstDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  // (aprecieri + comentarii + distribuiri) / vizualizari, in procente
  engagement: number | null;
  posts: { platform: string; account: string; url: string | null; views: number | null }[];
  // Cheltuit pe reclame cu acest clip in perioada (moneda contului de reclame)
  adSpend: number;
  // Cost la 1000 de vizualizari (organice + din reclama), cand s-a cheltuit ceva
  costPer1000: number | null;
  // A prins: peste dublul mediei clipurilor din perioada (vezi WINNER_*)
  winner: boolean;
};

export type SocialMetrics = {
  published: number;
  failed: number;
  // Programate pentru viitor (nu depind de perioada aleasa)
  upcoming: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  // Postari publicate care au deja cifre (unele platforme nu dau statistici)
  withMetrics: number;
  daily: SocialDaily[];
  byPlatform: SocialGroup[];
  byCampaign: SocialGroup[];
  clips: ClipStat[];
  // Media vizualizarilor pe clip (clipurile cu cifre), pragul pentru „Câștigător”
  clipMedianViews: number;
  // Tot ce s-a cheltuit pe reclame cu clipuri in perioada
  clipAdSpend: number;
};

// Un clip e „Câștigător” cand are cel putin de 2 ori media (mediana) clipurilor
// din perioada si macar 300 de vizualizari; cu mai putin de 3 clipuri nu comparam.
const WINNER_FACTOR = 2;
const WINNER_MIN_VIEWS = 300;
const WINNER_MIN_CLIPS = 3;

type PostForClip = {
  id: string;
  videoId: string | null;
  videoUrl: string | null;
  campaignName: string;
  caption: string | null;
  platform: string;
  account: string;
  url: string | null;
  date: Date;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function aggregateClips(posts: PostForClip[]): { clips: ClipStat[]; median: number } {
  const map = new Map<string, ClipStat & { hasMetrics: boolean }>();
  for (const p of posts) {
    const key = p.videoId ?? p.id;
    const date = p.date.toISOString().slice(0, 10);
    const c = map.get(key) ?? {
      key,
      campaignName: p.campaignName,
      caption: p.caption,
      videoUrl: p.videoUrl,
      firstDate: date,
      views: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      engagement: null,
      posts: [],
      adSpend: 0,
      costPer1000: null,
      winner: false,
      hasMetrics: false,
    };
    c.views += num(p.views);
    c.likes += num(p.likes);
    c.comments += num(p.comments);
    c.shares += num(p.shares);
    c.hasMetrics ||= p.views !== null;
    c.caption ??= p.caption;
    c.videoUrl ??= p.videoUrl;
    if (date < c.firstDate) c.firstDate = date;
    c.posts.push({ platform: p.platform, account: p.account, url: p.url, views: p.views });
    map.set(key, c);
  }

  const all = [...map.values()];
  const measured = all.filter((c) => c.hasMetrics);
  const med = median(measured.map((c) => c.views));
  const clips = all
    .map(({ hasMetrics, ...c }) => ({
      ...c,
      engagement: c.views > 0 ? Math.round(((c.likes + c.comments + c.shares) / c.views) * 1000) / 10 : null,
      winner:
        hasMetrics &&
        measured.length >= WINNER_MIN_CLIPS &&
        c.views >= WINNER_MIN_VIEWS &&
        c.views >= med * WINNER_FACTOR,
      posts: c.posts.sort((a, b) => num(b.views) - num(a.views)),
    }))
    .sort((a, b) => b.views - a.views || b.likes - a.likes);
  return { clips, median: med };
}

const num = (v: number | null | undefined) => v ?? 0;

function group(rows: { key: string; views: number | null; likes: number | null; comments: number | null; shares: number | null }[]) {
  const map = new Map<string, SocialGroup>();
  for (const r of rows) {
    const g = map.get(r.key) ?? { key: r.key, posts: 0, views: 0, likes: 0, comments: 0, shares: 0 };
    g.posts += 1;
    g.views += num(r.views);
    g.likes += num(r.likes);
    g.comments += num(r.comments);
    g.shares += num(r.shares);
    map.set(r.key, g);
  }
  return [...map.values()].sort((a, b) => b.views - a.views || b.posts - a.posts);
}

export async function getSocialMetrics(projectIds: string[], since: string, until: string): Promise<SocialMetrics> {
  const where = { projectId: { in: projectIds }, date: { gte: dayDate(since), lte: dayDate(until) } };

  const [posts, failed, upcoming] = await Promise.all([
    prisma.socialPost.findMany({ where: { ...where, status: "published" } }),
    prisma.socialPost.count({ where: { ...where, status: "failed" } }),
    prisma.socialPost.count({
      where: { projectId: { in: projectIds }, status: "scheduled", scheduledAt: { gt: new Date() } },
    }),
  ]);

  const byDay = new Map<string, SocialDaily>();
  for (const p of posts) {
    const date = p.date.toISOString().slice(0, 10);
    const d = byDay.get(date) ?? { date, posts: 0, views: 0 };
    d.posts += 1;
    d.views += num(p.views);
    byDay.set(date, d);
  }

  const { clips, median: clipMedianViews } = aggregateClips(posts);

  // Reclamele pe clipuri (campaniile cu „clip:<id>”), adunate pe clip
  const spendRows = await prisma.adSpendDaily.groupBy({
    by: ["clipId"],
    where: { ...where, clipId: { not: null } },
    _sum: { spend: true },
  });
  const spendByClip = new Map(spendRows.map((r) => [r.clipId!, Number(r._sum.spend ?? 0)]));
  for (const c of clips) {
    c.adSpend = spendByClip.get(c.key) ?? 0;
    c.costPer1000 = c.adSpend > 0 && c.views > 0 ? (c.adSpend / c.views) * 1000 : null;
  }
  const clipAdSpend = [...spendByClip.values()].reduce((s, v) => s + v, 0);

  return {
    // Clipurile promovate raman in lista chiar daca nu sunt printre cele mai vazute
    clips: clips.filter((c, i) => i < 20 || c.adSpend > 0),
    clipMedianViews,
    clipAdSpend,
    published: posts.length,
    failed,
    upcoming,
    views: posts.reduce((s, p) => s + num(p.views), 0),
    likes: posts.reduce((s, p) => s + num(p.likes), 0),
    comments: posts.reduce((s, p) => s + num(p.comments), 0),
    shares: posts.reduce((s, p) => s + num(p.shares), 0),
    withMetrics: posts.filter((p) => p.views !== null || p.likes !== null).length,
    daily: eachDay(since, until).map((date) => byDay.get(date) ?? { date, posts: 0, views: 0 }),
    byPlatform: group(posts.map((p) => ({ ...p, key: p.platform }))),
    byCampaign: group(posts.map((p) => ({ ...p, key: p.campaignName }))),
  };
}
