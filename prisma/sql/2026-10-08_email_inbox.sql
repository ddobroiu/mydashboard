-- 2026-10-08: inboxul E-mail al aplicatiilor (/dashboard/email, /api/operator).
-- DOAR ADAUGA 4 tabele noi (EmailMailbox, EmailThread, EmailMessage, EmailAttachment) + indexuri.
-- Idempotent (IF NOT EXISTS, cheile straine verificate in schema curenta - print are tabele cu aceleasi nume in alta schema).
-- Se poate rula de doua ori. Nu sterge si nu modifica nimic existent.
-- Aplicat cu:  DATABASE_URL="postgresql://...?schema=mydashboard" node scripts/apply-sql.mjs prisma/sql/2026-10-08_email_inbox.sql
BEGIN;
-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailMailbox" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "folder" TEXT NOT NULL DEFAULT 'INBOX',
    "label" TEXT,
    "uidValidity" BIGINT,
    "lastUid" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailThread" (
    "id" TEXT NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "normSubject" TEXT NOT NULL,
    "project" TEXT,
    "category" TEXT NOT NULL DEFAULT 'inbox',
    "tag" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastPreview" TEXT,
    "lastDirection" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "possibleLead" BOOLEAN NOT NULL DEFAULT false,
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "leadSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "mailboxAddress" TEXT NOT NULL,
    "folder" TEXT,
    "uid" INTEGER,
    "uidValidity" BIGINT,
    "direction" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "inReplyTo" TEXT,
    "references" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fromEmail" TEXT,
    "fromName" TEXT,
    "replyTo" TEXT,
    "to" JSONB,
    "cc" JSONB,
    "subject" TEXT,
    "project" TEXT,
    "category" TEXT NOT NULL DEFAULT 'inbox',
    "text" TEXT,
    "html" TEXT,
    "hasRemoteImages" BOOLEAN NOT NULL DEFAULT false,
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "leadSignals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "source" TEXT,
    "sendStatus" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "idx" INTEGER,
    "partId" TEXT,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "contentId" TEXT,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmailMailbox_address_folder_key" ON "EmailMailbox"("address", "folder");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_lastMessageAt_idx" ON "EmailThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_customerEmail_idx" ON "EmailThread"("customerEmail");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_normSubject_idx" ON "EmailThread"("normSubject");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_category_status_idx" ON "EmailThread"("category", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailThread_project_idx" ON "EmailThread"("project");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmailMessage_messageId_key" ON "EmailMessage"("messageId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailMessage_fromEmail_idx" ON "EmailMessage"("fromEmail");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailAttachment_messageId_idx" ON "EmailAttachment"("messageId");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = 'EmailMessage_threadId_fkey' AND n.nspname = current_schema()) THEN
    ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE c.conname = 'EmailAttachment_messageId_fkey' AND n.nspname = current_schema()) THEN
    ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
COMMIT;
