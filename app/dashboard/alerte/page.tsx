import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/access";

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
};

const fmt = (d: Date | null) => (d ? d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }) : "—");

// Toate problemele raportate de site-uri (POST /api/alert) si de verificarea la 5 minute (site picat), intr-un singur loc.
export default async function AlertsPage() {
  await requireUser();
  const [active, recent] = await Promise.all([
    prisma.alertState.findMany({ where: { active: true }, orderBy: { updatedAt: "desc" } }),
    prisma.alertState.findMany({ where: { active: false }, orderBy: { updatedAt: "desc" }, take: 50 }),
  ]);
  const byProject = new Map<string, number>();
  for (const a of active) byProject.set(a.project ?? "general", (byProject.get(a.project ?? "general") ?? 0) + 1);

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
        <h2 className="text-lg font-semibold">Active acum ({active.length})</h2>
        {byProject.size > 0 && (
          <p className="mt-1 text-sm text-text-2">
            {[...byProject.entries()].map(([p, n]) => `${p}: ${n}`).join(" · ")}
          </p>
        )}
        <div className="mt-3 space-y-2">
          {active.length === 0 && <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text-2">Nicio problemă activă. ✅</p>}
          {active.map((a) => (
            <div key={a.key} className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="font-semibold text-red-800">{KIND[a.kind] ?? a.kind}</span>
                <span className="font-medium">{a.project ?? "general"}</span>
                <span className="text-text-3">de la {fmt(a.createdAt)} · ultima dată {fmt(a.updatedAt)} · de {a.failures} ori</span>
              </div>
              <p className="mt-1 text-sm text-text">{a.message}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold">Rezolvate recent</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              {recent.map((a) => (
                <tr key={a.key}>
                  <td className="whitespace-nowrap px-3 py-2 text-text-3">{fmt(a.updatedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{a.project ?? "general"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{KIND[a.kind] ?? a.kind}</td>
                  <td className="px-3 py-2 text-text-2">{a.message}</td>
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
