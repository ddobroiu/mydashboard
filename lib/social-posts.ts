// Postarile de pe retelele sociale, pe toate afacerile: cele din PostingClips (TikTok, YouTube... prin conexiunea
// POSTINGCLIPS) si cele publicate de _deploy/social-autopost pe Facebook / Instagram (trimise la /api/ingest/social,
// tinute sub o conexiune ascunsa SOCIAL_AUTOPOST pe fiecare afacere). Totul sta in tabela SocialPost.
import { prisma } from "@/lib/prisma";
import { encryptJson } from "@/lib/crypto";
import { addDays, dayDate, dayKey } from "@/lib/dates";

// Contul din social-autopost (cheia din accounts.json) → domeniile afacerii, in ordinea preferintei.
// Primul domeniu care are proiect in mydashboard castiga (ex. tablou.net, daca n-are proiect propriu, intra la Print).
const PRINT = "shopprint.ro";
export const SOCIAL_ACCOUNT_DOMAINS: Record<string, string[]> = {
  shopprint: [PRINT],
  shopprinteu: ["shopprint.eu", PRINT],
  euprint: ["euprint.ro", PRINT],
  homeprint: ["homeprint.ro", PRINT],
  adbanner: ["adbanner.ro", PRINT],
  tablou: ["tablou.net", PRINT],
  bazadate: ["bazadate.ro"],
  beneficiari: ["beneficiari.ro"],
  constelatii: ["constelatii.com"],
  edu3d: ["edu3d.ro"],
  invitonline: ["invitonline.ro"],
  postingclips: ["postingclips.com"],
  tiparementale: ["tiparementale.ro"],
  anuntul: ["anuntul.info"],
  eweb: ["e-web.ro"],
};

const clean = (d: string | null | undefined) =>
  String(d || "").toLowerCase().trim().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

type Proj = { id: string; name: string; domain: string | null };

export function projectForAccount(account: string, projects: Proj[]): Proj | undefined {
  const key = account.toLowerCase();
  for (const dom of SOCIAL_ACCOUNT_DOMAINS[key] ?? []) {
    const p = projects.find((x) => clean(x.domain) === dom) ?? projects.find((x) => x.name.trim().toLowerCase() === dom.split(".")[0]);
    if (p) return p;
  }
  // cont nou, nepus in lista: dupa numele proiectului
  return projects.find((x) => x.name.trim().toLowerCase() === key);
}

export type IncomingPost = {
  externalId: string;
  itemId?: string | null;
  account: string;
  accountName?: string | null;
  platform: string;
  type?: string | null;
  url?: string | null;
  publishedAt: string;
  caption?: string | null;
  stats?: {
    views?: number | null;
    reach?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    fetchedAt?: string | null;
  } | null;
};

const int = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

async function hiddenConnection(projectId: string) {
  const existing = await prisma.connection.findFirst({ where: { projectId, provider: "SOCIAL_AUTOPOST" }, select: { id: true } });
  if (existing) return existing.id;
  const c = await prisma.connection.create({
    data: { projectId, provider: "SOCIAL_AUTOPOST", label: "Postări automate Facebook / Instagram", credentials: encryptJson({}) },
    select: { id: true },
  });
  return c.id;
}

// Salveaza (sau actualizeaza) postarile primite. Cifrele sunt totalul pe viata postarii, deci se rescriu.
export async function ingestSocialPosts(posts: IncomingPost[]) {
  const projects = await prisma.project.findMany({ select: { id: true, name: true, domain: true }, orderBy: { createdAt: "asc" } });
  const conns = new Map<string, string>();
  const unmatched = new Set<string>();
  let saved = 0;
  let skipped = 0;

  for (const p of posts) {
    const externalId = str(p?.externalId, 120);
    const account = str(p?.account, 60);
    const platform = str(p?.platform, 30)?.toLowerCase();
    const publishedAt = p?.publishedAt ? new Date(p.publishedAt) : null;
    if (!externalId || !account || !platform || !publishedAt || isNaN(publishedAt.getTime())) {
      skipped++;
      continue;
    }
    const project = projectForAccount(account, projects);
    if (!project) {
      unmatched.add(account);
      continue;
    }
    let connectionId = conns.get(project.id);
    if (!connectionId) {
      connectionId = await hiddenConnection(project.id);
      conns.set(project.id, connectionId);
    }
    const s = p.stats ?? null;
    const fetchedAt = s?.fetchedAt ? new Date(s.fetchedAt) : null;
    const data = {
      status: "published",
      platform,
      account: str(p.accountName, 120) ?? account,
      campaignName: "Postare automată",
      // acelasi element din coada (acelasi clip) postat pe Facebook si Instagram se aduna ca un singur clip
      videoId: str(p.itemId, 60),
      caption: str(p.caption, 300),
      url: str(p.url, 500),
      error: null,
      scheduledAt: publishedAt,
      publishedAt,
      date: dayDate(dayKey(publishedAt)),
      views: int(s?.views),
      likes: int(s?.likes),
      comments: int(s?.comments),
      shares: int(s?.shares),
      saves: int(s?.saves),
      reach: int(s?.reach),
      metricsAt: fetchedAt && !isNaN(fetchedAt.getTime()) ? fetchedAt : null,
    };
    await prisma.socialPost.upsert({
      where: { connectionId_externalId: { connectionId, externalId } },
      create: { ...data, projectId: project.id, connectionId, externalId },
      update: data,
    });
    saved++;
  }
  return { saved, skipped, unmatched: [...unmatched] };
}

// ─── Citire pentru pagini ──────────────────────────────────────────────────

export const interactionsOf = (p: { likes: number | null; comments: number | null; shares: number | null; saves: number | null }) =>
  (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);

// Pe cardul fiecarei afaceri: cate postari in ultimele 7 zile si cate vizualizari au strans
export async function socialWeek(projectIds: string[]) {
  const today = dayKey(new Date());
  const rows = await prisma.socialPost
    .groupBy({
      by: ["projectId"],
      where: { projectId: { in: projectIds }, status: "published", date: { gte: dayDate(addDays(today, -6)), lte: dayDate(today) } },
      _count: { _all: true },
      _sum: { views: true },
    })
    .catch(() => []);
  return new Map(rows.map((r) => [r.projectId, { posts: r._count._all, views: r._sum.views ?? 0 }]));
}

export type PostRow = {
  id: string;
  projectId: string;
  projectName: string;
  platform: string;
  account: string;
  caption: string | null;
  url: string | null;
  publishedAt: Date;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  interactions: number;
  metricsAt: Date | null;
  source: "automat" | "postingclips";
};

export async function listPosts(projects: { id: string; name: string }[], since: string, until: string): Promise<PostRow[]> {
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const rows = await prisma.socialPost.findMany({
    where: { projectId: { in: projects.map((p) => p.id) }, status: "published", date: { gte: dayDate(since), lte: dayDate(until) } },
    include: { connection: { select: { provider: true } } },
    orderBy: [{ publishedAt: "desc" }, { scheduledAt: "desc" }],
    take: 1000,
  });
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectName: names.get(r.projectId) ?? "",
    platform: r.platform,
    account: r.account,
    caption: r.caption,
    url: r.url,
    publishedAt: r.publishedAt ?? r.scheduledAt,
    views: r.views,
    reach: r.reach,
    likes: r.likes,
    comments: r.comments,
    shares: r.shares,
    saves: r.saves,
    interactions: interactionsOf(r),
    metricsAt: r.metricsAt,
    source: r.connection.provider === "SOCIAL_AUTOPOST" ? "automat" : "postingclips",
  }));
}
