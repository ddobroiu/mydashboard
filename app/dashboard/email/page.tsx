import { requireUser } from "@/lib/access";
import EmailInbox from "./EmailInbox";

export const dynamic = "force-dynamic";

// Inboxul tuturor aplicatiilor (ai365, anexa1, bazadate, ...): /dashboard/email?id=<conversatie>&project=<aplicatie>&view=<filtru>
export default async function EmailPage({ searchParams }: { searchParams: Promise<{ id?: string; project?: string; view?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-2xl font-semibold">E-mail</h1>
        <p className="text-sm text-text-2">Căsuțele tuturor aplicațiilor, într-un singur loc. Pe serverul de e-mail nu se schimbă nimic: citit, rezolvat și arhivat sunt doar aici.</p>
      </div>
      <EmailInbox initialId={sp.id} initialProject={sp.project} initialView={sp.view} />
    </div>
  );
}
