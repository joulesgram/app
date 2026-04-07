# Joulenomics v1 Migration — Operator Runbook

**Migration:** `prisma/migrations/20260407120000_joulenomics_v1/migration.sql`
**Target branch:** `claude/joulegram-schema-migration-5EfyI`
**Status:** ready for test-branch rehearsal, not yet applied to prod

---

## Purpose

This runbook is the **single source of truth** for how the Joulenomics v1 migration is executed. It takes the prod database from the init schema (`coins DOUBLE PRECISION` as kJ float + `CoinTransaction` table) to the Joulenomics v1 schema (`joulesBalance Decimal(20,4)` as joules + `LedgerEntry` + bootstrap pool infrastructure), preserving every user's balance exactly and leaving the ledger in an integrity-clean state.

**This runbook is authoritative.** If a future migration run deviates from these steps, that deviation is either a bug in the runbook (fix the runbook first, then re-run) or a bug in the deviation (abort and follow the runbook). "The runbook was just suggestions" is not a valid interpretation. The migration is irreversible without a Neon PITR restore — following the runbook exactly is the cheapest insurance.

## Prerequisites

- Neon plan tier is **Launch** or higher (7-day PITR window). Verify in the Neon dashboard under project settings before starting.
- Prod baseline has been captured and saved locally (step a).
- Signups are paused for the duration of the migration window. The migration's step 6b hardcodes a snapshot of user count (15) and sum (27,715,100 J) in the treasury counterparty description; a signup mid-migration will not be reflected in that description (though the dynamic `SUM()` in the same statement will still be correct — the risk is documentation drift, not integrity failure).
- Uninterrupted ~30-minute window.
- Current git branch is `claude/joulegram-schema-migration-5EfyI` with all 5 prompt-1.2 commits pushed to origin.

## Warnings

- **Irreversible without PITR restore.** The migration drops the `coins` column and the `CoinTransaction` table. Recovery paths are (in order of preference) Neon PITR, `pg_dump` restore, manual ledger correction. See the Rollback section.
- **Do NOT run `prisma migrate deploy` against prod until the test branch rehearsal is green.** Steps g–m are mandatory before step n.
- **Do NOT skip the atomicity probe (steps d–f).** It verifies Prisma's implicit transaction wrapping empirically. Without it, a partial-state failure on prod is undetectable until it's too late.

---

## Pre-flight checklist

Before starting, confirm every box:

- [ ] Dependency-check queries returned zero rows on prod `main`: `pg_views`, `pg_trigger`, `pg_matviews` filtered on `"User".coins` and `"CoinTransaction"`. (Operator ran these on 2026-04-07; re-run if any schema objects have been added since.)
- [ ] Negative-coins guard returns zero: `SELECT COUNT(*) FROM "User" WHERE "coins" < 0;` → `0`
- [ ] Q6 baseline SELECT output saved locally to `docs/migration-archives/pre_joulenomics_v1_YYYYMMDD.txt`.
- [ ] Neon plan tier confirmed as Launch (7-day PITR).
- [ ] Current git branch is `claude/joulegram-schema-migration-5EfyI`.
- [ ] All 5 prompt-1.2 commits are pushed to origin: migration SQL, integrity relative-import fix, seed fix, verify script, OPENING_BALANCE schema addition.
- [ ] `.gitignore` contains `docs/migration-archives/` (add if missing — archives are local-only, never committed).
- [ ] `CRON_SECRET` is set in the test-branch Vercel environment (or equivalent local env) so step l can hit the regen route.

---

## Execution

### a. Capture the pre-migration baseline

In the Neon SQL Editor, pointed at `main`:

```sql
SELECT "userNumber", "username", "coins", "createdAt"
FROM "User"
ORDER BY "userNumber" ASC;
```

Copy the output verbatim and save it to `docs/migration-archives/pre_joulenomics_v1_YYYYMMDD.txt`.

If `docs/migration-archives/` is not gitignored, add it now:

```bash
echo 'docs/migration-archives/' >> .gitignore
```

