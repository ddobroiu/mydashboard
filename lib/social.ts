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

export type TopPost = {
  id: string;
  platform: string;
  account: string;
  campaignName: string;
  caption: string | null;
  url: string | null;
  date: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
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
  top: TopPost[];
};

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

  return {
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
    top: [...posts]
      .sort((a, b) => num(b.views) - num(a.views) || num(b.likes) - num(a.likes))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        platform: p.platform,
        account: p.account,
        campaignName: p.campaignName,
        caption: p.caption,
        url: p.url,
        date: p.date.toISOString().slice(0, 10),
        views: p.views,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
      })),
  };
}
