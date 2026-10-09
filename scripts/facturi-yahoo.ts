// Facturile de cost din Yahoo pentru proiectele din mydashboard (servere, domenii, AI, reclame...) -> CostInvoice + PDF.
// Lista vine din scanarea Yahoo (doar citire): python -I _deploy/facturi-yahoo.py -> Desktop/cloude/facturi/facturi-yahoo.json
// (aici intra doar randurile cu dest = "mydashboard"; cele de print merg in adminul ShopPrint).
//
//   npx tsx scripts/facturi-yahoo.ts            PROBA: arata ce s-ar crea, pe proiect (nu scrie nimic)
//   npx tsx scripts/facturi-yahoo.ts --scrie    SCRIE in baza din DATABASE_URL (productia: doar cu OK-ul proprietarului)
//   optiuni: --fisier <cale.json>
//
// Inainte de --scrie pe productie: tabelele din prisma/sql/2026-10-10_facturi_cost.sql (scripts/apply-sql.mjs).
// Proiectul: dupa cheia din lista (anexa1, constelatii, mydashboard...) -> Project dupa domeniu / nume; fara cheie = comun.
// Idempotent: sourceKey = cheia „yahoo:...” (Message-ID + hash fisier), unica in tabel.
import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const WRITE = args.includes("--scrie");
const i = args.indexOf("--fisier");
const FILE = i >= 0 ? args[i + 1] : path.join(os.homedir(), "Desktop", "cloude", "facturi", "facturi-yahoo.json");

type Item = {
  key: string; supplier: string; number: string | null; issueDate: string; total: number | null; vat: number | null; currency: string;
  dest: string; project: string | null; categoryMydashboard: string; file: string; fileName: string; isPdf: boolean; verify: string[];
};

const clean = (d: string | null) => String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const DOMAIN: Record<string, string> = { "3dview": "3dview.ai", menu3d: "menu3d.ai", edu3d: "edu3d.ro" };

async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8")) as { items: Item[] };
  const items = data.items.filter((x) => x.dest === "mydashboard");
  const { MAIL_PROJECTS, isProjectKey } = await import("../lib/email-inbox/projects");
  const { mimeOf } = await import("../lib/cost-invoices");

  let projects: { id: string; name: string; domain: string | null; organizationId: string }[] = [];
  let done = new Set<string>();
  let dbOk = true;
  const { prisma } = await import("../lib/prisma");
  try {
    projects = await prisma.project.findMany({ select: { id: true, name: true, domain: true, organizationId: true } });
    done = new Set((await prisma.costInvoice.findMany({ where: { sourceKey: { in: items.map((x) => x.key) } }, select: { sourceKey: true } })).map((r) => r.sourceKey!));
  } catch (e) {
    dbOk = false;
    console.log(`Baza nu poate fi citita (${String(e instanceof Error ? e.message : e).slice(0, 140)}): proba arata doar planul.`);
    if (WRITE) process.exit(1);
  }
  const find = (key: string | null) => {
    if (!key) return undefined;
    const dom = isProjectKey(key) ? MAIL_PROJECTS[key].domain : DOMAIN[key];
    return projects.find((p) => dom && clean(p.domain) === dom) || projects.find((p) => p.name.trim().toLowerCase() === key);
  };
  // organizatia „comuna” = cea cu cele mai multe proiecte
  const orgCount = new Map<string, number>();
  for (const p of projects) orgCount.set(p.organizationId, (orgCount.get(p.organizationId) ?? 0) + 1);
  const mainOrg = [...orgCount].sort((a, b) => b[1] - a[1])[0]?.[0];

  const rows: Record<string, unknown>[] = [];
  let created = 0, already = 0, skipped = 0;
  for (const it of items) {
    const p = find(it.project);
    const target = it.project ? (p ? p.name : `${it.project} (proiect negasit -> comun)`) : "comun";
    const base = { key: it.key, supplier: it.supplier, number: it.number, issueDate: it.issueDate, total: it.total, currency: it.currency, project: target };
    if (it.total === null) { skipped++; rows.push({ ...base, action: "sarit: suma necitita" }); continue; }
    if (done.has(it.key)) { already++; rows.push({ ...base, action: "deja importata" }); continue; }
    rows.push({ ...base, action: "noua", verify: it.verify });
    if (!WRITE) { created++; continue; }
    const organizationId = p?.organizationId || mainOrg;
    if (!organizationId) throw new Error("nicio organizatie in baza");
    const buf = fs.readFileSync(it.file);
    await prisma.costInvoice.create({
      data: {
        organizationId, projectId: p?.id ?? null, supplier: it.supplier, category: it.categoryMydashboard || "altele", number: it.number,
        issueDate: new Date(`${it.issueDate}T00:00:00Z`), total: it.total, vat: it.vat, currency: it.currency,
        note: it.verify?.length ? it.verify.join(" · ").slice(0, 300) : null, source: "yahoo", sourceKey: it.key,
        fileName: it.fileName, fileMime: it.isPdf ? "application/pdf" : mimeOf(it.fileName).replace("application/octet-stream", "text/html"),
        file: { create: { data: buf, size: buf.length } },
      },
    });
    created++;
  }
  const out = path.join(path.dirname(FILE), "potriviri-mydashboard.json");
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), write: WRITE, dbOk, rows }, null, 1));
  console.log(`${WRITE ? "SCRIS" : "PROBA"} mydashboard: ${items.length} facturi · ${created} ${WRITE ? "create" : "noi"} · ${already} deja importate · ${skipped} sarite`);
  console.log(`Detalii: ${out}`);
  await prisma.$disconnect().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
