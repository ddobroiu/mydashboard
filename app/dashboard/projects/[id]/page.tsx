import { Suspense } from "react";
import { requireProject } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { AppStatsSection } from "@/components/AppStatsSection";
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
import { getApiAiCosts } from "@/lib/ai-api-costs";
import { ApiAiCostSection } from "@/components/ApiAiCostSection";
import { AiLinksPanel } from "@/components/AiLinksPanel";
import { SitesSection } from "@/components/SitesSection";
import { getSites } from "@/lib/sites";
import { NotConnected, ProjectTabs, parseTab } from "@/components/ProjectTabs";
import { GoogleSection, parseChartDays } from "@/components/GoogleSection";
import { getGoogleReport } from "@/lib/gsc-report";
import { MoneySection } from "@/components/MoneySection";
import { getMoney, parseMoneyView } from "@/lib/money";
import { SourcesMoney } from "@/components/SourcesMoney";
import { ClaritySection } from "@/components/ClaritySection";
import { getClarity } from "@/lib/clarity";
import { getOverview } from "@/lib/overview";
import { BusinessDetail } from "@/components/BusinessDetail";
import { CostInvoicesSection } from "@/components/CostInvoicesSection";
import { getCostInvoices } from "@/lib/cost-invoices";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string; tab?: string; g?: string; m?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const days = parseRange(sp.days);
  const tab = parseTab(sp.tab);
  const base = `/dashboard/projects/${id}`;
  const { project, role } = await requireProject(id);
  const { since, until } = lastNDays(days);

  const ids = [project.id];
  const on = <T,>(when: boolean, f: () => Promise<T>) => (when ? f() : Promise.resolve(null));
  const chartDays = parseChartDays(sp.g);
  const moneyView = parseMoneyView(sp.m);

  // Fiecare tab citeste doar ce afiseaza
  const [m, social, traffic, invoices, ai, sites, google, money, orgSize, connections, clarity, apiAi, costInvoices] = await Promise.all([
    on(tab === "prezentare" || tab === "reclame" || tab === "bani", () => getMetrics(ids, since, until)),
    on(tab === "social" || tab === "bani", () => getSocialMetrics(ids, since, until)),
    on(tab === "prezentare" || tab === "trafic", () => getTraffic(ids, since, until)),
    on(tab === "facturi", () => getInvoices(ids, since, until)),
    on(tab === "bani", () => getAiCosts(ids, since, until)),
    on(tab === "prezentare", () => getSites(ids, since, until)),
    on(tab === "google", () => getGoogleReport(project.id, chartDays)),
    on(tab === "bani", () => getMoney([project], moneyView)),
    on(tab === "bani", () => prisma.project.count({ where: { organizationId: project.organizationId } })),
    prisma.connection.findMany({
      where: { projectId: project.id, provider: { notIn: ["MANUAL", "SOCIAL_AUTOPOST"] } },
      select: { id: true, provider: true, label: true, externalId: true, status: true, lastSyncAt: true, lastError: true },
      orderBy: { createdAt: "asc" },
    }),
    on(tab === "trafic", () => getClarity(project.id, since, until)),
    on(tab === "bani", () => getApiAiCosts(ids, since, until)),
    on(tab === "bani", () => getCostInvoices(project)),
  ]);

  // „Pe scurt”: azi / 7 / 30 de zile, aceleasi cifre ca pe prima pagina
  const overview = tab === "prezentare" ? (await getOverview([{ ...project, connections }]))[0] : null;

  // PostingClips legat, sau postari automate Facebook / Instagram primite de la social-autopost
  const hasSocial = connections.some((c) => c.provider === "POSTINGCLIPS") || (social?.published ?? 0) > 0;
  const hasInvoices = connections.some((c) => c.provider === "OBLIO");
  const hasReplicate = connections.some((c) => c.provider === "REPLICATE");
  // Anthropic / OpenAI: proiectul are cel putin un workspace / proiect extern legat
  const hasApiAi = (apiAi?.linked ?? 0) > 0;
  const hasAi = hasReplicate || hasApiAi;
  // Doar la proiectele cu mai multe site-uri (ex. grupul print)
  const hasSites = (sites ?? []).filter((r) => r.site).length > 1;
  const periodLabel = `ultimele ${days} de zile`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          {project.domain && <p className="text-sm text-text-3">{project.domain}</p>}
        </div>
        {tab !== "conexiuni" && tab !== "google" && tab !== "bani" && <RangeTabs basePath={base} days={days} tab={tab} />}
      </div>
      <ProjectTabs basePath={base} tab={tab} days={days} />

      {tab === "prezentare" && m && traffic && (
        <>
          {overview && <BusinessDetail b={overview} />}
          <CurrencyWarning currencies={m.currencies} currency={project.currency} />
          <KpiTiles m={m} currency={project.currency} />
          {traffic.lastHitAt && <SourcesMoney t={traffic} currency={project.currency} periodLabel={periodLabel} />}
          {/* Cifrele raportate de aplicatie (daca are /api/mydashboard/stats); nu tine pagina in loc */}
          <Suspense fallback={null}>
            <AppStatsSection projectName={project.name} domain={project.domain} currency={project.currency} />
          </Suspense>
          <SpendRevenueChart data={m.daily} currency={project.currency} />
          {hasSites && sites && <SitesSection rows={sites} currency={project.currency} />}
        </>
      )}
      {tab === "trafic" && traffic && (
        <>
          {traffic.lastHitAt && <SourcesMoney t={traffic} currency={project.currency} periodLabel={periodLabel} />}
          <TrafficSection t={traffic} currency={project.currency} projectId={project.id} />
          <ClaritySection c={clarity} basePath={base} days={days} />
        </>
      )}
      {tab === "google" && google && <GoogleSection g={google} basePath={base} />}
      {tab === "reclame" && m && <CampaignTable campaigns={m.campaigns} currency={project.currency} />}
      {tab === "social" &&
        (hasSocial && social ? (
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
        (hasInvoices && invoices ? (
          <InvoicesSection inv={invoices} projectId={project.id} canEdit={role !== "VIEWER"} />
        ) : (
          <NotConnected
            title="Facturi"
            text="Leagă Oblio cu seria de facturare a proiectului ca să vezi facturile și să le trimiți în SPV."
            basePath={base}
            days={days}
          />
        ))}
      {tab === "bani" && m && social && ai && money && apiAi && (
        <>
          <MoneySection
            m={money.rows[0]}
            cur={money.cur}
            prev={money.prev}
            view={moneyView}
            basePath={base}
            organizationId={project.organizationId}
            canEdit={role !== "VIEWER"}
            sharedWith={orgSize ?? 1}
            aiSources={[hasReplicate && "Replicate", hasApiAi && "Anthropic / OpenAI"].filter((x): x is string => !!x)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 pt-4">
            <h2 className="text-lg font-semibold">Detalii pe perioadă</h2>
            <RangeTabs basePath={base} days={days} tab={tab} />
          </div>
          <CostSummary
            adSpend={m.spend}
            byProvider={m.byProvider}
            clipAdSpend={social.clipAdSpend}
            aiUsd={hasAi ? (hasReplicate ? ai.costUsd : 0) + apiAi.costUsd : null}
            aiLabel={[hasReplicate && "Replicate (estimat)", hasApiAi && "Anthropic / OpenAI"].filter(Boolean).join(" + ")}
            revenue={m.revenue}
            currency={project.currency}
          />
          {hasApiAi && <ApiAiCostSection ai={apiAi} />}
          {hasReplicate && <AiCostSection ai={ai} revenue={m.revenue} currency={project.currency} />}
          <CostInvoicesSection rows={costInvoices} projectId={project.id} canEdit={role !== "VIEWER"} today={new Date().toISOString().slice(0, 10)} />
        </>
      )}
      {tab === "conexiuni" && (
        <>
          <ConnectionsPanel projectId={project.id} connections={connections} canEdit={role !== "VIEWER"} />
          <AiLinksPanel projectId={project.id} organizationId={project.organizationId} canEdit={role !== "VIEWER"} />
        </>
      )}
    </div>
  );
}