**Expected:** exactly 15 rows, userNumbers 1–15, founder `mohiteu811-cloud` at userNumber=1 with coins ≈ 22670.6.

**Failure:** if row count ≠ 15, investigate before proceeding. A new signup landed mid-preflight or the hardcoded description in the migration SQL needs to be updated.

### b. Dump CoinTransaction to JSON

In the Neon SQL Editor, pointed at `main`:

```sql
SELECT json_agg(row_to_json(t)) FROM "CoinTransaction" t;
```

Save the output to `docs/migration-archives/coin_transaction_dump_YYYYMMDD.json`, then gzip:

```bash
gzip docs/migration-archives/coin_transaction_dump_YYYYMMDD.json
```

**Expected:** a JSON array of all historical CoinTransaction rows. Local only, never committed.

**Failure:** if the editor truncates the output, fall back to `pg_dump --data-only --table='"CoinTransaction"'` using the connection string from the Neon dashboard.

### c. pg_dump prod to a timestamped local file

Belt-and-suspenders rollback beyond Neon PITR. Get the connection string from the Neon dashboard: project → branch `main` → "Connection Details" → copy the psql connection string.

```bash
pg_dump \
  "postgresql://<user>:<password>@<host>/<db>?sslmode=require" \
  --format=custom \
  --no-owner \
  --no-acl \
  --file=backups/joulegram_pre_joulenomics_v1_YYYYMMDD_HHMM.dump
```

**Expected:** a `.dump` file of ~1–10 MB depending on history size. Verify with `pg_restore --list` that it's readable.

**Failure:** if `pg_dump` errors with version mismatch, use the `pg_dump` shipped with the same PostgreSQL major version as the Neon branch (check via `SELECT version();`).

### d. Create the atomicity probe Neon branch

Neon dashboard → project → "Branches" → "Create branch":
- Name: `migration-test-atomicity-probe-YYYYMMDD`
- Parent: `main`
- Parent data: "current state" (not a specific LSN)

Copy the probe branch connection string — you'll need it for step e.

### e. Atomicity probe run

Create a throwaway copy of the real migration with a poison pill appended:

```bash
cp -r \
  prisma/migrations/20260407120000_joulenomics_v1 \
  prisma/migrations/20260407120000_atomicity_probe
```

Append to the end of the probe's `migration.sql`:

```sql
-- POISON PILL: deliberate UNIQUE constraint violation on userNumber=0
-- to verify Prisma's implicit transaction wrapping rolls back
-- everything above this line. DO NOT COMMIT.
INSERT INTO "User" (
  "id", "username", "email", "joulesBalance",
  "userNumber", "referralCode", "active", "ratingsSinceLastPost"
) VALUES (
  'atomicity_probe_duplicate',
  '_probe',
  'probe@system.joulegram.internal',
  0, 0, 'atomicity_probe_code', false, 0
);
```

The `userNumber=0` duplicates the treasury user inserted earlier in the same migration, triggering the UNIQUE constraint.

Point `DATABASE_URL` at the probe branch and run:

```bash
export DATABASE_URL="<probe branch connection string>"
npx prisma migrate deploy
```

**Expected outcome:** `prisma migrate deploy` fails with a UNIQUE constraint violation on `userNumber`. Verify in the Neon SQL Editor pointed at the probe branch:

```sql
-- Should still exist (column not dropped)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'User' AND column_name = 'coins';

-- Should still exist (table not dropped)
SELECT to_regclass('"CoinTransaction"');

-- Should not exist (table not created)
SELECT to_regclass('"LedgerEntry"');
```

All three queries should indicate pre-migration state — `coins` column present, `CoinTransaction` table present, `LedgerEntry` table absent. If so, Prisma's implicit transaction wrapping is confirmed atomic and the real migration is safe to proceed.

**Cleanup (mandatory before step g):**

```bash
rm -rf prisma/migrations/20260407120000_atomicity_probe
```

Then delete the probe branch in the Neon dashboard.

### f. Decision point after probe

