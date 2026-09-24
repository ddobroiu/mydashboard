import { prisma } from "@/lib/prisma";
import { dayDate } from "@/lib/dates";

export async function getAiCosts(projectIds: string[], since: string, until: string) {
  const where = { projectId: { in: projectIds }, date: { gte: dayDate(since), lte: dayDate(until) } };
  const byModel = await prisma.aiUsageDaily.groupBy({
    by: ["model", "isGeneration"],
    where,
    _sum: { runs: true, failed: true, seconds: true, costUsd: true },
  });
  const models = byModel
    .map((m) => ({
      model: m.model,
      isGeneration: m.isGeneration,
      runs: m._sum.runs ?? 0,
      failed: m._sum.failed ?? 0,
      seconds: m._sum.seconds ?? 0,
      costUsd: Number(m._sum.costUsd ?? 0),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);
  const costUsd = models.reduce((s, m) => s + m.costUsd, 0);
  // O „generare” = o rulare reusita a unui model 3D; costul ei include si pasii ajutatori (imagine, traducere)
  const generations = models.filter((m) => m.isGeneration).reduce((s, m) => s + m.runs, 0);
  const failed = models.reduce((s, m) => s + m.failed, 0);
  return { costUsd, generations, failed, perGeneration: generations > 0 ? costUsd / generations : null, models };
}

export type AiCosts = Awaited<ReturnType<typeof getAiCosts>>;
