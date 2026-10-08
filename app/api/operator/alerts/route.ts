// GET /api/operator/alerts: alertele active ale aplicatiilor, explicate (gravitate, ce s-a intamplat, ce trebuie facut).
import { alertsView, json, operatorDenied } from "@/lib/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const alerts = await alertsView();
  return json({ count: alerts.length, alerts });
}
