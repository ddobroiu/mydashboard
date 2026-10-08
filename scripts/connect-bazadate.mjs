// O singura data, DOAR la cererea proprietarului: leaga BazaDate in mydashboard (baza de PRODUCTIE din .env.production).
//  - proiectul „bazadate” (bazadate.ro, lei), daca nu exista
//  - conexiunea Stripe pe contul „Applications”, doar platile cu metadata project=bazadate (liste + pachete API)
// Cheia Stripe se citeste din aplicatii/bazadate-main/.env si se salveaza criptata; nu se afiseaza niciodata.
// Se poate rula de mai multe ori: ce exista deja ramane neschimbat.
//   node scripts/connect-bazadate.mjs            (doar arata ce ar face)
//   node scripts/connect-bazadate.mjs --scrie    (scrie in baza)
import fs from "fs";
import crypto from "crypto";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const E = "c:/Users/Dobroiu/Desktop/siteuri/eu";
const envOf = (file) =>
  Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, "")]),
  );

const WRITE = process.argv.includes("--scrie");
const prod = envOf(`${E}/mydashboard.ro/.env.production`);
const stripeKey = envOf(`${E}/aplicatii/bazadate-main/.env`).STRIPE_SECRET_KEY;
if (!stripeKey) throw new Error("Lipsește STRIPE_SECRET_KEY în bazadate-main/.env");

const key = Buffer.from(prod.ENCRYPTION_KEY, "hex");
const encryptJson = (data) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
};

const schema = new URL(prod.DATABASE_URL).searchParams.get("schema") || undefined;
const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: prod.DATABASE_URL }), { schema }) });

const owner = await prisma.membership.findFirst({ where: { role: "OWNER" }, orderBy: { createdAt: "asc" } });
if (!owner) throw new Error("Nu există OWNER: rulează întâi create-admin");

let project = await prisma.project.findFirst({ where: { organizationId: owner.organizationId, name: { equals: "bazadate", mode: "insensitive" } } });
if (!project) {
  console.log("Proiectul bazadate nu există: îl creez (bazadate.ro, RON).");
  if (WRITE) {
    project = await prisma.project.create({
      data: { organizationId: owner.organizationId, name: "bazadate", domain: "bazadate.ro", currency: "RON", trackingId: crypto.randomBytes(8).toString("hex") },
    });
  }
} else {
  console.log(`Proiectul există: ${project.name} (${project.domain ?? "fără domeniu"}, ${project.currency}).`);
}

const stripe = project ? await prisma.connection.findFirst({ where: { projectId: project.id, provider: "STRIPE" } }) : null;
if (stripe) {
  console.log(`Stripe e deja legat (${stripe.label ?? "fără etichetă"}, stare ${stripe.status}).`);
} else {
  console.log("Leg Stripe (contul Applications, doar plățile cu project=bazadate).");
  if (WRITE && project) {
    await prisma.connection.create({
      data: { projectId: project.id, provider: "STRIPE", label: "contul Applications · proiect bazadate", credentials: encryptJson({ secretKey: stripeKey, project: "bazadate", includeUntagged: "" }) },
    });
  }
}
if (!WRITE) console.log("Nimic scris. Rulează cu --scrie ca să aplici.");
await prisma.$disconnect();
