import type { SocialPostRow } from "./types";

// Cheia API se creeaza in PostingClips → Conturi → Chei API (doar citire).
export type PostingClipsCredentials = { apiKey: string };

const BASE = (process.env.POSTINGCLIPS_URL || "https://postingclips.com").replace(/\/+$/, "");

type ApiPost = {
  id: string;
  status: string;
  scheduledAt: string;
  publishedAt: string | null;
  platform: string;
  account: string;
  campaignName: string;
  caption: string | null;
  url: string | null;
  error: string | null;
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    reach: number | null;
    updatedAt: string | null;
  };
};

async function api<T>(c: PostingClipsCredentials, path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { authorization: `Bearer ${c.apiKey}` },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PostingClips: ${body.error ?? res.statusText}`);
  return body as T;
}

export async function testPostingClips(c: PostingClipsCredentials) {
  return api<{ email: string | null; brand: { id: string; name: string } | null }>(c, "/api/v1/me");
}

// Postarile programate de la `since` incoace, inclusiv cele viitoare.
export async function fetchPostingClipsPosts(c: PostingClipsCredentials, since: string): Promise<SocialPostRow[]> {
  const body = await api<{ posts: ApiPost[] }>(c, `/api/v1/posts?since=${since}`);
  return body.posts.map((p) => ({
    externalId: p.id,
    status: p.status,
    platform: p.platform,
    account: p.account,
    campaignName: p.campaignName,
    caption: p.caption,
    url: p.url,
    error: p.error,
    scheduledAt: new Date(p.scheduledAt),
    publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
    views: p.metrics.views,
    likes: p.metrics.likes,
    comments: p.metrics.comments,
    shares: p.metrics.shares,
    saves: p.metrics.saves,
    reach: p.metrics.reach,
    metricsAt: p.metrics.updatedAt ? new Date(p.metrics.updatedAt) : null,
  }));
}
