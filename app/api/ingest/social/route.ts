import { NextResponse } from "next/server";
import { operatorDenied } from "@/lib/operator";
import { ingestSocialPosts, type IncomingPost } from "@/lib/social-posts";

export const dynamic = "force-dynamic";

const MAX_POSTS = 2000;

// Primeste postarile publicate de _deploy/social-autopost (`node post.mjs --stats --report-to-dashboard`)
// cu vizualizarile si interactiunile lor. Protejat cu  Authorization: Bearer <OPERATOR_TOKEN>.
// Fiecare postare se potriveste cu afacerea ei dupa cont (lib/social-posts.ts) si se rescrie (upsert).
export async function POST(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const posts = body?.posts;
  if (!Array.isArray(posts) || posts.length > MAX_POSTS) return NextResponse.json({ error: "date invalide" }, { status: 400 });
  try {
    const r = await ingestSocialPosts(posts as IncomingPost[]);
    return NextResponse.json({ ok: true, ...r }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // migrarea 2026-10-09_social_autopost.sql neaplicata: enumul Provider nu are inca SOCIAL_AUTOPOST
    if (/SOCIAL_AUTOPOST|invalid input value for enum/i.test(String((e as Error)?.message))) {
      return NextResponse.json({ error: "mydashboard: migrarea pentru postările automate nu e aplicată încă" }, { status: 503 });
    }
    throw e;
  }
}