- **If probe behaved as expected** (pre-migration state, clean rollback): proceed to step g.
- **If probe shows partial state** (any of: `LedgerEntry` table exists, treasury user exists, `coins` column missing, `CoinTransaction` table missing): **STOP.** Do not proceed. The real migration is not safe as written. Fallback strategy is to rewrite the data-transform section (steps 4a–6c in the migration SQL) as a single PL/pgSQL `DO $$ BEGIN ... END $$` block, which PostgreSQL treats as a single atomic statement. **Do not implement the fallback ad-hoc** — stop, revisit the plan file, and author the fallback deliberately.

### g. Create the real test branch

Neon dashboard → project → "Branches" → "Create branch":
- Name: `migration-test-joulenomics-v1-YYYYMMDD`
- Parent: `main`
- Parent data: "current state"

Copy the test branch connection string.

### h. Run the migration on the test branch

```bash
export DATABASE_URL="<test branch connection string>"
npx prisma migrate deploy
```

**Expected:** `Applying migration '20260407120000_joulenomics_v1'` → `All migrations have been successfully applied.` No errors.

**Failure:** do not proceed. Capture the full error output, delete the test branch, investigate, and either fix the migration file or the procedure before retrying.

### i. Run the seed on the test branch

```bash
node --experimental-strip-types scripts/seed-bootstrap-pool.ts
```

**Expected output (exactly two lines):**

```
Bootstrap pool created: 10,000,000 kJ
Done! Pre-Scale Mode is now ready to activate.
```

**Failure:** do not proceed. The seed is idempotent, so re-running is safe — but if it fails on the first run, something is wrong with the `DATABASE_URL` or the migration didn't create the `BootstrapPool` table.

### j. Run verify-migration.ts with baseline assertions

```bash
EXPECT_REAL_USERS=15 \
EXPECT_REAL_SUM_J=27715100 \
node --experimental-strip-types scripts/verify-migration.ts
echo "exit code: $?"
```

**Expected:** all 5 integrity rules `[PASS]`, `Real + treasury sum is exactly zero [PASS]`, both baseline assertions `[PASS]`, `[OK] verification passed`, exit code `0`.

**Failure:** if ANY `[FAIL]` line appears, or exit code is non-zero, or any summary stat is off — **STOP.** Do not proceed to prod. Post the full output for review.

### k. Visually diff the per-user balance table against Q6 baseline

Open `docs/migration-archives/pre_joulenomics_v1_YYYYMMDD.txt` side by side with the verify script output. For each of the 15 real users:

```
pre_migration_coins × 1000 == post_migration_joulesBalance exactly
```

All 15 rows must match. If any row is off: stop, investigate the `ROUND()` step in the migration SQL, do not proceed to prod.

### l. Smoke test the regen cron on the test branch

The regen cron route is `GET /api/cron/regen` (not POST), auth via `Authorization: Bearer $CRON_SECRET`. Retrieve `CRON_SECRET` from the test branch's Vercel environment (or the local `.env` if running a dev server).

**Option 1 — against a running dev server:**

```bash
DATABASE_URL="<test branch>" CRON_SECRET="<secret>" npm run dev
# in another terminal:
curl -H "Authorization: Bearer <secret>" http://localhost:3000/api/cron/regen
```

**Option 2 — against a Vercel preview deployment of the test branch:** push the branch, let Vercel deploy, then:

```bash
curl -H "Authorization: Bearer <secret>" \
  https://<preview-url>.vercel.app/api/cron/regen
```

**Expected:** HTTP 200 with a JSON body reporting regen ran (or `{"status":"skipped"}` if Pre-Scale mode is not active yet).

Then re-run verify-migration.ts (without baseline env vars, since `EXPECT_REAL_SUM_J` will drift after a drip):

```bash
node --experimental-strip-types scripts/verify-migration.ts
```

**Expected:** all 5 rules still pass. `BootstrapPool.remainingKj` decremented by exactly the total drip amount.

**Failure:** any rule fails after the drip → stop, investigate `transferFromBootstrapPool` in `src/lib/pre-scale.ts`, do not proceed to prod.

