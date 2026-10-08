// GET /api/operator/sales?since=24h: platile aplicatiilor (Stripe / Oblio / comenzi) pe proiect si moneda + ultimele 50.
import { json, operatorDenied, parseSince, salesSince } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  return json(await salesSince(parseSince(new URL(req.url).searchParams.get("since"))));
}
