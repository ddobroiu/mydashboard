"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, action, pending] = useActionState(login, null);

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <form action={action} className="card w-full max-w-sm p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold">MyDashboard</h1>
          <p className="text-sm text-text-2">Intră în cont</p>
        </div>
        <label className="block space-y-1">
          <span className="text-sm text-text-2">Email</span>
          <input name="email" type="email" required autoComplete="email" className="input" />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-text-2">Parolă</span>
          <input name="password" type="password" required autoComplete="current-password" className="input" />
        </label>
        {error && <p className="text-sm text-bad">{error}</p>}
        <button className="btn w-full justify-center" disabled={pending}>
          {pending ? "Se verifică..." : "Intră"}
        </button>
      </form>
    </main>
  );
}
