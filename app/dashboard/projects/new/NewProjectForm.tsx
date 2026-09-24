"use client";

import { useActionState } from "react";
import { createProject } from "@/app/dashboard/actions";

export function NewProjectForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [error, action, pending] = useActionState(createProject, null);

  return (
    <form action={action} className="card p-5 space-y-4">
      {orgs.length > 1 ? (
        <label className="block space-y-1">
          <span className="text-sm text-text-2">Organizație</span>
          <select name="organizationId" className="input">
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <input type="hidden" name="organizationId" value={orgs[0].id} />
      )}
      <label className="block space-y-1">
        <span className="text-sm text-text-2">Nume proiect</span>
        <input name="name" className="input" placeholder="Tablou.net" required />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-text-2">Domeniu (opțional)</span>
        <input name="domain" className="input" placeholder="tablou.net" />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-text-2">Monedă</span>
        <select name="currency" className="input" defaultValue="RON">
          <option>RON</option>
          <option>EUR</option>
          <option>USD</option>
        </select>
      </label>
      {error && <p className="text-sm text-bad">{error}</p>}
      <button className="btn" disabled={pending}>
        {pending ? "Se creează..." : "Creează proiectul"}
      </button>
    </form>
  );
}
