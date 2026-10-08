-- 2026-10-09: Google Ads pe contul comun (un singur script pentru toate site-urile), impartit pe proiecte dupa numele campaniei.
-- DOAR ADAUGA (doua tabele noi). Nu sterge si nu modifica nimic existent.
-- Aplicat cu:  DATABASE_URL="postgresql://...?schema=mydashboard" node scripts/apply-sql.mjs prisma/sql/2026-10-09_google_ads_cont_comun.sql
BEGIN;
CREATE TABLE IF NOT EXISTS "GoogleAdsAccountDaily" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "spend" DECIMAL(14,2) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoogleAdsAccountDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleAdsAccountDaily_customerId_date_campaignId_key" ON "GoogleAdsAccountDaily"("customerId", "date", "campaignId");
CREATE INDEX IF NOT EXISTS "GoogleAdsAccountDaily_date_idx" ON "GoogleAdsAccountDaily"("date");

CREATE TABLE IF NOT EXISTS "AdsCampaignRule" (
    "id" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdsCampaignRule_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdsCampaignRule_prefix_key" ON "AdsCampaignRule"("prefix");
CREATE INDEX IF NOT EXISTS "AdsCampaignRule_projectId_idx" ON "AdsCampaignRule"("projectId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = 'AdsCampaignRule_projectId_fkey' AND n.nspname = current_schema()) THEN
    ALTER TABLE "AdsCampaignRule" ADD CONSTRAINT "AdsCampaignRule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
COMMIT;
