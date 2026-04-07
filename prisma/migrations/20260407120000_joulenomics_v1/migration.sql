-- ═══════════════════════════════════════════════════════════════════
-- Joulenomics v1 Migration
-- ═══════════════════════════════════════════════════════════════════
-- Transforms the init schema (coins DOUBLE PRECISION as kJ float,
-- CoinTransaction table) into the Joulenomics v1 schema
-- (joulesBalance Decimal(20,4) as joules, LedgerEntry infrastructure,
-- bootstrap pool tables).
--
-- Atomicity: Prisma Migrate wraps this entire file in an implicit
-- transaction on PostgreSQL. Do NOT add explicit BEGIN/COMMIT markers.
-- Verified empirically via the atomicity probe step in
-- docs/MIGRATION_PLAN.md before real test runs.
--
-- Pre-conditions:
--   - Migration 20260403170246_init is applied.
--   - CoinTransaction rows have been exported to
--     docs/migration-archives/coin_transaction_dump_<date>.json.gz
--     (operator step, see runbook).
--   - schema.prisma includes OPENING_BALANCE in the LedgerEntryType enum.
--   - No views, triggers, matviews, rules, or external FKs depend on
--     User.coins or CoinTransaction (verified via runbook dependency
--     check queries: confirmed clean against Neon main as of 2026-04-07).
--   - Signups are paused for the duration of the migration window
--     (the aggregate counterparty description in step 6b hardcodes
--     a snapshot of the user count and total at authorship time).
--
-- Post-conditions:
--   - Every real user has joulesBalance = ROUND(coins * 1000) as Decimal.
--   - Every real user with joulesBalance != 0 has exactly one
--     OPENING_BALANCE ledger entry (id = 'openbal_' || user.id).
--   - Treasury system user exists (id='treasury_system', userNumber=0)
--     with joulesBalance = -SUM(real users' joulesBalance).
--   - Treasury has exactly one OPENING_BALANCE counterparty entry
--     (id = 'openbal_treasury_counterparty').
--   - "coins" column is dropped from "User".
--   - "CoinTransaction" table is dropped.
--   - BootstrapPool, ActiveUserCountDaily, CronRunLog tables exist, empty.
--   - LedgerEntryType enum exists with all 20 values.
--   - All 5 integrity rules pass (Rule 5 trivially — no BootstrapPool
--     row exists yet; bootstrap pool is seeded by a separate script).
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Create LedgerEntryType enum ─────────────────────────────────
CREATE TYPE "LedgerEntryType" AS ENUM (
  'COMPUTE_FEE',
  'RATING_STAKE',
  'STAKE_SLASH',
  'AGENT_REGISTRATION_FEE',
  'BOOST_FEE',
  'CREATOR_REWARD',
  'CURATOR_REWARD',
  'ENGAGEMENT_BONUS',
  'UPLOAD_REWARD',
  'REFERRAL_BONUS',
  'LEADERBOARD_BONUS',
  'GENESIS_BONUS',
  'FAUCET_GRANT',
  'STAKE_RETURN',
  'STAKE_BONUS',
  'REGEN_DRIP',
  'DAILY_LOGIN_BONUS',
  'RATE_EARN_FLAT',
  'PRE_SCALE_POST_GRANT',
  'OPENING_BALANCE'
);

-- ─── 2. Additive DDL on User ────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "joulesBalance" DECIMAL(20,4) NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lastLoginBonusDate" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "ratingsSinceLastPost" INTEGER NOT NULL DEFAULT 0;

-- ─── 3. Create new tables ───────────────────────────────────────────
CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "entryType" "LedgerEntryType" NOT NULL,
  "amount" DECIMAL(20,4) NOT NULL,
  "balanceAfter" DECIMAL(20,4) NOT NULL,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerEntry_userId_createdAt_idx"
  ON "LedgerEntry"("userId", "createdAt");

CREATE INDEX "LedgerEntry_entryType_idx"
  ON "LedgerEntry"("entryType");

ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BootstrapPool" (
  "poolId" TEXT NOT NULL,
  "totalMintedKj" BIGINT NOT NULL,
  "remainingKj" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),

  CONSTRAINT "BootstrapPool_pkey" PRIMARY KEY ("poolId")
);

CREATE TABLE "ActiveUserCountDaily" (
  "date" DATE NOT NULL,
  "activeUsers" INTEGER NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ActiveUserCountDaily_pkey" PRIMARY KEY ("date")
);

