import Link from "next/link";
import { ArrowRight, Cpu, Mail, Megaphone, Plug, Plus } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";

export const dynamic = "force-dynamic";

function Row({ href, icon: Icon, title, text }: { href: string; icon: typeof Cpu; title: string; text: string }) {
  return (
    <Link href={href} className="flex items-center gap-4 px-5 py-4 hover:bg-bg">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-bg text-text-2">
        <Icon size={18} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-text-2">{text}</span>
      </span>
      <ArrowRight size={16} className="shrink-0 text-text-3" aria-hidden />
    </Link>
  );
}

// Setari si paginile de detaliu (scoase din meniul principal ca sa ramana simplu)
export default async function Setari() {
  const userId = await requireUser();
  const projects = await projectsForUser(userId);
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Setări și detalii</h1>
        <p className="text-sm text-text-2">Legăturile cu plățile și reclamele, costurile AI și raportul de dimineață.</p>
      </div>

      <section className="card divide-y divide-border">
        <Row href="/dashboard/setari/google-ads" icon={Megaphone} title="Google Ads" text="Scriptul pentru contul de reclame și ce campanie la ce site merge." />
        <Row href="/dashboard/ai" icon={Cpu} title="Costuri AI" text="Cât costă OpenAI, Anthropic și Replicate, pe fiecare site." />
        <Row href="/dashboard/raport" icon={Mail} title="Raportul de dimineață" text="E-mailul zilnic cu cifrele de ieri." />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-text-3">Legături pe fiecare afacere (Stripe, Meta, Oblio...)</h2>
        <div className="card divide-y divide-border">
          {projects.map((p) => (
            <Row key={p.id} href={`/dashboard/projects/${p.id}?tab=conexiuni`} icon={Plug} title={p.name} text={`${p.connections.length === 0 ? "nicio legătură" : p.connections.length === 1 ? "o legătură" : `${p.connections.length} legături`}${p.domain ? ` · ${p.domain}` : ""}`} />
          ))}
          <Row href="/dashboard/projects/new" icon={Plus} title="Adaugă o afacere" text="Un site nou în mydashboard." />
        </div>
      </section>
    </div>
  );
}
