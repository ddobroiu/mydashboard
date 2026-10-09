-- 2026-10-10: facturile de cost ale proiectelor (servere, domenii, AI, reclame...) + PDF-ul lor.
-- DOAR ADAUGA (doua tabele noi). Nu sterge si nu modifica nimic existent.
-- Aplicat cu:  DATABASE_URL="postgresql://...?schema=mydashboard" node scripts/apply-sql.mjs prisma/sql/2026-10-10_facturi_cost.sql
BEGIN;
CREATE TABLE IF NOT EXISTS "CostInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "supplier" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'altele',
    "number" TEXT,
    "issueDate" DATE NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "vat" DECIMAL(14,2),
    "currency" TEXT NOT NULL DEFAULT 'RON',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceKey" TEXT,
    "fileName" TEXT,
    "fileMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CostInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CostInvoice_sourceKey_key" ON "CostInvoice"("sourceKey");
CREATE INDEX IF NOT EXISTS "CostInvoice_organizationId_issueDate_idx" ON "CostInvoice"("organizationId", "issueDate");
CREATE INDEX IF NOT EXISTS "CostInvoice_projectId_issueDate_idx" ON "CostInvoice"("projectId", "issueDate");

CREATE TABLE IF NOT EXISTS "CostInvoiceFile" (
    "invoiceId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    CONSTRAINT "CostInvoiceFile_pkey" PRIMARY KEY ("invoiceId")
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CostInvoice_organizationId_fkey') THEN
        ALTER TABLE "CostInvoice" ADD CONSTRAINT "CostInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CostInvoice_projectId_fkey') THEN
        ALTER TABLE "CostInvoice" ADD CONSTRAINT "CostInvoice_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CostInvoiceFile_invoiceId_fkey') THEN
        ALTER TABLE "CostInvoiceFile" ADD CONSTRAINT "CostInvoiceFile_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CostInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
COMMIT;
