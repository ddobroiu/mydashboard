-- 2026-09-28: Google Search Console, costuri fixe, comision Stripe (+ tabelele/coloanele din commit-urile
-- anterioare care nu ajunsesera inca in baza de productie: AlertState, AdSpendDaily.clipId, SocialPost.videoId/videoUrl).
-- DOAR ADAUGA (tabele noi, coloane noi care accepta NULL). Nu sterge si nu modifica nimic existent.
-- Generat cu:  prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- Aplicat cu:  prisma db execute --file prisma/sql/2026-09-28_gsc_bani.sql   (DATABASE_URL de productie)
BEGIN;
-- AlterTable
ALTER TABLE "AdSpendDaily" ADD COLUMN     "clipId" TEXT;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "videoId" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "fee" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "GscSite" (
    "projectId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastDate" DATE,
    "periodStart" DATE,
    "periodEnd" DATE,

    CONSTRAINT "GscSite_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "GscDaily" (
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscDaily_pkey" PRIMARY KEY ("projectId","date")
);

-- CreateTable
CREATE TABLE "GscTop" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "GscTop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedCost" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "monthly" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "toVerify" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FixedCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertState" (
    "key" TEXT NOT NULL,
    "project" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "GscTop_projectId_kind_period_idx" ON "GscTop"("projectId", "kind", "period");

-- CreateIndex
CREATE INDEX "FixedCost_organizationId_idx" ON "FixedCost"("organizationId");

-- CreateIndex
CREATE INDEX "FixedCost_projectId_idx" ON "FixedCost"("projectId");

-- AddForeignKey
ALTER TABLE "GscSite" ADD CONSTRAINT "GscSite_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscDaily" ADD CONSTRAINT "GscDaily_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GscTop" ADD CONSTRAINT "GscTop_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCost" ADD CONSTRAINT "FixedCost_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedCost" ADD CONSTRAINT "FixedCost_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Costuri fixe implicite (comune, impartite egal intre proiecte), de verificat de proprietar
INSERT INTO "FixedCost" ("id", "organizationId", "projectId", "name", "monthly", "currency", "toVerify", "updatedAt")
SELECT 'seed-' || md5(o."id" || d.name), o."id", NULL, d.name, d.monthly, 'EUR', true, CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES ('Server Hetzner aplicații', 5.00), ('Server print', 5.00), ('Server dezvoltare', 5.00)) AS d(name, monthly)
WHERE NOT EXISTS (SELECT 1 FROM "FixedCost" f WHERE f."organizationId" = o."id")
ON CONFLICT ("id") DO NOTHING;

COMMIT;
