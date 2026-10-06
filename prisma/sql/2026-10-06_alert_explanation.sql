-- 2026-10-06: explicatia pe intelesul proprietarului pentru alerte (cache pentru explicatia AI).
-- DOAR ADAUGA (doua coloane care accepta NULL). Nu sterge si nu modifica nimic existent.
-- Aplicat cu:  DATABASE_URL="postgresql://...?schema=mydashboard" node scripts/apply-sql.mjs prisma/sql/2026-10-06_alert_explanation.sql
BEGIN;
ALTER TABLE "AlertState" ADD COLUMN IF NOT EXISTS "explanation" JSONB;
ALTER TABLE "AlertState" ADD COLUMN IF NOT EXISTS "explainedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "AlertState_explainedAt_idx" ON "AlertState" ("explainedAt");
COMMIT;
