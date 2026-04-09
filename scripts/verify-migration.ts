/**
 * Joulenomics v1 migration verification script.
 *
 * Read-only diagnostic. Runs all 5 integrity rules against the current
 * database, prints a per-user balance table, prints summary stats, and
 * exits 0 iff every rule passes AND the global ledger sum is exactly 0.
 *
 * READ-ONLY: this script performs NO writes. No $transaction, no .create,
 * no .update, no .delete. Any future modification MUST preserve that
 * property — this is the single tool the operator uses to confirm a
 * migration succeeded without distorting the state it's measuring.
 *
 * Intended usage: run against a Neon test branch immediately after
 * `prisma migrate deploy` + `seed-bootstrap-pool.ts`, then visually diff
 * the per-user table against the Q6 pre-migration baseline.
 *
 * Run with: node --experimental-strip-types scripts/verify-migration.ts
 *
 * Optional baseline-assertion env vars (set both on the test-branch run,
 * leave unset for drift-tolerant diagnostic runs):
 *   EXPECT_REAL_USERS   — expected count of non-treasury users (e.g. 15)
 *   EXPECT_REAL_SUM_J   — expected sum of non-treasury joulesBalance in
 *                         joules as a plain integer (e.g. 27715100)
 * If either is set, the script asserts the actual value matches and
 * fails loud on mismatch. If neither is set, the block is skipped.
 *
 * Exit codes:
 *   0 — all 5 integrity rules pass AND global ledger sum is exactly 0
 *       AND any set baseline-assertion env vars match
 *   1 — any rule failed, global sum is non-zero, baseline mismatch,
 *       env var parse error, or the script errored
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Decimal } from "decimal.js";
import { runAllIntegrityChecks, TREASURY_USER_ID } from "../src/lib/integrity";

// Duplicated from seed-bootstrap-pool.ts. The seed script runs main() at
// module load, so importing from it would execute the seed — not safe.
// A future refactor can extract both copies into scripts/lib/db-url.ts.
function getCleanUrl(): string {
  const raw = process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || "";
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.searchParams.delete("channel_binding");
    return url.toString();
  } catch {
    return raw;
  }
}

function fmtJ(value: Decimal | string | number | bigint): string {
  const d = new Decimal(value.toString());
  // Thousands-separated with up to 4 decimal places, trailing zeros trimmed.
  const [intPart, fracPartRaw] = d.toFixed(4).split(".");
  const sign = intPart.startsWith("-") ? "-" : "";
  const intAbs = sign ? intPart.slice(1) : intPart;
  const intWithCommas = intAbs.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fracPart = fracPartRaw?.replace(/0+$/, "") ?? "";
  return fracPart ? `${sign}${intWithCommas}.${fracPart}` : `${sign}${intWithCommas}`;
}

async function main(): Promise<number> {
  const connectionString = getCleanUrl();
  if (!connectionString) {
    console.error("[ERROR] No DATABASE_URL or POSTGRES_PRISMA_URL set");
    return 1;
  }

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  let exitCode = 0;

  try {
    // ─── Integrity rules ────────────────────────────────────────────
    console.log("=== Integrity rules ===");
    const results = await runAllIntegrityChecks(prisma);
    for (const r of results) {
      const tag = r.passed ? "[PASS]" : "[FAIL]";
      console.log(`${tag} ${r.rule}: ${r.details}`);
      if (!r.passed) exitCode = 1;
    }
    console.log("");

    // ─── Per-user balance table ─────────────────────────────────────
    console.log("=== User balances (ordered by userNumber) ===");
    const users = await prisma.user.findMany({
      select: {
        id: true,
        userNumber: true,
        username: true,
        joulesBalance: true,
      },
      orderBy: { userNumber: "asc" },
    });

    const header = `  # | ${"username".padEnd(28)} | joulesBalance (J)`;
    const sep = `----+-${"-".repeat(28)}-+-${"-".repeat(24)}`;
    console.log(header);
    console.log(sep);
    for (const u of users) {
      const num = String(u.userNumber).padStart(3);
      const name = (u.username ?? "(null)").padEnd(28).slice(0, 28);
      const bal = fmtJ(u.joulesBalance.toString()).padStart(24);
      console.log(`${num} | ${name} | ${bal}`);
    }
    console.log("");

    // ─── Summary stats ──────────────────────────────────────────────
    console.log("=== Summary ===");
    const realUsers = users.filter((u) => u.id !== TREASURY_USER_ID);
    const treasury = users.find((u) => u.id === TREASURY_USER_ID);

    const realSum = realUsers.reduce(
      (acc, u) => acc.plus(new Decimal(u.joulesBalance.toString())),
      new Decimal(0)
    );
    const treasuryBal = treasury
      ? new Decimal(treasury.joulesBalance.toString())
      : new Decimal(0);
    const globalSum = realSum.plus(treasuryBal);

    console.log(`Real user count:        ${realUsers.length}`);
    console.log(`Real user sum:          ${fmtJ(realSum)} J`);
    console.log(`Treasury balance:       ${treasury ? fmtJ(treasuryBal) + " J" : "(not found)"}`);
    console.log(`Real + treasury sum:    ${fmtJ(globalSum)} J`);

    if (!globalSum.eq(0)) {
      console.log("[FAIL] Real + treasury sum is non-zero");
      exitCode = 1;
    } else {
      console.log("[PASS] Real + treasury sum is exactly zero");
    }
    console.log("");

    // ─── Optional baseline assertion (env-var gated) ────────────────
    const expectedRealUsers = process.env.EXPECT_REAL_USERS;
    const expectedRealSumJ = process.env.EXPECT_REAL_SUM_J;
    if (expectedRealUsers || expectedRealSumJ) {
      console.log("=== Baseline assertion ===");
      if (expectedRealUsers) {
        const expected = parseInt(expectedRealUsers, 10);
        if (
          Number.isNaN(expected) ||
          expected < 0 ||
          String(expected) !== expectedRealUsers.trim()
        ) {
          console.log(
            `[ERROR] EXPECT_REAL_USERS="${expectedRealUsers}" is not a valid non-negative integer`
          );
          exitCode = 1;
        } else if (realUsers.length !== expected) {
          console.log(`[FAIL] Real user count ${realUsers.length} ≠ expected ${expected}`);
          exitCode = 1;
        } else {
          console.log(`[PASS] Real user count = ${expected}`);
        }
      }
      if (expectedRealSumJ) {
        let expected: Decimal | null = null;
        try {
          expected = new Decimal(expectedRealSumJ);
        } catch {
          console.log(
            `[ERROR] EXPECT_REAL_SUM_J="${expectedRealSumJ}" is not a valid decimal number`
          );
          exitCode = 1;
        }
        if (expected !== null && !realSum.eq(expected)) {
          console.log(
            `[FAIL] Real user sum ${fmtJ(realSum)} J ≠ expected ${fmtJ(expected)} J`
          );
          exitCode = 1;
        } else if (expected !== null) {
          console.log(`[PASS] Real user sum = ${fmtJ(expected)} J`);
        }
      }
      console.log("");
    }

    // ─── Bootstrap pool state ───────────────────────────────────────
    console.log("=== Bootstrap pool ===");
    const pools = await prisma.bootstrapPool.findMany({
      orderBy: { createdAt: "asc" },
    });
    if (pools.length === 0) {
      console.log("(no BootstrapPool rows — expected before seed runs)");
    } else {
      for (const p of pools) {
        console.log(`poolId:         ${p.poolId}`);
        console.log(`totalMintedJ:   ${p.totalMintedJ.toString()}`);
        console.log(`remainingJ:     ${p.remainingJ.toString()}`);
        console.log(`closedAt:       ${p.closedAt?.toISOString() ?? "(open)"}`);
      }
    }
    console.log("");

    console.log(exitCode === 0 ? "[OK] verification passed" : "[FAIL] verification failed");
    return exitCode;
  } catch (e) {
    console.error("[ERROR] verification script crashed:", e);
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().then((code) => process.exit(code));
