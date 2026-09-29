"use client";

import { useActionState } from "react";
import { saveAiAccount } from "@/app/dashboard/ai/actions";

// Cheia Admin Anthropic / OpenAI: se verifica, se cripteaza si nu se mai afiseaza niciodata
export function AiKeyForm({
  organizationId,
  provider,
  placeholder,
  hint,
  replace,
}: {
  organizationId: string;
  provider: string;
  placeholder: string;
  hint: string;
  replace: boolean;
}) {
  const [error, action, pending] = useActionState(saveAiAccount, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="provider" value={provider} />
      <div className="flex flex-wrap gap-2">
        <input
          name="adminKey"
          type="password"
          autoComplete="off"
          className="input flex-1 min-w-[220px]"
          placeholder={placeholder}
          required
        />
        <button className="btn" disabled={pending}>
          {pending ? "Verific…" : replace ? "Înlocuiește cheia" : "Salvează cheia"}
        </button>
      </div>
      <p className="text-xs text-text-3">{hint}</p>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}
