"use client";

import { useActionState } from "react";
import { Send } from "lucide-react";
import { sendTestReport } from "./actions";

export function SendTestButton() {
  const [msg, action, pending] = useActionState(sendTestReport, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button className="btn" disabled={pending}>
        <Send size={14} /> {pending ? "Se trimite…" : "Trimite acum raportul de test"}
      </button>
      {msg && <span className="text-sm text-text-2" role="status">{msg}</span>}
    </form>
  );
}
