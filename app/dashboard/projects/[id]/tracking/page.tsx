import crypto from "crypto";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, CircleDashed, Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/access";
import { dayKey } from "@/lib/dates";
import { formatMoney } from "@/lib/metrics";
import { CopyBlock, CopyButton, GoalForm, LinkForm, SpendForm } from "@/components/TrackingForms";
import { deleteGoal, deleteLink, deleteManualSpend } from "./actions";

const BASE = (process.env.AUTH_URL || "https://mydashboard.ro").replace(/\/+$/, "");

const fmtTime = (d: Date) =>
  d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" });

const sessionsLastDay = (projectId: string) =>
  prisma.trackSession.count({ where: { projectId, startedAt: { gte: new Date(Date.now() - 86_400_000) } } });

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 space-y-3">
      <h2 className="font-medium flex items-center gap-2">
        <span className="inline-flex size-6 items-center justify-center rounded-full bg-accent text-white text-xs">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Guide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">{title}</summary>
      <div className="mt-2 text-sm text-text-2 space-y-1">{children}</div>
    </details>
  );
}

export default async function TrackingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, role } = await requireProject(id);
  const canEdit = role !== "VIEWER";

  // ID-ul public din snippet se creeaza la prima vizita pe pagina
  let trackingId = project.trackingId;
  if (!trackingId) {
    trackingId = crypto.randomBytes(8).toString("hex");
    await prisma.project.update({ where: { id: project.id }, data: { trackingId } });
  }

  const [lastSession, sessions24h, goals, links, spend] = await Promise.all([
    prisma.trackSession.findFirst({ where: { projectId: project.id }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
    sessionsLastDay(project.id),
    prisma.goal.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
    prisma.trackedLink.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "desc" } }),
    prisma.adSpendDaily.findMany({ where: { projectId: project.id, provider: "MANUAL" }, orderBy: { date: "desc" }, take: 30 }),
  ]);
  const goalCounts = await prisma.trackEvent.groupBy({
    by: ["goalId"],
    where: { projectId: project.id, type: "goal" },
    _count: { _all: true },
  });
  const countFor = (goalId: string) => goalCounts.find((g) => g.goalId === goalId)?._count._all ?? 0;

  const snippet = `<script defer src="${BASE}/t.js" data-site="${trackingId}"></script>`;
  const metaParams = "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}";
  const googleSuffix = "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}";
  const tiktokParams = "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__";

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <Link href={`/dashboard/projects/${project.id}`} className="text-sm text-text-3 hover:text-text inline-flex items-center gap-1">
          <ArrowLeft size={14} /> {project.name}
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Tracking: de unde vin clienții</h1>
        <p className="text-sm text-text-2 mt-1">
          Totul se face fără programator: lipești o singură dată un cod pe site, iar restul se setează de aici.
        </p>
      </div>

      <Step n={1} title="Pune codul pe site (o singură dată)">
        <div
          className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${lastSession ? "bg-good-bg text-good" : "bg-warn-bg text-warn"}`}
        >
          {lastSession ? <CheckCircle2 size={16} /> : <CircleDashed size={16} />}
          {lastSession
            ? `Funcționează: ultima vizită ${fmtTime(lastSession.lastSeenAt)}, ${sessions24h} vizite în ultimele 24 de ore.`
            : "Încă nu a sosit nicio vizită. După ce pui codul, deschide site-ul și reîncarcă pagina asta."}
        </div>
        <p className="text-sm text-text-2">Copiază codul și pune-l în secțiunea &lt;head&gt; a site-ului, pe toate paginile:</p>
        <CopyBlock text={snippet} />
        <div className="space-y-2">
          <Guide title="WordPress / WooCommerce">
            <p>1. Plugins → Add New → caută „WPCode” → Install → Activate.</p>
            <p>2. Code Snippets → Header &amp; Footer → lipește codul în „Header” → Save.</p>
            <p>Comenzile WooCommerce se prind automat dacă ai un plugin de Google Analytics 4 (ex. „GTM4WP” sau „Site Kit”); altfel adaugă mai jos un obiectiv cu pagina „/checkout/order-received”.</p>
          </Guide>
          <Guide title="Shopify">
            <p>1. Online Store → Themes → „…” → Edit code → layout/theme.liquid.</p>
            <p>2. Lipește codul chiar înainte de &lt;/head&gt; → Save.</p>
            <p>Pentru comenzi adaugă un obiectiv cu adresa „/thank_you” sau „/orders/”.</p>
          </Guide>
          <Guide title="Wix">
            <p>Settings → Custom Code → + Add Custom Code → lipește codul, „All pages”, „Head” → Apply.</p>
          </Guide>
          <Guide title="Google Tag Manager">
            <p>Tags → New → Custom HTML → lipește codul → Triggering: „All Pages” → Save → Submit (Publish).</p>
            <p>Comenzile trimise în dataLayer ca „purchase” (GA4 e-commerce) se prind automat.</p>
          </Guide>
          <Guide title="Alt site / builder">
            <p>Caută în setări „Custom code”, „Header scripts” sau „Cod în &lt;head&gt;” și lipește codul acolo.</p>
          </Guide>
        </div>
        <p className="text-xs text-text-3">
          Codul salvează un ID anonim al vizitatorului în browser, ca să lege vizita de comandă. Dacă site-ul are banner de cookie-uri,
          trece-l la categoria „Statistici / Marketing”, la fel ca Meta Pixel.
        </p>
      </Step>

      <Step n={2} title="Ce înseamnă o conversie (obiective)">
        <p className="text-sm text-text-2">
          Spune ce pagină vede clientul după ce cumpără sau trimite un formular. Deschide pagina de mulțumire și copiază o parte din
          adresă (ex. <code>/multumim</code>, <code>/order-received</code>, <code>/thank_you</code>).
        </p>
        {goals.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {goals.map((g) => (
              <li key={g.id} className="py-2 flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium">{g.name}</span>{" "}
                  <span className="text-text-3">
                    · adresa conține „{g.pattern}”{g.value ? ` · ${formatMoney(Number(g.value), project.currency)}` : ""} ·{" "}
                    {countFor(g.id)} atinse
                  </span>
                </div>
                {canEdit && (
                  <form action={deleteGoal}>
                    <input type="hidden" name="goalId" value={g.id} />
                    <button className="text-text-3 hover:text-bad p-1" aria-label="Șterge obiectivul">
                      <Trash2 size={16} />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && <GoalForm projectId={project.id} />}
        <details className="text-sm">
          <summary className="cursor-pointer text-text-3">Vânzări cu sumă exactă (automat)</summary>
          <div className="mt-2 space-y-1 text-text-2">
            <p>• Comenzile pe care site-ul le trimite deja spre Google Analytics 4 (evenimentul „purchase”) se prind singure, cu valoare.</p>
            <p>• Plățile prin linkuri de plată Stripe (buy.stripe.com) se leagă singure de vizitator, dacă Stripe e conectat la proiect.</p>
            <p>
              • Pentru un programator: la Stripe Checkout pune în <code>metadata.md_vid</code> valoarea cookie-ului <code>_md_vid</code>, sau
              apelează în pagină <code>mdTrack(&quot;purchase&quot;, {"{ value: 250, order: \"1234\" }"})</code>.
            </p>
          </div>
        </details>
      </Step>

      <Step n={3} title="Parametri pentru reclame">
        <p className="text-sm text-text-2">
          Așa legăm banii cheltuiți de vizitele și vânzările fiecărei campanii. Se pune o singură dată la nivel de cont.
        </p>
        <Guide title="Meta Ads (Facebook / Instagram)">
          <p>În fiecare reclamă: Destination → URL parameters (sau în bulk, Ads Manager → Edit) → lipește:</p>
          <CopyBlock text={metaParams} />
        </Guide>
        <Guide title="Google Ads">
          <p>Admin → Account settings → Tracking → Final URL suffix → lipește (auto-tagging poate rămâne pornit):</p>
          <CopyBlock text={googleSuffix} />
        </Guide>
        <Guide title="TikTok Ads">
          <p>La reclamă: Destination → URL → Add URL parameters → lipește:</p>
          <CopyBlock text={tiktokParams} />
        </Guide>
      </Step>

      <Step n={4} title="Linkuri urmărite (bio, influenceri, flyere, QR)">
        <p className="text-sm text-text-2">
          Pentru locurile unde nu ai reclamă: un link scurt care numără click-urile și marchează vizitele cu sursa aleasă.
        </p>
        {links.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {links.map((l) => {
              const short = `${BASE}/l/${l.code}`;
              return (
                <li key={l.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {l.name} <span className="text-text-3 font-normal">· {l.clicks} click-uri</span>
                    </div>
                    <div className="text-xs text-text-3 truncate">{short} → {l.destination}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <CopyButton text={short} label="Copiază linkul" />
                    {canEdit && (
                      <form action={deleteLink}>
                        <input type="hidden" name="linkId" value={l.id} />
                        <button className="text-text-3 hover:text-bad p-1" aria-label="Șterge linkul">
                          <Trash2 size={16} />
                        </button>
                      </form>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && <LinkForm projectId={project.id} domain={project.domain} />}
      </Step>

      <Step n={5} title="Cheltuieli manuale">
        <p className="text-sm text-text-2">
          Bani dați în afara platformelor conectate (influenceri, flyere, sponsorizări). Dacă numele e același cu campania unui link
          urmărit, costul se leagă de vizitele și vânzările lui.
        </p>
        {spend.length > 0 && (
          <ul className="divide-y divide-border text-sm">
            {spend.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between gap-3">
                <span>
                  <span className="text-text-3 tabular">{s.date.toISOString().slice(0, 10)}</span> · {s.campaignName}
                </span>
                <span className="flex items-center gap-2 tabular">
                  {formatMoney(Number(s.spend), s.currency)}
                  {canEdit && (
                    <form action={deleteManualSpend}>
                      <input type="hidden" name="spendId" value={s.id} />
                      <button className="text-text-3 hover:text-bad p-1" aria-label="Șterge cheltuiala">
                        <Trash2 size={16} />
                      </button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && <SpendForm projectId={project.id} currency={project.currency} today={dayKey(new Date())} />}
      </Step>
    </div>
  );
}
