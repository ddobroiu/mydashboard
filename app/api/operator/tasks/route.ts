// GET /api/operator/tasks: lista „De facut” (alerte, clienti fara raspuns > 24 h, casute care nu se pot citi).
import { json, operatorDenied } from "@/lib/operator";
import { getTasks } from "@/lib/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const denied = operatorDenied(req);
  if (denied) return denied;
  const { tasks, emailReady } = await getTasks();
  return json({ count: tasks.length, tasks, emailReady });
}
