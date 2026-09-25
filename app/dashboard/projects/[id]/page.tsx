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
import { CostSummary } from "@/components/CostSummary";
import { getAiCosts } from "@/lib/ai-costs";
import { SitesSection } from "@/components/SitesSection";
import { getSites } from "@/lib/sites";
import { NotConnected, ProjectTabs, parseTab } from "@/components/ProjectTabs";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string; tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const days = parseRange(sp.days);
  const tab = parseTab(sp.tab);
  const base = `/dashboard/projects/${id}`;
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
        {tab !== "conexiuni" && <RangeTabs basePath={base} days={days} tab={tab} />}
      </div>
      <ProjectTabs basePath={base} tab={tab} days={days} />

      {tab === "prezentare" && (
        <>
          <CurrencyWarning currencies={m.currencies} currency={project.currency} />
          <KpiTiles m={m} currency={project.currency} />
          <SpendRevenueChart data={m.daily} currency={project.currency} />
          {hasSites && <SitesSection rows={sites} currency={project.currency} />}
        </>
      )}
      {tab === "trafic" && <TrafficSection t={traffic} currency={project.currency} projectId={project.id} />}
      {tab === "reclame" && <CampaignTable campaigns={m.campaigns} currency={project.currency} />}
      {tab === "social" &&
        (hasSocial ? (
          <SocialSection s={social} currency={project.currency} />
        ) : (
          <NotConnected
            title="Clipuri social media"
            text="Leagă proiectul de brandul lui din PostingClips (cheie API din PostingClips → Conturi → Chei API) ca să vezi aici clipurile postate și cum au mers."
            basePath={base}
            days={days}
          />
        ))}
      {tab === "facturi" &&
        (hasInvoices ? (
          <InvoicesSection inv={invoices} projectId={project.id} canEdit={role !== "VIEWER"} />
        ) : (
          <NotConnected
            title="Facturi"
            text="Leagă Oblio cu seria de facturare a proiectului ca să vezi facturile și să le trimiți în SPV."
            basePath={base}
            days={days}
          />
        ))}
      {tab === "costuri" && (
        <>
          <CostSummary
            adSpend={m.spend}
            byProvider={m.byProvider}
            clipAdSpend={social.clipAdSpend}
            aiUsd={hasAi ? ai.costUsd : null}
            revenue={m.revenue}
            currency={project.currency}
          />
          {hasAi && <AiCostSection ai={ai} revenue={m.revenue} currency={project.currency} />}
        </>
      )}
      {tab === "conexiuni" && <ConnectionsPanel projectId={project.id} connections={connections} canEdit={role !== "VIEWER"} />}
    </div>
  );
}
