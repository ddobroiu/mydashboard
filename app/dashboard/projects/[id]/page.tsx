import { requireProject } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/dates";
import { KpiTiles, CurrencyWarning } from "@/components/KpiTiles";
import { SpendRevenueChart } from "@/components/SpendRevenueChart";
import { CampaignTable } from "@/components/CampaignTable";
import { ConnectionsPanel } from "@/components/ConnectionsPanel";
import { RangeTabs, parseRange } from "@/components/RangeTabs";
import { SocialSection } from "@/components/SocialSection";
import { getSocialMetrics } from "@/lib/social";
import { TrafficSection } from "@/components/TrafficSection";
import { getTraffic } from "@/lib/tracking/report";
import { InvoicesSection } from "@/components/InvoicesSection";
import { getInvoices } from "@/lib/invoices";
import { AiCostSection } from "@/components/AiCostSection";
import { getAiCosts } from "@/lib/ai-costs";
import { SitesSection } from "@/components/SitesSection";
import { getSites } from "@/lib/sites";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { id } = await params;
  const days = parseRange((await searchParams).days);
  const { project, role } = await requireProject(id);
  const { since, until } = lastNDays(days);

  const [m, social, traffic, invoices, ai, sites, connections] = await Promise.all([
    getMetrics([project.id], since, until),
    getSocialMetrics([project.id], since, until),
    getTraffic([project.id], since, until),
    getInvoices([project.id], since, until),
    getAiCosts([project.id], since, until),
    getSites([project.id], since, until),
    prisma.connection.findMany({
      where: { projectId: project.id, provider: { not: "MANUAL" } },
      select: { id: true, provider: true, label: true, externalId: true, status: true, lastSyncAt: true, lastError: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const hasSocial = connections.some((c) => c.provider === "POSTINGCLIPS");
  const hasInvoices = connections.some((c) => c.provider === "OBLIO");
  const hasAi = connections.some((c) => c.provider === "REPLICATE");
  // Doar la proiectele cu mai multe site-uri (ex. grupul print)
  const hasSites = sites.filter((r) => r.site).length > 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.domain && <p className="text-sm text-text-3">{project.domain}</p>}
        </div>
        <RangeTabs basePath={`/dashboard/projects/${project.id}`} days={days} />
      </div>
      <CurrencyWarning currencies={m.currencies} currency={project.currency} />
      <KpiTiles m={m} currency={project.currency} />
      <SpendRevenueChart data={m.daily} currency={project.currency} />
      {hasSites && <SitesSection rows={sites} currency={project.currency} />}
      <TrafficSection t={traffic} currency={project.currency} projectId={project.id} />
      <CampaignTable campaigns={m.campaigns} currency={project.currency} />
      {hasSocial && <SocialSection s={social} />}
      {hasAi && <AiCostSection ai={ai} revenue={m.revenue} currency={project.currency} />}
      {hasInvoices && <InvoicesSection inv={invoices} />}
      <ConnectionsPanel projectId={project.id} connections={connections} canEdit={role !== "VIEWER"} />
    </div>
  );
}
