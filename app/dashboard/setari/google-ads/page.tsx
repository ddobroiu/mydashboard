import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { adminOrganizations, projectsForUser, requireUser } from "@/lib/access";
import { accountAdsScript, accountScriptKey, getRules, isMissingTable, recentCampaigns } from "@/lib/ads-account";
import { CopyButton } from "@/components/TrackingForms";
import { money } from "@/lib/format";
import { addRule, deleteRule } from "./actions";

export const dynamic = "force-dynamic";

const BASE = (process.env.AUTH_URL || "https://mydashboard.ro").replace(/\/+$/, "");
const fmtTime = (d: Date) => d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" });

// Google Ads, contul comun: scriptul de lipit in cont + ce campanie la ce site merge (editabil)
export default async function GoogleAdsAccountPage() {
  const userId = await requireUser();
  const [orgs, projects] = await Promise.all([adminOrganizations(userId), projectsForUser(userId)]);
  const isAdmin = orgs.length > 0;
  const key = accountScriptKey();
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));

  let state: { rules: Awaited<ReturnType<typeof getRules>>; recent: Awaited<ReturnType<typeof recentCampaigns>> } | null = null;
  try {
    const rules = await getRules();
    state = { rules, recent: await recentCampaigns(rules) };
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/dashboard/setari" className="inline-flex items-center gap-1 text-sm text-text-2">
        <ArrowLeft size={14} /> Setări
      </Link>
      <div>
        <h1 className="text-2xl font-semibold">Google Ads</h1>
        <p className="text-sm text-text-2">
          Un singur script în contul de reclame trimite aici, din oră în oră, cât s-a cheltuit pe fiecare campanie. Fiecare campanie
          ajunge la site-ul al cărui nume îl are la început (ex. „BazaDate – Căutare” → BazaDate).
        </p>
      </div>

      {!state && (
        <div className="rounded-xl border border-warn/30 bg-warn-bg px-4 py-3 text-sm text-warn">
          Partea de Google Ads nu e pornită încă pe server (lipsesc două tabele). Programatorul trebuie să aplice
          <code className="mx-1">prisma/sql/2026-10-09_google_ads_cont_comun.sql</code>; până atunci scriptul ar primi o eroare.
        </div>
      )}

      <section className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold">Cum îl pui (o singură dată)</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-text-2">
          <li>
            În Google Ads: <b>Instrumente</b> → <b>Acțiuni în bloc</b> → <b>Scripturi</b> → butonul <b>+</b> → <b>Script nou</b>.
          </li>
          <li>Șterge tot ce e în editor, apasă <b>Copiază</b> mai jos și lipește scriptul.</li>
          <li>
            Apasă <b>Autorizează</b>, apoi <b>Previzualizare</b>: în jurnal trebuie să apară <code>200</code>.
          </li>
          <li>
            Salvează și, la <b>Frecvență</b>, alege <b>Din oră în oră</b>.
          </li>
          <li>Numește campaniile cu numele site-ului la început (BazaDate…, Shopping…, ShopPrint…) sau adaugă o regulă mai jos.</li>
        </ol>
        <p className="text-text-3">
          {state?.recent.lastAt ? `Ultimele date primite: ${fmtTime(state.recent.lastAt)}.` : "Încă n-a trimis nimic."} Scriptul conține o
          cheie: nu-l publica.
        </p>
      </section>

      {isAdmin && key ? (
        <section className="card space-y-2 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Scriptul</h2>
            <CopyButton text={accountAdsScript(`${BASE}/api/ingest/google-ads-cont`, key)} />
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg border border-border bg-bg p-3 text-xs">{accountAdsScript(`${BASE}/api/ingest/google-ads-cont`, key)}</pre>
        </section>
      ) : (
        <p className="text-sm text-text-3">{isAdmin ? "Lipsește CRON_SECRET pe server, deci scriptul nu are cheie." : "Doar administratorii văd scriptul."}</p>
      )}

      {state && (
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold">Ce campanie la ce site merge</h2>
          <ul className="divide-y divide-border text-sm">
            {state.rules.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  Numele începe cu <b>„{r.prefix}”</b> → <b>{nameOf.get(r.projectId) ?? "alt proiect"}</b>
                </span>
                {isAdmin && (
                  <form action={deleteRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <button className="p-1 text-text-3 hover:text-bad" aria-label={`Șterge regula ${r.prefix}`}>
                      <Trash2 size={16} />
                    </button>
                  </form>
                )}
              </li>
            ))}
            {state.rules.length === 0 && <li className="py-2 text-text-3">Nicio regulă încă.</li>}
          </ul>
          {isAdmin && (
            <form action={addRule} className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1 text-xs text-text-2">
                Numele campaniei începe cu
                <input name="prefix" required maxLength={80} placeholder="ex. BazaDate" className="input mt-1" />
              </label>
              <label className="min-w-40 flex-1 text-xs text-text-2">
                Merge la
                <select name="projectId" className="input mt-1">
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn">Adaugă</button>
            </form>
          )}
          <p className="text-xs text-text-3">
            Nu contează literele mari sau mici. Dacă se potrivesc mai multe, câștigă cea mai lungă. Un site care are deja scriptul lui
            separat (vechea legătură pe proiect) nu primește și partea de aici, ca să nu se numere de două ori.
          </p>
        </section>
      )}

      {state && state.recent.campaigns.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Campaniile din ultimele 30 de zile</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-3">
                <tr>
                  <th className="py-1.5 pr-3 font-normal">Campanie</th>
                  <th className="py-1.5 pr-3 font-normal">Site</th>
                  <th className="py-1.5 text-right font-normal">Cheltuit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {state.recent.campaigns.map((c) => (
                  <tr key={c.campaignId}>
                    <td className="py-2 pr-3">{c.name}</td>
                    <td className={`py-2 pr-3 ${c.projectId ? "" : "text-warn"}`}>{c.projectId ? nameOf.get(c.projectId) : "nicăieri — adaugă o regulă"}</td>
                    <td className="py-2 text-right tabular">{money(c.spend, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
