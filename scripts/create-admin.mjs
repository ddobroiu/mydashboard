#!/usr/bin/env node
/**
 * Creeaza (sau reseteaza parola pentru) un utilizator OWNER intr-o organizatie.
 *
 *   npm run create-admin -- email@exemplu.ro "Parola123" "Numele organizatiei"
 *
 * Foloseste DATABASE_URL din .env.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const [email, password, orgName = "Agentia mea"] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Folosire: npm run create-admin -- email@exemplu.ro "parola-min-8-caractere" "Organizatie"');
  process.exit(1);
}

// Schema din DATABASE_URL (?schema=...), ca in lib/prisma.ts
const schema = (() => { try { return new URL(process.env.DATABASE_URL).searchParams.get("schema") || undefined; } catch { return undefined; } })();
const prisma = new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }), { schema }) });

const hash = await bcrypt.hash(password, 12);
const user = await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  update: { password: hash },
  create: { email: email.toLowerCase(), password: hash, emailVerified: new Date(), isSuperAdmin: true },
});

let org = await prisma.organization.findFirst({ where: { name: orgName } });
if (!org) org = await prisma.organization.create({ data: { name: orgName } });

await prisma.membership.upsert({
  where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
  update: { role: "OWNER" },
  create: { userId: user.id, organizationId: org.id, role: "OWNER" },
});

console.log(`OK: ${user.email} este OWNER in "${org.name}"`);
await prisma.$disconnect();