CREATE TABLE "CronRunLog" (
  "id" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "bucketKey" TEXT NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CronRunLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CronRunLog_jobName_bucketKey_key"
  ON "CronRunLog"("jobName", "bucketKey");

-- ─── 4a. Defensive guard: refuse to migrate if any user has negative coins
-- Runs BEFORE any destructive change. RAISE EXCEPTION rolls back the
-- entire migration transaction with a clear, human-readable error.
-- Operator pre-verified zero negative-coin users on prod main as of
-- 2026-04-07; this guard is the safety net for the Neon test branch
-- run (clones prod state) and any future re-run.
DO $$
DECLARE
  negative_count INT;
BEGIN
  SELECT COUNT(*) INTO negative_count FROM "User" WHERE "coins" < 0;
  IF negative_count > 0 THEN
    RAISE EXCEPTION 'Migration aborted: % user(s) have negative coins values. Investigate before re-running.', negative_count;
  END IF;
END $$;

-- ─── 4b. Data transform: coins (kJ float) → joulesBalance (J Decimal) ─
-- ROUND before cast to avoid float→decimal precision artifacts. All
-- current 15 users have coins values with ≤1 decimal place in kJ, so
-- ROUND(coins * 1000) yields exact whole joules.
UPDATE "User"
SET "joulesBalance" = ROUND(COALESCE("coins", 0) * 1000)::DECIMAL(20,4);

-- ─── 5. Create treasury system user ─────────────────────────────────
-- userNumber=0 is reserved for treasury; real users start at 1.
-- Email uses the RFC-reserved .internal TLD so it can never collide
-- with a real signup. active=false marks this as a non-user row.
-- Note: "coins" column is intentionally omitted. It still exists at
-- this point in the migration (dropped in step 7) but is NOT NULL
-- DEFAULT 0, so the INSERT relies on the default. Treasury will never
-- have a meaningful "coins" value because the column is dropped
-- before the migration commits.
INSERT INTO "User" (
  "id",
  "username",
  "email",
  "joulesBalance",
  "userNumber",
  "referralCode",
  "active",
  "ratingsSinceLastPost"
) VALUES (
  'treasury_system',
  '_treasury',
  'treasury@system.joulegram.internal',
  0,
  0,
  'treasury_system_code',
  false,
  0
);

-- ─── 6a. Opening balance entries for every real user ────────────────
-- One OPENING_BALANCE entry per real user with a non-zero balance.
-- The != 0 filter (rather than > 0) defensively handles any
-- hypothetical negative balance — a negative OPENING_BALANCE is
-- allowed because OPENING_BALANCE is a neutral category (like
-- ADJUSTMENT), so this preserves Rule #4 (per-user reproducibility)
-- regardless of sign. Deterministic IDs ('openbal_' + user.id)
-- prevent accidental re-running and make audit filtering trivial.
INSERT INTO "LedgerEntry" (
  "id",
  "userId",
  "entryType",
  "amount",
  "balanceAfter",
  "referenceType",
  "referenceId",
  "description",
  "createdAt"
)
SELECT
  'openbal_' || "id",
  "id",
  'OPENING_BALANCE'::"LedgerEntryType",
  "joulesBalance",
  "joulesBalance",
  'migration',
  'joulenomics_v1',
  'Joulenomics v1 opening balance (migrated from coins * 1000)',
  CURRENT_TIMESTAMP
FROM "User"
WHERE "id" != 'treasury_system'
  AND "joulesBalance" != 0;

-- ─── 6b. Single aggregate treasury counterparty entry ───────────────
-- Rule #3 requires global SUM(amount) = 0, not per-pair matching.
-- One aggregate row is sufficient and cheaper than N paired rows.
-- The amount uses a dynamic SUM so the actual ledger value is always
-- correct even if the user count drifts; the description hardcodes
-- a snapshot for human auditing (snapshot must be re-validated by
-- the runbook's pre-deploy SELECT before this migration is applied).
INSERT INTO "LedgerEntry" (
  "id",
  "userId",
  "entryType",
  "amount",
  "balanceAfter",
  "referenceType",
  "referenceId",
  "description",
  "createdAt"
)
SELECT
  'openbal_treasury_counterparty',
  'treasury_system',
  'OPENING_BALANCE'::"LedgerEntryType",
  -COALESCE(SUM("joulesBalance"), 0),
  -COALESCE(SUM("joulesBalance"), 0),
  'migration',
  'joulenomics_v1',
  'Joulenomics v1: aggregate treasury counterparty for 15 opening balance credits totaling 27715100 J. Per-user counterparts intentionally aggregated; see migration 20260407120000_joulenomics_v1.',
  CURRENT_TIMESTAMP
FROM "User"
WHERE "id" != 'treasury_system';

-- ─── 6c. Sync treasury joulesBalance to match its ledger entry ──────
-- Self-referential UPDATE: the subquery is evaluated against the
-- table state at statement start, so it correctly sums the real
-- users and excludes treasury (which is still at 0 from step 5).
UPDATE "User"
SET "joulesBalance" = -(
  SELECT COALESCE(SUM("joulesBalance"), 0)
  FROM "User"
  WHERE "id" != 'treasury_system'
)
WHERE "id" = 'treasury_system';

-- ─── 7. Destructive DDL: drop legacy columns and tables ─────────────
-- Safe to drop CoinTransaction first: its only FK is back to User and
-- dropping the table also drops the FK. Other dependency types (views,
-- triggers, matviews, rules, external FKs) are verified absent by the
-- runbook's pre-deploy dependency check queries (confirmed clean
-- against Neon main 2026-04-07).
DROP TABLE "CoinTransaction";

-- Finally drop the legacy coins column. All data has been migrated
-- into joulesBalance and written to LedgerEntry as opening balances.
ALTER TABLE "User" DROP COLUMN "coins";
