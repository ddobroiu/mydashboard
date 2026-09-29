import Link from "next/link";
import { RefreshCw, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { AI_PROVIDER_NAMES, getAiOverview, type AiProviderKey } from "@/lib/ai-api-costs";
import { AI_ADMIN, AI_ADMIN_PROVIDERS } from "@/lib/integrations/ai-admin";
import { AiTrendChart, AI_COLORS } from "@/components/AiTrendChart";
import { AiKeyForm } from "@/components/AiKeyForm";
import { Tile } from "@/components/KpiTiles";
import { ERROR_KIND_NAMES, REPORTED_PROVIDER_NAMES, getReportedOverview, type AiErrorKind, type ReportedProvider } from "@/lib/ai-usage";
import { deleteAiAccount, linkAiExternal, saveAiBudget, syncAiNow, unlinkAiExternal } from "./actions";

export const dynamic = "force-dynamic";

const usd = (v: number, digits = 2) =>
  new Intl.NumberFormat("ro-RO", { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
const tokens = (v: number) => (v > 0 ? new Intl.NumberFormat("ro-RO", { notation: "compact", maximumFractionDigits: 1 }).format(v) : "–");
const fmtTime = (d: Date | null) =>
  d ? d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }) : "niciodată";
const BASE_PROVIDERS: AiProviderKey[] = ["ANTHROPIC", "OPENAI", "REPLICATE"];

function change(cur: number, prev: number) {
  if (prev <= 0) return undefined;
  const pct = Math.round(((cur - prev) / prev) * 100);
  return `${pct >= 0 ? "+" : ""}${pct}% față de cele 30 de zile dinainte (${usd(prev)})`;
}

// Costuri AI: cat platesti pe API-urile AI, pe proiect, furnizor si model
export default async function AiCostsPage() {
  const userId = await requireUser();
  const orgs = await prisma.organization.findMany({
    where: { memberships: { some: { userId } } },
    select: { id: true, name: true, memberships: { where: { userId }, select: { role: true } } },
    orderBy: { name: "asc" },
  });
  const adminOrgs = orgs.filter((o) => o.memberships[0]?.role !== "VIEWER");
  const o = await getAiOverview(orgs.map((x) => x.id));
  const t = o.totals;
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true } });
  // Aplicatiile care raporteaza sub un nume nepotrivit cu niciun proiect le vede doar super-adminul
  const rep = await getReportedOverview(o.projects, Boolean(me?.isSuperAdmin));
  const PROVIDERS: AiProviderKey[] = t.last30.OTHER || t.month.OTHER ? [...BASE_PROVIDERS, "OTHER"] : BASE_PROVIDERS;
  const adminProjectIds = new Set(o.projects.filter((p) => adminOrgs.some((x) => x.id === p.organizationId)).map((p) => p.id));
  const canEditBudget = (projectId: string | null) => (projectId ? adminProjectIds.has(projectId) : Boolean(me?.isSuperAdmin));
  const canEdit = adminOrgs.length > 0;
  const projectsOf = (orgId: string) => o.projects.filter((p) => p.organizationId === orgId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Costuri AI</h1>
          <p className="text-sm text-text-3">
            Cât plătești pe Anthropic, OpenAI și Replicate, pe proiect. Sume în dolari, fără TVA. Anthropic și OpenAI se citesc o dată pe zi (ziua de
            ieri, după ora lor UTC); consumul raportat de site-uri apare pe loc.
          </p>
        </div>
        {canEdit && o.accounts.length > 0 && (
          <form action={syncAiNow} className="flex items-center gap-2">
            <select name="days" className="input w-auto py-1.5" defaultValue="7">
              <option value="7">ultimele 7 zile</option>
              <option value="30">ultimele 30 zile</option>
              <option value="90">ultimele 90 zile</option>
            </select>
            <button className="btn btn-ghost">
              <RefreshCw size={14} /> Sincronizează acum
            </button>
          </form>
        )}
      </div>

      <div className={`grid grid-cols-2 gap-3 ${PROVIDERS.length > 3 ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        <Tile label="Luna asta" value={usd(t.month.total)} sub={`de la 1 până azi`} />
        <Tile label="Ultimele 30 de zile" value={usd(t.last30.total)} sub={change(t.last30.total, t.prev30.total)} />
        {PROVIDERS.map((p) => (
          <Tile key={p} label={AI_PROVIDER_NAMES[p]} value={usd(t.last30[p])} sub={`30 de zile · luna asta ${usd(t.month[p])}${p === "REPLICATE" || p === "OTHER" ? " · estimat" : ""}`} />
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pe zile (ultimele 30)</h2>
        <AiTrendChart data={o.daily} />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Pe proiect</h2>
        <div className="card p-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular">
            <thead className="text-text-3 text-left">
              <tr>
                <th className="py-2 font-normal">Proiect</th>
                {PROVIDERS.map((p) => (
                  <th key={p} className="py-2 pl-4 font-normal text-right">
                    {AI_PROVIDER_NAMES[p]}
                  </th>
                ))}
                <th className="py-2 pl-4 font-normal text-right">30 de zile</th>
                <th className="py-2 pl-4 font-normal text-right">Luna asta</th>
              </tr>
            </thead>
            <tbody>
              {o.projects
                .filter((p) => p.last30 !== 0 || p.month !== 0)
                .map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="py-2">
                      <Link href={`/dashboard/projects/${p.id}?tab=bani`} className="hover:text-accent">
                        {p.name}
                      </Link>
                    </td>
                    {PROVIDERS.map((k) => (
                      <td key={k} className="py-2 pl-4 text-right">
                        {p.by[k] ? usd(p.by[k]) : "–"}
                      </td>
                    ))}
                    <td className="py-2 pl-4 text-right font-medium">{usd(p.last30)}</td>
                    <td className="py-2 pl-4 text-right">{usd(p.month)}</td>
                  </tr>
                ))}
              {(o.unassignedTotal.last30 !== 0 || o.unassignedTotal.month !== 0) && (
                <tr className="border-t border-border text-text-2">
                  <td className="py-2">
                    Neatribuit <span className="text-xs text-text-3">(workspace-uri / proiecte nelegate, mai jos)</span>
                  </td>
                  {PROVIDERS.map((k) => {
                    const v = o.unassigned.filter((u) => u.provider === k).reduce((s, u) => s + u.last30, 0);
                    return (
                      <td key={k} className="py-2 pl-4 text-right">
                        {v ? usd(v) : "–"}
                      </td>
                    );
                  })}
                  <td className="py-2 pl-4 text-right font-medium">{usd(o.unassignedTotal.last30)}</td>
                  <td className="py-2 pl-4 text-right">{usd(o.unassignedTotal.month)}</td>
                </tr>
              )}
              <tr className="border-t-2 border-border font-medium">
                <td className="py-2">Total</td>
                {PROVIDERS.map((k) => (
                  <td key={k} className="py-2 pl-4 text-right">
                    {usd(t.last30[k])}
                  </td>
                ))}
                <td className="py-2 pl-4 text-right">{usd(t.last30.total)}</td>
                <td className="py-2 pl-4 text-right">{usd(t.month.total)}</td>
              </tr>
            </tbody>
          </table>
          {t.last30.total === 0 && t.month.total === 0 && <p className="text-sm text-text-3 pt-2">Niciun cost AI în ultimele 30 de zile.</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Consum raportat de site-uri</h2>
        <p className="text-xs text-text-3">
          Fiecare aplicație trimite aici, pe loc, fiecare apel AI (tokeni, cost estimat din prețurile modelelor, erori). Sumele sunt estimate, dar se
          văd imediat, pe când factura Anthropic / OpenAI vine a doua zi. Pe baza lor pleacă alertele pe e-mail: buget zilnic sau lunar depășit (și un
          avertisment la 80% din bugetul lunar), credit terminat sau cheie API invalidă. Bugetul implicit e 2 $/zi și 20 $/lună pe site.
        </p>
        <div className="card p-4 overflow-x-auto">
          {rep.sites.length === 0 ? (
            <p className="text-sm text-text-3">Niciun site nu a raportat încă consum AI în ultimele 30 de zile.</p>
          ) : (
            <table className="w-full min-w-[960px] text-sm tabular">
              <thead className="text-text-3 text-left">
                <tr>
                  <th className="py-2 font-normal">Site</th>
                  <th className="py-2 pl-4 font-normal text-right">Azi</th>
                  <th className="py-2 pl-4 font-normal text-right">Luna asta</th>
                  <th className="py-2 pl-4 font-normal text-right">30 de zile</th>
                  <th className="py-2 pl-4 font-normal">Furnizori (ce intră în totaluri)</th>
                  <th className="py-2 pl-4 font-normal">Ultima eroare</th>
                  <th className="py-2 pl-4 font-normal">Buget $/zi · $/lună</th>
                </tr>
              </thead>
              <tbody>
                {rep.sites.map((s) => {
                  const dayPct = s.budget.dailyUsd > 0 ? s.today / s.budget.dailyUsd : 0;
                  const monPct = s.budget.monthlyUsd > 0 ? s.month / s.budget.monthlyUsd : 0;
                  const tone = (pct: number) => (pct >= 1 ? "text-bad font-medium" : pct >= 0.8 ? "text-warn font-medium" : "");
                  return (
                    <tr key={s.project} className="border-t border-border align-top">
                      <td className="py-2">
                        {s.projectId ? (
                          <Link href={`/dashboard/projects/${s.projectId}?tab=bani`} className="hover:text-accent">
                            {s.projectName}
                          </Link>
                        ) : (
                          <span>{s.project}</span>
                        )}
                        {s.projectName && s.projectName !== s.project && <span className="ml-1 text-xs text-text-3">({s.project})</span>}
                        {!s.projectId && <div className="text-xs text-warn">nelegat de niciun proiect: numele nu se potrivește cu un proiect</div>}
                        <div className="text-xs text-text-3">
                          {s.calls30} apeluri
                          {s.errors30 > 0 && `, ${s.errors30} erori`}
                          {s.unpriced30 > 0 && `, ${s.unpriced30} fără preț`}
                          {s.features.length > 0 && ` · ${s.features.map(([f]) => f).join(", ")}`}
                        </div>
                      </td>
                      <td className={`py-2 pl-4 text-right ${tone(dayPct)}`}>
                        {usd(s.today)}
                        <div className="text-xs text-text-3 font-normal">{s.budget.dailyUsd > 0 ? `din ${usd(s.budget.dailyUsd)}` : "fără buget"}</div>
                      </td>
                      <td className={`py-2 pl-4 text-right ${tone(monPct)}`}>
                        {usd(s.month)}
                        <div className="text-xs text-text-3 font-normal">
                          {s.budget.monthlyUsd > 0 ? `${Math.round(monPct * 100)}% din ${usd(s.budget.monthlyUsd)}` : "fără buget"}
                        </div>
                      </td>
                      <td className="py-2 pl-4 text-right">{usd(s.last30)}</td>
                      <td className="py-2 pl-4 text-xs">
                        {s.providers.map(([prov, v]) => (
                          <div key={prov}>
                            {REPORTED_PROVIDER_NAMES[prov as ReportedProvider] ?? prov}: {usd(v.last30)}{" "}
                            <span className={v.source === "facturat" ? "text-text-3" : "text-good"}>
                              {v.source === "facturat" ? "(în totaluri: factura)" : "(în totaluri: raportat)"}
                            </span>
                          </div>
                        ))}
                      </td>
                      <td className="py-2 pl-4 text-xs max-w-[260px]">
                        {s.lastError ? (
                          <>
                            <span className={s.lastError.kind === "credit" || s.lastError.kind === "auth" ? "text-bad font-medium" : ""}>
                              {ERROR_KIND_NAMES[s.lastError.kind as AiErrorKind] ?? s.lastError.kind}
                            </span>{" "}
                            · {REPORTED_PROVIDER_NAMES[s.lastError.provider as ReportedProvider] ?? s.lastError.provider} · {fmtTime(s.lastError.at)}
                            <div className="text-text-3 truncate" title={s.lastError.message}>
                              {s.lastError.message}
                            </div>
                          </>
                        ) : (
                          <span className="text-text-3">–</span>
                        )}
                      </td>
                      <td className="py-2 pl-4">
                        {canEditBudget(s.projectId) ? (
                          <form action={saveAiBudget} className="flex items-center gap-1">
                            <input type="hidden" name="project" value={s.project} />
                            <input
                              name="dailyUsd"
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={s.budget.dailyUsd}
                              className="input w-20 py-1"
                              aria-label={`Buget zilnic ${s.project}, în dolari`}
                            />
                            <input
                              name="monthlyUsd"
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={s.budget.monthlyUsd}
                              className="input w-20 py-1"
                              aria-label={`Buget lunar ${s.project}, în dolari`}
                            />
                            <button className="btn btn-ghost py-1">Salvează</button>
                          </form>
                        ) : (
                          <span className="text-xs">
                            {usd(s.budget.dailyUsd)} · {usd(s.budget.monthlyUsd)}
                          </span>
                        )}
                        <div className="text-xs text-text-3">{s.budget.custom ? "setat de tine" : "implicit"}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-text-3">
          <b>Ce sursă intră în totaluri</b> (sus, „Pe proiect” și la „Bani”): pentru fiecare proiect și furnizor folosim costul facturat când îl avem
          (Anthropic / OpenAI printr-un workspace sau proiect legat la „Conturi”, Replicate prin conexiunea proiectului). Atunci consumul raportat de
          site doar se afișează aici, ca să nu se adune de două ori. Când nu avem factura pentru acel furnizor, în totaluri intră consumul raportat de
          site (estimat). Bugetele și alertele folosesc mereu consumul raportat, pentru că se vede pe loc. Pune 0 la un buget ca să oprești alerta
          lui; golește ambele câmpuri ca să revii la bugetul implicit.
        </p>
      </section>

      {o.unassigned.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Neatribuit</h2>
          <p className="text-xs text-text-3">
            Costuri din workspace-uri Anthropic / proiecte OpenAI care nu sunt legate de niciun proiect. Leagă-le ca să apară la proiectul lor (se
            aplică și zilelor deja aduse).
          </p>
          <div className="card p-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tabular">
              <thead className="text-text-3 text-left">
                <tr>
                  <th className="py-2 font-normal">Furnizor</th>
                  <th className="py-2 pl-4 font-normal">Workspace / proiect</th>
                  <th className="py-2 pl-4 font-normal text-right">30 de zile</th>
                  <th className="py-2 pl-4 font-normal text-right">Luna asta</th>
                  {canEdit && <th className="py-2 pl-4 font-normal">Leagă de</th>}
                </tr>
              </thead>
              <tbody>
                {o.unassigned.map((u) => {
                  const orgId = o.accounts.find((a) => a.id === u.accountId)?.organizationId ?? "";
                  return (
                    <tr key={`${u.accountId}|${u.externalId}`} className="border-t border-border">
                      <td className="py-2">{AI_PROVIDER_NAMES[u.provider]}</td>
                      <td className="py-2 pl-4">
                        {u.name ?? u.externalId}
                        {u.externalId !== "default" && <span className="ml-2 text-xs text-text-3">{u.externalId}</span>}
                        {u.externalId === "default" && <span className="ml-2 text-xs text-text-3">(workspace / proiect implicit)</span>}
                      </td>
                      <td className="py-2 pl-4 text-right">{usd(u.last30)}</td>
                      <td className="py-2 pl-4 text-right">{usd(u.month)}</td>
                      {canEdit && (
                        <td className="py-2 pl-4">
                          {adminOrgs.some((x) => x.id === orgId) && (
                            <form action={linkAiExternal} className="flex gap-2">
                              <input type="hidden" name="accountId" value={u.accountId} />
                              <input type="hidden" name="externalId" value={u.externalId} />
                              <select name="projectId" className="input w-auto py-1" required defaultValue="">
                                <option value="" disabled>
                                  alege proiectul
                                </option>
                                {projectsOf(orgId).map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              <button className="btn btn-ghost py-1">Leagă</button>
                            </form>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {o.models.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Pe model</h2>
          <div className="card p-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm tabular">
              <thead className="text-text-3 text-left">
                <tr>
                  <th className="py-2 font-normal">Model</th>
                  <th className="py-2 pl-4 font-normal">Furnizor</th>
                  <th className="py-2 pl-4 font-normal text-right">Tokeni intrare</th>
                  <th className="py-2 pl-4 font-normal text-right">Tokeni ieșire</th>
                  <th className="py-2 pl-4 font-normal text-right">30 de zile</th>
                  <th className="py-2 pl-4 font-normal text-right">Luna asta</th>
                </tr>
              </thead>
              <tbody>
                {o.models.map((m) => (
                  <tr key={`${m.provider}|${m.model}`} className="border-t border-border">
                    <td className="py-2">{m.model}</td>
                    <td className="py-2 pl-4">
                      <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: AI_COLORS[m.provider] }} />
                      {AI_PROVIDER_NAMES[m.provider]}
                    </td>
                    <td className="py-2 pl-4 text-right">{tokens(m.inputTokens)}</td>
                    <td className="py-2 pl-4 text-right">{tokens(m.outputTokens)}</td>
                    <td className="py-2 pl-4 text-right">{usd(m.last30)}</td>
                    <td className="py-2 pl-4 text-right">{usd(m.month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Conturi</h2>
        {orgs.map((org) =>
          AI_ADMIN_PROVIDERS.map((provider) => {
            const info = AI_ADMIN[provider];
            const acc = o.accounts.find((a) => a.organizationId === org.id && a.provider === provider);
            const isAdmin = adminOrgs.some((x) => x.id === org.id);
            const known = acc ? Object.entries(acc.names) : [];
            const free = known.filter(([id]) => !acc?.links.some((l) => l.externalId === id));
            return (
              <div key={`${org.id}|${provider}`} className="card p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {info.name}
                      {orgs.length > 1 && <span className="text-text-3 font-normal"> · {org.name}</span>}
                      {acc?.label && <span className="text-text-2 font-normal"> · {acc.label}</span>}
                    </div>
                    <div className="text-xs text-text-3">
                      {!acc ? (
                        "Neconectat"
                      ) : acc.status === "ERROR" ? (
                        <span className="text-bad">Eroare: {acc.lastError}</span>
                      ) : (
                        <>Ultima sincronizare: {fmtTime(acc.lastSyncAt)}</>
                      )}
                    </div>
                  </div>
                  {acc && isAdmin && (
                    <form action={deleteAiAccount}>
                      <input type="hidden" name="accountId" value={acc.id} />
                      <button className="text-text-3 hover:text-bad p-1" aria-label={`Șterge contul ${info.name}`}>
                        <Trash2 size={16} />
                      </button>
                    </form>
                  )}
                </div>

                {acc && (
                  <div className="space-y-1 text-sm">
                    <div className="text-text-2">Legături {info.idLabel} → proiect:</div>
                    {acc.links.length === 0 && <div className="text-xs text-text-3">Niciuna încă. Tot costul apare la „Neatribuit”.</div>}
                    <ul className="space-y-1">
                      {acc.links.map((l) => (
                        <li key={l.id} className="flex items-center gap-2">
                          <span>
                            {l.externalId === "default" ? "Default" : (acc.names[l.externalId] ?? l.externalId)}
                            <span className="text-xs text-text-3"> {l.externalId}</span> → {l.project}
                          </span>
                          {isAdmin && (
                            <form action={unlinkAiExternal}>
                              <input type="hidden" name="linkId" value={l.id} />
                              <button className="text-text-3 hover:text-bad p-0.5" aria-label="Scoate legătura">
                                <Trash2 size={14} />
                              </button>
                            </form>
                          )}
                        </li>
                      ))}
                    </ul>
                    {isAdmin && (
                      <form action={linkAiExternal} className="flex flex-wrap gap-2 pt-1">
                        <input type="hidden" name="accountId" value={acc.id} />
                        <input
                          name="externalId"
                          list={`ids-${acc.id}`}
                          className="input w-auto flex-1 min-w-[200px] py-1"
                          placeholder={`${info.idPrefix}… sau default`}
                          required
                        />
                        <datalist id={`ids-${acc.id}`}>
                          <option value="default">Default</option>
                          {free.map(([id, name]) => (
                            <option key={id} value={id}>
                              {name}
                            </option>
                          ))}
                        </datalist>
                        <select name="projectId" className="input w-auto py-1" required defaultValue="">
                          <option value="" disabled>
                            proiectul
                          </option>
                          {projectsOf(org.id).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <button className="btn btn-ghost py-1">Leagă</button>
                      </form>
                    )}
                  </div>
                )}

                {isAdmin && (
                  <details open={!acc}>
                    <summary className="cursor-pointer text-sm text-accent">{acc ? "Înlocuiește cheia Admin" : "+ Adaugă cheia Admin"}</summary>
                    <div className="mt-2">
                      <AiKeyForm organizationId={org.id} provider={provider} placeholder={`${info.keyPrefix}…`} hint={info.keyHint} replace={!!acc} />
                    </div>
                  </details>
                )}
              </div>
            );
          }),
        )}
      </section>

      <section className="text-xs text-text-3 space-y-1">
        <p>
          <b>Replicate</b>: costul e estimat din timpul fiecărei rulări × tariful public al modelului (Replicate nu dă prețul prin API), așa că poate
          diferi puțin de factură. Proiectele care folosesc același cont Replicate (3dview și edu3d) nu se pot despărți exact: fiecare vede rulările
          modelelor alese la conexiunea lui, iar un model folosit de amândouă apare la ambele.
          {o.replicateProjects.length > 0 && <> Proiecte cu Replicate: {o.replicateProjects.join(", ")}.</>}
        </p>
        <p>
          <b>Anthropic și OpenAI</b>: costul facturat de ei, pe zile UTC. Atribuirea pe proiect se face prin workspace-ul Anthropic (wrkspc_…) sau
          proiectul OpenAI (proj_…) în care e cheia API a aplicației; ce nu e legat apare la „Neatribuit”.
        </p>
      </section>
    </div>
  );
}
