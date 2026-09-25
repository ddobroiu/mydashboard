import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Alertele pe e-mail pentru proprietar: site picat, credite terminate la un furnizor, erori importante.
// Acelasi tip de alerta pleaca cel mult o data pe ora; cand problema dispare trimitem „si-a revenit”.
const TO = () => process.env.ALERT_EMAIL || "contact@mydashboard.ro";
const FROM = "mydashboard <alerte@mydashboard.ro>";
const REPEAT_MS = 60 * 60 * 1000;

export type AlertKind = "down" | "credits" | "error" | "sync";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

async function sendEmail(subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: TO(), subject, html }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

const TITLES: Record<AlertKind, string> = {
  down: "Site picat",
  credits: "Credite terminate",
  error: "Eroare",
  sync: "Conexiune care nu mai merge",
};

// Problema e activa: e-mail la prima aparitie si apoi cel mult o data pe ora
export async function raiseAlert(a: { key: string; kind: AlertKind; project?: string | null; message: string }) {
  const now = new Date();
  const prev = await prisma.alertState.findUnique({ where: { key: a.key } });
  const due = !prev || !prev.active || !prev.lastSentAt || now.getTime() - prev.lastSentAt.getTime() >= REPEAT_MS;
  let sent = false;
  if (due) {
    const title = `${TITLES[a.kind]}${a.project ? ` – ${a.project}` : ""}`;
    sent = await sendEmail(
      `⚠ ${title}`,
      `<div style="font-family:Arial,sans-serif;max-width:560px">
         <h2 style="color:#b91c1c;margin:0 0 8px">${esc(title)}</h2>
         <p style="font-size:15px;color:#222">${esc(a.message)}</p>
         <p style="color:#888;font-size:12px">${now.toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" })} · dacă problema continuă, primești din nou peste o oră · <a href="https://mydashboard.ro/dashboard">mydashboard</a></p>
       </div>`,
    );
  }
  const message = a.message.slice(0, 1000);
  await prisma.alertState.upsert({
    where: { key: a.key },
    create: { key: a.key, kind: a.kind, project: a.project ?? null, message, active: true, failures: 1, lastSentAt: sent ? now : null },
    update: { kind: a.kind, project: a.project ?? null, message, active: true, failures: { increment: 1 }, ...(sent && { lastSentAt: now }) },
  });
  return { sent };
}

// Problema a disparut: un singur e-mail „si-a revenit” (doar daca anuntasem problema)
export async function resolveAlert(key: string, message: string) {
  const prev = await prisma.alertState.findUnique({ where: { key } });
  if (!prev?.active) return;
  await prisma.alertState.update({ where: { key }, data: { active: false, failures: 0 } });
  if (prev.lastSentAt) {
    await sendEmail(
      `✅ Rezolvat${prev.project ? ` – ${prev.project}` : ""}`,
      `<div style="font-family:Arial,sans-serif"><h2 style="color:#15803d;margin:0 0 8px">Și-a revenit</h2><p>${esc(message)}</p></div>`,
    );
  }
}

// Tokenul unei aplicatii pentru /api/alert: HMAC(CRON_SECRET, numele proiectului) - fiecare aplicatie are altul
export const alertToken = (project: string) =>
  crypto.createHmac("sha256", process.env.CRON_SECRET || "").update(`alert:${project}`).digest("hex");