### m. Cleanup the test branch

Neon dashboard → Branches → `migration-test-joulenomics-v1-YYYYMMDD` → Delete.

Why: leftover test branches confuse future PITR operations — you don't want to restore from a test branch by accident during an incident. Delete as soon as step l is green.

### n. Run the migration against prod

Point of no return. Re-confirm before proceeding:

- [ ] Steps d–m all green.
- [ ] Signups paused (or drift risk accepted).
- [ ] `pg_dump` from step c exists and is readable.
- [ ] Neon PITR window is fresh (within 7 days).
- [ ] Current git branch is `claude/joulegram-schema-migration-5EfyI` with all prompt-1.2 commits pushed.

Then:

```bash
export DATABASE_URL="<prod main connection string>"
npx prisma migrate deploy
```

**Expected:** same as step h, same failure handling — but failure here means initiating rollback, not retrying.

### o. Run the seed against prod

```bash
node --experimental-strip-types scripts/seed-bootstrap-pool.ts
```

Expected output identical to step i.

### p. Run verify-migration.ts against prod with baseline assertions

```bash
EXPECT_REAL_USERS=15 EXPECT_REAL_SUM_J=27715100 \
node --experimental-strip-types scripts/verify-migration.ts
echo "exit code: $?"
```

Expected output identical to step j. Exit code `0`.

**Failure:** any `[FAIL]` or non-zero exit code → initiate PITR restore immediately (see Rollback section). Do not attempt to manually patch the ledger.

### q. Visually diff the prod per-user balance table against Q6 baseline

Same as step k but on prod. All 15 rows must match exactly.

### r. Mark migration complete

1. Update `CLAUDE.md` to reflect post-migration state (15 users, `joulesBalance` in J, no more `coins`/`CoinTransaction`).
2. Append a row to the Migration log section of this runbook with the timestamp and operator.
3. Commit and push.
4. Resume signups.

---

## Rollback procedure

Three tiers, in order of preference:

### Tier 1 — Neon PITR restore (preferred)

Neon dashboard → project → `main` → "Restore" → select timestamp immediately before step n (the prod `prisma migrate deploy`). This creates a new branch from that LSN; promote it to `main` via the dashboard.

- **Window:** 7 days on the Launch tier.
- **Urgency:** initiate within 24 hours of detecting any issue, not days later, to leave margin for subsequent incidents.
- **Verification:** after restore, run the Q6 baseline SELECT and confirm it matches the pre-migration file from step a.

### Tier 2 — pg_dump restore

Fallback if PITR window has lapsed or PITR restore itself fails:

```bash
pg_restore \
  --dbname="<prod connection string>" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  backups/joulegram_pre_joulenomics_v1_YYYYMMDD_HHMM.dump
```

**Caveats:** this wipes the current schema and restores it from the dump, losing any data written after step c. Coordinate carefully.

### Tier 3 — Manual ledger correction

Out of scope for this runbook. If both tiers 1 and 2 fail, escalate before touching the database. Manual correction on a live ledger without a snapshot is how integrity rules get silently broken.

---

## Known risks and gotchas

- **Signups during the migration window** will not be reflected in the hardcoded `15` / `27715100 J` snapshot in the step 6b treasury counterparty description. The dynamic `SUM()` in the same statement will still produce the correct amount (no integrity failure), but the description text will be misleading to a future auditor. If signups cannot be paused, update the description text to match the actual pre-migration count before running step n.
- **The atomicity probe must be re-run** if anything in Prisma's migration engine changes (version bump, adapter swap, etc.) before the next migration. Past probe results do not transfer.
- **The `.internal` email TLD** is RFC-reserved and can never collide with a real signup. Do not "clean up" the treasury email to a real domain in a future refactor.
- **`userNumber=0` is permanently reserved for treasury.** Real signups are 1-indexed. Do not change this convention.
- **Verify script's `EXPECT_REAL_SUM_J` will drift** after any drip, grant, or compute fee. Only use the baseline assertion immediately after migration + seed, before any real activity. For ongoing diagnostic runs, unset the env var.
- **The regen cron route is GET, not POST.** Use `curl -H "Authorization: Bearer ..."` without `-X POST`.

