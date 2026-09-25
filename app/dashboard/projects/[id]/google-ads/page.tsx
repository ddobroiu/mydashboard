import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireProject } from "@/lib/access";
import { decryptJson } from "@/lib/crypto";
import { googleAdsScript, type GoogleAdsCredentials } from "@/lib/integrations/google-ads";
import { CopyButton } from "@/components/TrackingForms";

const BASE = (process.env.AUTH_URL || "https://mydashboard.ro").replace(/\/+$/, "");

const fmtTime = (d: Date) =>
  d.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest", dateStyle: "short", timeStyle: "short" });

// Scriptul de pus in contul Google Ads (contine cheia conexiunii, doar pentru admini)
export default async function GoogleAdsScriptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ c?: string }>;
}) {
  const { id } = await params;
  const { c } = await searchParams;
  const { project } = await requireProject(id, "ADMIN");
  const conn = c
    ? await prisma.connection.findFirst({ where: { id: c, projectId: project.id, provider: "GOOGLE_ADS" } })
    : null;
  if (!conn) notFound();

  const creds = decryptJson<GoogleAdsCredentials>(conn.credentials);
  const script = googleAdsScript(`${BASE}/api/ingest/google-ads`, `${conn.id}.${creds.scriptSecret}`);

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href={`/dashboard/projects/${project.id}?tab=conexiuni`} className="inline-flex items-center gap-1 text-sm text-text-2">
        <ArrowLeft size={14} /> {project.name}
      </Link>
      <h1 className="text-2xl font-semibold">Google Ads → mydashboard</h1>

      <div className="card p-4 text-sm space-y-2">
        <p>
          Scriptul rulează în contul tău Google Ads și trimite aici cheltuiala pe fiecare campanie, pe zi. Nu trebuie nicio
          aprobare de la Google.
        </p>
        <ol className="list-decimal pl-5 space-y-1 text-text-2">
          <li>
            În Google Ads: <b>Instrumente</b> → <b>Acțiuni în bloc</b> → <b>Scripturi</b> → butonul <b>+</b> → <b>Script nou</b>.
          </li>
          <li>Șterge tot ce e în editor, apasă <b>Copiază</b> mai jos și lipește scriptul.</li>
          <li>
            Apasă <b>Autorizează</b> (o singură dată), apoi <b>Previzualizare</b>: în jurnal trebuie să apară <code>200</code>.
          </li>
          <li>
            Salvează și, la <b>Frecvență</b>, alege <b>Din oră în oră</b>.
          </li>
        </ol>
        <p className="text-text-3">
          {conn.lastSyncAt ? `Ultimele date primite: ${fmtTime(conn.lastSyncAt)}.` : "Încă n-a trimis nimic."} Scriptul conține
          cheia acestei conexiuni: nu-l publica. Dacă ștergi conexiunea, cheia nu mai merge.
        </p>
      </div>

      <div className="card p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Scriptul</h2>
          <CopyButton text={script} />
        </div>
        <pre className="max-h-96 overflow-auto rounded-md bg-bg border border-border p-3 text-xs">{script}</pre>
      </div>
    </div>
  );
}
