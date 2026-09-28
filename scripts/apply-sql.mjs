// Aplica un fisier SQL din prisma/sql/ pe baza din DATABASE_URL, in schema din ?schema=... (ex. mydashboard).
// Folosit in loc de `prisma db push` pe baza comuna: fisierul e revizuit inainte si contine doar adaugari.
//   DATABASE_URL="postgresql://...?schema=mydashboard" node scripts/apply-sql.mjs prisma/sql/2026-09-28_gsc_bani.sql
// Nu afiseaza parola sau adresa bazei.
import fs from "fs";
import pg from "pg";

const file = process.argv[2];
const url = process.env.DATABASE_URL;
if (!file || !url) {
  console.error("Folosire: DATABASE_URL=... node scripts/apply-sql.mjs <fisier.sql>");
  process.exit(1);
}
const sql = fs.readFileSync(file, "utf8");
if (/\b(drop|truncate|rename)\b|\balter\s+column\b|^\s*delete\s/im.test(sql.replace(/--.*$/gm, ""))) {
  console.error("Fisierul contine operatii distructive (DROP/TRUNCATE/RENAME/ALTER COLUMN/DELETE). Oprit.");
  process.exit(1);
}
const u = new URL(url);
const schema = u.searchParams.get("schema");
u.searchParams.delete("schema");
if (schema && !/^[A-Za-z0-9_]+$/.test(schema)) throw new Error("schema invalida");

const client = new pg.Client({ connectionString: u.toString() });
await client.connect();
try {
  if (schema) await client.query(`SET search_path TO "${schema}"`);
  await client.query(sql);
  console.log(`Aplicat ${file}${schema ? ` în schema ${schema}` : ""}.`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("Eroare, nimic nu s-a aplicat:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