---

## Post-migration follow-ups (queued for Prompt 1.3+)

These are tracked as known-deferred items from the Prompt 1.2 planning phase. None of them block the migration itself; all of them should be addressed before Pre-Scale Mode is actually activated in production.

1. **Generate and deploy prod `CRON_SECRET`.** Currently the regen route returns 401 if `CRON_SECRET` is unset or the header doesn't match (`src/app/api/cron/regen/route.ts:17`). Generate a fresh random secret via `openssl rand -hex 32`, set it in Vercel Production env vars, and verify the cron route returns 200 on a manual `curl` before relying on Vercel's scheduled crons.

2. **Port `src/lib/env-check.ts` cold-start assertion from the RTGyr branch.** The current route checks `CRON_SECRET` at request time only. Cold-start assertion catches the misconfiguration immediately at deploy time rather than waiting for the first cron hit to fail. See the earlier `claude/joulegram-pre-scale-mode-RTGyr` branch for the source to port.

3. **Port the YAML config loader from the RTGyr branch.** Pre-Scale constants are currently hardcoded in `src/lib/pre-scale-config.ts`. The RTGyr branch introduced `config/pre-scale.yaml` + a typed loader with runtime validation, which is the target design. Port it into a Prompt 1.3 PR.

4. **Fix the latent sub-1-kJ truncation in `transferFromBootstrapPool`.** `src/lib/pre-scale.ts:48` does `BigInt(amountKj.toFixed(0))`, which silently truncates any sub-1-kJ amount to 0 kJ. Today all Pre-Scale grants are whole-kJ multiples (regen: 10 kJ/hr, login bonus: 50 kJ, rate-earn: 5 kJ) so this is benign, but any future sub-kJ grant would be silently lost. Fix by rounding or by keeping the pool accounting in joules directly.

5. **Wire up `only_when_balance_below_cap` config flag.** Currently defined in the Pre-Scale config but has no consumer in `runPassiveRegen`. Either wire the check into the regen loop or remove the flag. Day 5 cleanup at the latest.

6. **`runPassiveRegen` batching / single-transaction refactor.** Currently sequential per-user transactions. Works correctly but is O(N) transactions per cron run. Refactor to a single transaction per bucket (or chunked batches) before user count scales beyond ~100.

7. **`PRE_SCALE_POST_GRANT` entry type has no emitter.** The enum value exists in `LedgerEntryType` but no code path creates a ledger entry with this type. Either add the emitter (in the post-boost / post-featured grant flow) or remove the enum value in a future schema migration.

8. **Rule #1 sign/reference enforcement for non-debit categories.** `src/lib/integrity.ts` currently enforces sign and reference-type conventions only for `DEBIT_TYPES`. Pool mints, reserve grants, and stake resolutions have their conventions documented in CLAUDE.md but are not asserted programmatically. Extend the assertions to cover all categories.

9. **`src/lib/prisma.ts` empty-string fallback on missing `DATABASE_URL`.** Current behavior silently returns an empty connection string, which surfaces as a cryptic Prisma error downstream. Switch to throwing a clear error at module load time.

10. **Rule #5 joules→kJ division comment.** `src/lib/integrity.ts:227` divides `totalTransferredJ.div(1000)` to compare against pool kJ. This is precision-safe for current grant magnitudes (all whole-kJ multiples) but the assumption should be documented in a code comment before the next contributor sees it.

11. **Login-bonus / rate-earn / graduation crons** not yet in `vercel.json`. Only the hourly regen cron is wired. Add the daily login-bonus and rate-earn crons, and author the Pre-Scale → Full-Scale graduation cron.

12. **Unused enum value cleanup.** After items 7 and 8 are resolved, audit `LedgerEntryType` for any values that still have no emitter.

---

## Migration log

_(entries appended after successful runs — see step r)_
