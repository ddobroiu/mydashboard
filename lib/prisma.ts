import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };

// Schema din DATABASE_URL (ex. ?schema=mydashboard). Adaptorul pg nu o citeste
// singur din URL, asa ca o dam explicit; altfel tabelele ar ajunge in "public".
export function schemaFromUrl(url: string): string | undefined {
  try {
    const schema = new URL(url).searchParams.get("schema");
    return schema && /^[A-Za-z0-9_]+$/.test(schema) ? schema : undefined;
  } catch {
    return undefined;
  }
}

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL lipseste din .env");
  const adapter = new PrismaPg(new Pool({ connectionString }), { schema: schemaFromUrl(connectionString) });
  return new PrismaClient({ adapter, log: ["error"] });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
