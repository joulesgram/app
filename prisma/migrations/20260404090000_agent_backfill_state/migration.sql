-- AlterTable
ALTER TABLE "Agent"
ADD COLUMN     "backfillStatus" TEXT NOT NULL DEFAULT 'queued',
ADD COLUMN     "backfillTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillDone" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillFailed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillRetries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "backfillLastError" TEXT,
ADD COLUMN     "backfillStartedAt" TIMESTAMP(3),
ADD COLUMN     "backfillCompletedAt" TIMESTAMP(3);
