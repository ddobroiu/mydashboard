"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { addGoal, addLink, addManualSpend } from "@/app/dashboard/projects/[id]/tracking/actions";

export function CopyButton({ text, label = "Copiază" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost py-1 text-sm shrink-0"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 2000);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? "Copiat" : label}
    </button>
  );
}

// Un bloc de text de copiat (snippet, parametri pentru reclame)
export function CopyBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 min-w-0 block rounded-md bg-bg border border-border px-3 py-2 text-xs break-all">{text}</code>
      <CopyButton text={text} />
    </div>
  );
}

function Err({ error }: { error: string | null }) {
  return error ? <p className="text-sm text-bad">{error}</p> : null;
}

export function GoalForm({ projectId }: { projectId: string }) {
  const [error, action, pending] = useActionState(addGoal, null);
  return (
    <form action={action} className="grid sm:grid-cols-[1fr_1fr_8rem_auto] gap-2 items-start">
      <input type="hidden" name="projectId" value={projectId} />
      <input name="name" className="input" placeholder="Nume, ex. Comandă plasată" required />
      <input name="pattern" className="input" placeholder="Adresa conține, ex. /multumim" required />
      <input name="value" className="input" placeholder="Valoare (opț.)" inputMode="decimal" />
      <button className="btn" disabled={pending}>
        {pending ? "Salvez..." : "Adaugă"}
      </button>
      <div className="sm:col-span-4">
        <Err error={error} />
      </div>
    </form>
  );
}

export function LinkForm({ projectId, domain }: { projectId: string; domain: string | null }) {
  const [error, action, pending] = useActionState(addLink, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid sm:grid-cols-2 gap-2">
        <input name="name" className="input" placeholder="Nume, ex. Bio Instagram" required />
        <input
          name="destination"
          className="input"
          placeholder="https://..."
          defaultValue={domain ? `https://${domain.replace(/^https?:\/\//, "")}/` : ""}
          required
        />
      </div>
      <div className="grid sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
        <input name="source" className="input" placeholder="Sursa, ex. instagram" required />
        <input name="medium" className="input" placeholder="Tip, ex. social / influencer / qr" defaultValue="social" />
        <input name="campaign" className="input" placeholder="Campanie (opț.)" />
        <button className="btn" disabled={pending}>
          {pending ? "Creez..." : "Creează link"}
        </button>
      </div>
      <Err error={error} />
    </form>
  );
}

export function SpendForm({ projectId, currency, today }: { projectId: string; currency: string; today: string }) {
  const [error, action, pending] = useActionState(addManualSpend, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="grid sm:grid-cols-[10rem_1fr_9rem_auto] gap-2">
        <input name="date" type="date" className="input" defaultValue={today} required />
        <input name="name" className="input" placeholder="Pe ce, ex. influencer-ana (ca în campania linkului)" required />
        <input name="amount" className="input" placeholder={`Sumă ${currency}`} inputMode="decimal" required />
        <button className="btn" disabled={pending}>
          {pending ? "Salvez..." : "Adaugă"}
        </button>
      </div>
      <Err error={error} />
    </form>
  );
}
