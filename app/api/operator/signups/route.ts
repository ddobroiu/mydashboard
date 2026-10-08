// GET /api/operator/signups?since=24h: conturile noi raportate de fiecare aplicatie (/api/mydashboard/stats) +
// activitatea recenta (conturi, comenzi). Fereastra: ≤ 24 h → ultimele 24 h, ≤ 7 zile → 7 zile, altfel 30 de zile.
import { json, operatorDenied, parseSince, signupsSince } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  return json(await signupsSince(parseSince(new URL(req.url).searchParams.get("since"))));
}
