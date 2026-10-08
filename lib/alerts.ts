import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { type AlertExplanation, alertSubject, explainAlert, explanationLines, isLocalDevAlert } from "@/lib/alert-explain";
import { ensureAiExplanation } from "@/lib/alert-ai";

// Alertele pe e-mail pentru proprietar: site picat, credite terminate la un furnizor, erori importante.
// Acelasi tip de alerta pleaca cel mult o data pe ora; cand problema dispare trimitem „si-a revenit”.
const TO = () => process.env.ALERT_EMAIL || "contact@mydashboard.ro";
const FROM = "mydashboard <alerte@mydashboard.ro>";
const REPEAT_MS = 60 * 60 * 1000;

export type AlertKind = "down" | "credits" | "error" | "sync" | "traffic" | "voice";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export async function sendEmail(subject: string, html: string, to: string = TO()): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

const SEV_COLOR: Record<string, string> = { Urgent: "#b91c1c", Important: "#c2410c", Mic: "#4b5563" };

// E-mailul unei alerte: intai explicatia pe intelesul tuturor, apoi textul tehnic (mic, gri, la final)
export function alertEmailHtml(project: string | null | undefined, e: AlertExplanation, technical: string, footer: string) {
  const color = SEV_COLOR[e.severity] ?? "#b91c1c";
  const rows = explanationLines(e)
    .map(([k, v]) => `<p style="font-size:15px;color:#222;margin:0 0 10px"><b>${esc(k)}</b><br>${esc(v)}</p>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;max-width:560px">
     <h2 style="color:${color};margin:0 0 12px">${esc(alertSubject(project, e))}</h2>
     ${rows}
     <div style="margin-top:16px;border-top:1px solid #eee;padding-top:8px;color:#888;font-size:12px">
       <div style="font-weight:bold;margin-bottom:4px">Detalii tehnice (pentru programator)</div>
       <div style="font-family:monospace;white-space:pre-wrap;word-break:break-word">${esc(technical)}</div>
     </div>
     <p style="color:#888;font-size:12px">${footer}</p>
   </div>`;
}

// Problema e activa: e-mail la prima aparitie si apoi cel mult o data pe ora.
// Erorile venite de pe calculatorul unui programator (C:\Users\..., .next/dev) se salveaza direct ca rezolvate, fara e-mail: „test local — ignorat”.
export async function raiseAlert(a: { key: string; kind: AlertKind; project?: string | null; message: string; env?: string | null }) {
  const now = new Date();
  const message = a.message.slice(0, 1000);
  if (isLocalDevAlert(message, a.env)) {
    await prisma.alertState.upsert({
      where: { key: a.key },
      create: { key: a.key, kind: a.kind, project: a.project ?? null, message, active: false, failures: 1 },
      update: { kind: a.kind, project: a.project ?? null, message, active: false, failures: { increment: 1 } },
    });
    return { sent: false, ignored: true };
  }
  const prev = await prisma.alertState.findUnique({ where: { key: a.key } });
  const due = !prev || !prev.active || !prev.lastSentAt || now.getTime() - prev.lastSentAt.getTime() >= REPEAT_MS;
  // randul intai (fara e-mail), ca explicatia AI sa se poata salva pe el
  await prisma.alertState.upsert({
    where: { key: a.key },
    create: { key: a.key, kind: a.kind, project: a.project ?? null, message, active: true, failures: 1 },
    update: { kind: a.kind, project: a.project ?? null, message, active: true, failures: { increment: 1 } },
  });
  let sent = false;
  if (due) {
    await ensureAiExplanation(a.key); // doar daca regulile nu stiu cauza; limitat pe ora
    const row = await prisma.alertState.findUnique({ where: { key: a.key }, select: { explanation: true } });
    const e = explainAlert({ kind: a.kind, project: a.project, message, explanation: row?.explanation });
    sent = await sendEmail(
      alertSubject(a.project, e),
      alertEmailHtml(
        a.project,
        e,
        message,
        `${now.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })} · dacă problema continuă, primești din nou peste o oră · <a href="https://mydashboard.ro/dashboard/alerte">Alerte în mydashboard</a>`,
      ),
    );
    if (sent) await prisma.alertState.update({ where: { key: a.key }, data: { lastSentAt: now } });
  }
  return { sent, ignored: false };
}

// Problema a disparut: un singur e-mail „si-a revenit” (doar daca anuntasem problema)
export async function resolveAlert(key: string, message: string) {
  const prev = await prisma.alertState.findUnique({ where: { key } });
  if (!prev?.active) return;
  await prisma.alertState.update({ where: { key }, data: { active: false, failures: 0 } });
  if (prev.lastSentAt) {
    const e = explainAlert(prev);
    await sendEmail(
      `Rezolvat: ${alertSubject(prev.project, e).replace(/ \((Urgent|Important|Mic)\)$/, "")}`,
      `<div style="font-family:Arial,sans-serif"><h2 style="color:#15803d;margin:0 0 8px">Și-a revenit</h2><p>${esc(message)}</p></div>`,
    );
  }
}

// Tokenul unei aplicatii pentru /api/alert: HMAC(CRON_SECRET, numele proiectului) - fiecare aplicatie are altul
export const alertToken = (project: string) =>
  crypto.createHmac("sha256", process.env.CRON_SECRET || "").update(`alert:${project}`).digest("hex");
