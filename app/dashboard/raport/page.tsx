import { requireUser } from "@/lib/access";
import { buildDailyReport, renderDailyReport, reportSubject } from "@/lib/daily-report";
import { SendTestButton } from "./SendTestButton";

export const dynamic = "force-dynamic";

// Cum arata e-mailul de dimineata, cu datele de acum
export default async function ReportPage() {
  await requireUser();
  const report = await buildDailyReport();
  const html = renderDailyReport(report, process.env.AUTH_URL || undefined);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Raportul de dimineață</h1>
        <p className="mt-1 text-sm text-text-2">
          Vine pe e-mail în fiecare dimineață la 7:30: ieri față de aceeași zi de săptămâna trecută, plus cifrele din aplicații pe ultimele 24 de ore (conturi, comenzi,
          încasări, facturi neemise). Mai jos e exact ce primești azi.
        </p>
      </div>
      <SendTestButton />
      <div className="card overflow-hidden">
        <div className="border-b border-border px-4 py-2 text-sm text-text-2">
          Subiect: <strong className="text-text">{reportSubject(report)}</strong>
        </div>
        <iframe srcDoc={html} title="Previzualizare raport" className="h-[1400px] w-full bg-white" />
      </div>
    </div>
  );
}
