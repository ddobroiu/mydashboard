// GET /api/operator/summary?since=24h  (robotul-operator, doar citire; Authorization: Bearer OPERATOR_TOKEN)
// Pe aplicatie: conturi noi, vanzari, e-mailuri necitite / posibili clienti / fara raspuns, alerte, erori AI + „De facut”.
import { json, operatorDenied, parseSince, summary } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const since = parseSince(new URL(req.url).searchParams.get("since"));
  try {
    return json(await summary(since));
  } catch (e) {
    console.error("[operator/summary]", (e as Error)?.message);
    return json({ error: "Rezumatul nu s-a putut calcula." }, 500);
  }
}
