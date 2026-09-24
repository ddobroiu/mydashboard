"use client";

import { useActionState, useState } from "react";
import type { ProviderInfo } from "@/lib/integrations/types";
import { addConnection } from "@/app/dashboard/actions";

export function ConnectForm({ projectId, providers }: { projectId: string; providers: ProviderInfo[] }) {
  const available = providers.filter((p) => p.available);
  const [selected, setSelected] = useState(available[0]?.provider);
  const [error, action, pending] = useActionState(addConnection, null);
  const info = available.find((p) => p.provider === selected);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="flex flex-wrap gap-2">
        {providers.map((p) => (
          <button
            key={p.provider}
            type="button"
            disabled={!p.available}
            onClick={() => setSelected(p.provider)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              selected === p.provider ? "border-accent text-accent" : "border-border text-text-2"
            } disabled:opacity-50`}
          >
            {p.name}
            {!p.available && <span className="ml-1 text-xs">(în curând)</span>}
          </button>
        ))}
      </div>

      {info && (
        <>
          <input type="hidden" name="provider" value={info.provider} />
          {info.externalIdLabel && (
            <label className="block space-y-1">
              <span className="text-sm text-text-2">{info.externalIdLabel}</span>
              <input name="externalId" className="input" placeholder={info.provider === "META" ? "act_..." : ""} required />
              {info.externalIdHint && <span className="text-xs text-text-3">{info.externalIdHint}</span>}
            </label>
          )}
          {info.fields.map((f) =>
            f.type === "checkbox" ? (
              <label key={f.key} className="flex items-start gap-2">
                <input name={f.key} type="checkbox" value="1" className="mt-1" />
                <span>
                  <span className="text-sm text-text-2">{f.label}</span>
                  {f.hint && <span className="text-xs text-text-3 block">{f.hint}</span>}
                </span>
              </label>
            ) : (
              <label key={f.key} className="block space-y-1">
                <span className="text-sm text-text-2">{f.label}</span>
                <input
                  name={f.key}
                  type={f.type === "text" ? "text" : "password"}
                  autoComplete="off"
                  className="input"
                  required={!f.label.includes("(opțional)")}
                />
                {f.hint && <span className="text-xs text-text-3 block">{f.hint}</span>}
              </label>
            ),
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
          <button className="btn" disabled={pending}>
            {pending ? "Verific și aduc ultimele 90 de zile..." : `Conectează ${info.name}`}
          </button>
        </>
      )}
    </form>
  );
}
