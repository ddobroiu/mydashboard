import { RefreshCw, Trash2 } from "lucide-react";
import type { Connection } from "@prisma/client";
import { PROVIDERS, providerName } from "@/lib/integrations/types";
import { deleteConnection, syncProject } from "@/app/dashboard/actions";
import { ConnectForm } from "./ConnectForm";

type Conn = Pick<Connection, "id" | "provider" | "label" | "externalId" | "status" | "lastSyncAt" | "lastError">;

const fmtTime = (d: Date | null) =>
  d ? d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" }) : "niciodată";

export function ConnectionsPanel({ projectId, connections, canEdit }: { projectId: string; connections: Conn[]; canEdit: boolean }) {
  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Conexiuni</h2>
        {canEdit && connections.length > 0 && (
          <form action={syncProject} className="flex items-center gap-2">
            <input type="hidden" name="projectId" value={projectId} />
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

      {connections.length > 0 && (
        <ul className="divide-y divide-border">
          {connections.map((c) => (
            <li key={c.id} className="py-2 flex items-start justify-between gap-3 text-sm">
              <div>
                <div className="font-medium">
                  {providerName(c.provider)}
                  {(c.label || c.externalId) && <span className="text-text-2 font-normal"> · {c.label ?? c.externalId}</span>}
                </div>
                <div className="text-xs text-text-3">
                  {c.status === "ERROR" ? (
                    <span className="text-bad">Eroare: {c.lastError}</span>
                  ) : (
                    <>Ultima sincronizare: {fmtTime(c.lastSyncAt)}</>
                  )}
                </div>
              </div>
              {canEdit && (
                <form action={deleteConnection}>
                  <input type="hidden" name="connectionId" value={c.id} />
                  <button className="text-text-3 hover:text-bad p-1" aria-label="Șterge conexiunea">
                    <Trash2 size={16} />
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <details open={connections.length === 0}>
          <summary className="cursor-pointer text-sm text-accent">+ Conectează un cont</summary>
          <div className="mt-3">
            <ConnectForm projectId={projectId} providers={PROVIDERS} />
          </div>
        </details>
      )}
    </div>
  );
}
