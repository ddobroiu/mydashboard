-- 2026-10-09: postarile publicate de _deploy/social-autopost (Facebook / Instagram) intra in mydashboard.
-- DOAR ADAUGA o valoare noua in enumul Provider. Tabela "SocialPost" exista deja (o foloseste si PostingClips);
-- postarile automate stau acolo sub o conexiune ascunsa SOCIAL_AUTOPOST pe fiecare afacere (creata la primul raport).
-- Fara BEGIN/COMMIT: ADD VALUE nu se poate folosi in aceeasi tranzactie in care e adaugat.
-- Aplicat cu:  DATABASE_URL="postgresql://...?schema=mydashboard" node scripts/apply-sql.mjs prisma/sql/2026-10-09_social_autopost.sql
ALTER TYPE "Provider" ADD VALUE IF NOT EXISTS 'SOCIAL_AUTOPOST';
