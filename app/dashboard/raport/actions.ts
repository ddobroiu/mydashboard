"use server";

import { requireUser } from "@/lib/access";
import { sendEmail } from "@/lib/alerts";
import { buildDailyReport, renderDailyReport, reportSubject } from "@/lib/daily-report";

// Butonul „Trimite acum raportul de test”: acelasi e-mail ca dimineata, trimis imediat
export async function sendTestReport(): Promise<string> {
  await requireUser();
  if (!process.env.RESEND_API_KEY) return "Nu e setată cheia Resend (RESEND_API_KEY), e-mailul nu poate pleca.";
  const report = await buildDailyReport();
  const ok = await sendEmail(`[test] ${reportSubject(report)}`, renderDailyReport(report, process.env.AUTH_URL || undefined));
  return ok ? `Trimis la ${process.env.ALERT_EMAIL || "contact@mydashboard.ro"}.` : "Nu s-a putut trimite (Resend a refuzat). Încearcă din nou peste un minut.";
}
