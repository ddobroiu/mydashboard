import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/access";
import { type AlertExplanation, SEVERITY_ORDER, explainAlert, explanationLines } from "@/lib/alert-explain";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = {
  down: "Site picat",
  credits: "Credite terminate",
  error: "Eroare",
  sync: "Conexiune",
  traffic: "Scădere din Google",
  "ai-credit": "AI: credit terminat",
  "ai-auth": "AI: cheie invalidă",
  "ai-rate": "AI: limită de cereri",
  "ai-budget": "AI: buget",
  voice: "Voce (ElevenLabs)",
};

const SEV_STYLE: Record<string, { card: string; badge: string }> = {
  Urgent: { card: "border-red-300 bg-red-50", badge: "bg-red-600 text-white" },
  Important: { card: "border-orange-200 bg-orange-50", badge: "bg-orange-500 text-white" },
  Mic: { card: "border-border bg-surface", badge: "bg-gray-500 text-white" },
};

type Row = { key: string; kind: string; project: string | null; message: string; explanation: unknown; failures: number; createdAt: Date; updatedAt: Date };

// Cardul unei alerte: intai explicatia pe intelesul tuturor, textul tehnic ascuns sub „Detalii tehnice”
function AlertCard({ a, e }: { a: Row; e: AlertExplanation }) {
  const st = SEV_STYLE[e.severity] ?? SEV_STYLE.Important;
  return (
    <div className={`rounded-lg border px-4 py-3 ${st.card}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${st.badge}`}>{e.severity}</span>
        <span className="font-semibold">
          {a.project ?? "general"}: {e.title}
        </span>
        <span className="text-text-3">
          de la {fmt(a.createdAt)} · ultima dată {fmt(a.updatedAt)} · de {a.failures} ori
        </span>
      </div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[11rem_1fr]">
        {explanationLines(e).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-text-2">{k}</dt>
            <dd className="text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <TechDetails a={a} e={e} />
    </div>
  );
}

function TechDetails({ a, e }: { a: Row; e: AlertExplanation }) {
  return (
    <details className="mt-2 text-xs text-text-3">
      <summary className="cursor-pointer select-none">Detalii tehnice</summary>
      <p className="mt-1 whitespace-pre-wrap break-words font-mono">{a.message}</p>
      <p className="mt-1">
        {KIND[a.kind] ?? a.kind} · cheie {a.key} · explicație {e.source === "ai" ? "făcută de AI" : e.source === "reguli" ? "din reguli" : "generală"}
      </p>
    </details>
  );
}

const fmt = (d: Date | null) => (d ? d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }) : "—");

// Toate problemele raportate de site-uri (POST /api/alert) si de verificarea la 5 minute (site picat), intr-un singur loc.
export default async function AlertsPage() {
  await requireUser();
  const [active, recent] = await Promise.all([
    prisma.alertState.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" } }),
    prisma.alertState.findMany({ where: { active: false }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);
  const withE = (rows: Row[]) => rows.map((a) => ({ a, e: explainAlert(a) }));
  // erorile de pe calculatorul unui programator (alertele vechi, de dinainte de filtru) nu intra la „Active acum”
  const all = withE(active);
  const real = all.filter((x) => !x.e.local).sort((x, y) => SEVERITY_ORDER[x.e.severity] - SEVERITY_ORDER[y.e.severity]);
  const localActive = all.filter((x) => x.e.local);
  const byProject = new Map<string, number>();
  for (const { a } of real) byProject.set(a.project ?? "general", (byProject.get(a.project ?? "general") ?? 0) + 1);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Alerte</h1>
        <p className="mt-1 text-sm text-text-2">
          Erorile trimise de toate site-urile (plăți, facturi, AI, căutări, joburi) și site-urile care nu răspund. Pentru fiecare problemă nouă primești și
          e-mail, apoi cel mult o dată pe oră cât timp continuă.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-semibold">Active acum ({real.length})</h2>
        {byProject.size > 0 && (
          <p className="mt-1 text-sm text-text-2">
            {[...byProject.entries()].map(([p, n]) => `${p}: ${n}`).join(" · ")}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {real.length === 0 && <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-2">Nicio problemă activă. ✅</p>}
          {real.map(({ a, e }) => (
            <AlertCard key={a.key} a={a} e={e} />
          ))}
          {localActive.length > 0 && (
            <details className="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-text-2">
              <summary className="cursor-pointer select-none">Teste locale — ignorate ({localActive.length})</summary>
              <p className="mt-1 text-xs text-text-3">Erori trimise de pe calculatorul unui programator, nu de pe site-ul real. Nu primești e-mail pentru ele.</p>
              <div className="mt-2 space-y-2">
                {localActive.map(({ a, e }) => (
                  <AlertCard key={a.key} a={a} e={e} />
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Rezolvate recent</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {withE(recent).map(({ a, e }) => (
                <tr key={a.key} className={e.local ? "opacity-60" : undefined}>
                  <td className="whitespace-nowrap px-3 py-2 align-top text-text-3">{fmt(a.updatedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{a.project ?? "general"}</td>
                  <td className="whitespace-nowrap px-3 py-2 align-top">{e.local ? "test local — ignorat" : e.severity}</td>
                  <td className="px-3 py-2 text-text-2">
                    <div>{e.title}</div>
                    <TechDetails a={a} e={e} />
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr>
                  <td className="px-3 py-3 text-text-3">Nimic încă.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
