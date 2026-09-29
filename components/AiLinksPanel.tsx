import Link from "next/link";
import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { AI_ADMIN, AI_ADMIN_PROVIDERS } from "@/lib/integrations/ai-admin";
import { linkAiExternal, unlinkAiExternal } from "@/app/dashboard/ai/actions";

// Tabul Conexiuni: ce workspace-uri Anthropic / proiecte OpenAI tin de acest proiect.
// Cheia Admin e una pe organizatie si se pune in „Costuri AI”.
export async function AiLinksPanel({ projectId, organizationId, canEdit }: { projectId: string; organizationId: string; canEdit: boolean }) {
  const accounts = await prisma.aiAccount.findMany({
    where: { organizationId },
    select: { id: true, provider: true, names: true, status: true, lastError: true, links: { select: { id: true, externalId: true, projectId: true } } },
  });

  return (
    <div className="card p-4 space-y-3">
      <div>
        <h2 className="font-medium">Cost AI: Anthropic și OpenAI</h2>
        <p className="text-xs text-text-3">
          Leagă workspace-ul Anthropic (wrkspc_…) sau proiectul OpenAI (proj_…) în care stă cheia API a aplicației. Cheile Admin se pun o singură dată,
          în{" "}
          <Link href="/dashboard/ai" className="text-accent">
            Costuri AI
          </Link>
          .
        </p>
      </div>
      {AI_ADMIN_PROVIDERS.map((provider) => {
        const info = AI_ADMIN[provider];
        const acc = accounts.find((a) => a.provider === provider);
        if (!acc) return (
          <div key={provider} className="text-sm text-text-3">
            {info.name}: nicio cheie Admin încă.
          </div>
        );
        const names = (acc.names ?? {}) as Record<string, string>;
        const mine = acc.links.filter((l) => l.projectId === projectId);
        const taken = new Set(acc.links.map((l) => l.externalId));
        const the = provider === "ANTHROPIC_ADMIN" ? "workspace-ul" : "proiectul";
        return (
          <div key={provider} className="space-y-1 text-sm">
            <div className="font-medium">
              {info.name}
              {acc.status === "ERROR" && <span className="ml-2 text-xs text-bad font-normal">Eroare: {acc.lastError}</span>}
            </div>
            {mine.length === 0 && <div className="text-xs text-text-3">Niciun {info.idLabel} legat de acest proiect.</div>}
            <ul className="space-y-1">
              {mine.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <span>
                    {l.externalId === "default" ? "Default" : (names[l.externalId] ?? l.externalId)}
                    <span className="text-xs text-text-3"> {l.externalId}</span>
                  </span>
                  {canEdit && (
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
            {canEdit && (
              <form action={linkAiExternal} className="flex flex-wrap gap-2 pt-1">
                <input type="hidden" name="accountId" value={acc.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <select name="externalId" className="input w-auto flex-1 min-w-[200px] py-1" required defaultValue="">
                  <option value="" disabled>
                    alege {the}
                  </option>
                  {!taken.has("default") && <option value="default">Default ({the} implicit)</option>}
                  {Object.entries(names)
                    .filter(([id]) => !taken.has(id))
                    .map(([id, name]) => (
                      <option key={id} value={id}>
                        {name} · {id}
                      </option>
                    ))}
                </select>
                <button className="btn btn-ghost py-1">Leagă</button>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
