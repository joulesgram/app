// All amounts in joules (J). 1 kJ = 1000 J. Convert to kJ only at UI layer.
//
// This file is the canonical source of truth for ledger entry type categories
// and the four integrity rules from Joulenomics v1 §12, plus Rule #5 for
// Pre-Scale Mode bootstrap pool conservation.
//
// Integrity assertions use SUM(LedgerEntry.amount) as the sole source of truth.
// `balanceAfter` and `joulesBalance` are UI convenience caches — never read
// as sources of truth in integrity checks.

import { Decimal } from "decimal.js";
import { PRE_SCALE } from "./pre-scale-config";
import type { PrismaClient } from "@/generated/prisma/client";

// ─── Treasury ───────────────────────────────────────────────────────
export const TREASURY_USER_ID = "treasury_system";

// ─── Entry type categories ──────────────────────────────────────────
export const DEBIT_TYPES = [
  "COMPUTE_FEE",
  "RATING_STAKE",
  "STAKE_SLASH",
  "AGENT_REGISTRATION_FEE",
  "BOOST_FEE",
] as const;

export const POOL_MINT_TYPES = [
  "CREATOR_REWARD",
  "CURATOR_REWARD",
  "ENGAGEMENT_BONUS",
] as const;

export const RESERVE_GRANT_TYPES = [
  "UPLOAD_REWARD",
  "REFERRAL_BONUS",
  "LEADERBOARD_BONUS",
  "GENESIS_BONUS",
  "FAUCET_GRANT",
] as const;

export const STAKE_RESOLUTION_TYPES = ["STAKE_RETURN", "STAKE_BONUS"] as const;

// Pre-Scale bootstrap-pool transfer types. Rule #5 aggregates amount > 0
// entries of these types against BootstrapPool.totalMintedJ to assert
// pool conservation.
//
// Intentionally uncategorized (NOT in any set above): OPENING_BALANCE
// (migration opening balances) and PRE_SCALE_POST_GRANT (zero-amount
// marker row emitted by the rate-to-post unlock path). They pass
// Rules #1 and #2 trivially because those rules filter on category
// membership at the DB layer; Rules #3 and #4 still apply via amount.
export const PRE_SCALE_TYPES = [
  "REGEN_DRIP",
  "DAILY_LOGIN_BONUS",
  "RATE_EARN_FLAT",
] as const;

const VALID_DEBIT_REFERENCE_TYPES = new Set([
  "photo",
  "rating",
  "agent",
  "boost",
]);

// ─── Assertion results ─────────────────────────────────────────────
export interface IntegrityResult {
  rule: string;
  passed: boolean;
  details: string;
}

// ─── Rule #1: Every debit has an action ─────────────────────────────
export async function assertDebitsHaveActions(
  prisma: PrismaClient
): Promise<IntegrityResult> {
  // Exclude treasury counterparty rows — they carry the same entryType as
  // the user-side debit they pair with but have amount > 0 by design.
  const badDebits = await prisma.ledgerEntry.findMany({
    where: {
      entryType: { in: [...DEBIT_TYPES] },
      userId: { not: TREASURY_USER_ID },
      OR: [
        { amount: { gte: 0 } },
        { referenceType: null },
        { referenceId: null },
      ],
    },
    select: { id: true, entryType: true, amount: true, referenceType: true },
    take: 10,
  });

  // Also check that referenceType is valid (same treasury exclusion)
  const invalidRefType = await prisma.ledgerEntry.findMany({
    where: {
      entryType: { in: [...DEBIT_TYPES] },
      userId: { not: TREASURY_USER_ID },
      referenceType: { notIn: Array.from(VALID_DEBIT_REFERENCE_TYPES) },
    },
    select: { id: true, entryType: true, referenceType: true },
    take: 10,
  });

  const allBad = [...badDebits, ...invalidRefType];
  if (allBad.length === 0) {
    return { rule: "Rule #1", passed: true, details: "All debits have valid actions" };
  }

  return {
    rule: "Rule #1",
    passed: false,
    details: `${allBad.length} debit(s) missing valid action: ${JSON.stringify(allBad.slice(0, 3))}`,
  };
}

// ─── Rule #2: Every pool mint has a settlement ──────────────────────
// NOTE: DailySettlement table does not yet exist. This rule will be
// enforced once the settlement cron is built. For now it checks that
// pool mint entries have the correct referenceType.
export async function assertPoolMintsHaveSettlement(
  prisma: PrismaClient
): Promise<IntegrityResult> {
  const badMints = await prisma.ledgerEntry.findMany({
    where: {
      entryType: { in: [...POOL_MINT_TYPES] },
      OR: [
        { amount: { lte: 0 } },
        { NOT: { referenceType: "daily_settlement" } },
        { referenceId: null },
      ],
    },
    select: { id: true, entryType: true, amount: true, referenceType: true },
    take: 10,
  });

  if (badMints.length === 0) {
    return { rule: "Rule #2", passed: true, details: "All pool mints have valid settlements (or none exist yet)" };
  }

  return {
    rule: "Rule #2",
    passed: false,
    details: `${badMints.length} pool mint(s) without valid settlement: ${JSON.stringify(badMints.slice(0, 3))}`,
  };
}

// ─── Rule #3: The ledger balances (global zero-sum) ─────────────────
// SUM(LedgerEntry.amount) across ALL users INCLUDING treasury = 0
export async function assertLedgerBalances(
  prisma: PrismaClient
): Promise<IntegrityResult> {
  const result = await prisma.ledgerEntry.aggregate({
    _sum: { amount: true },
  });

  const totalSum = new Decimal(result._sum.amount?.toString() ?? "0");

  if (totalSum.eq(0)) {
    return { rule: "Rule #3", passed: true, details: "Global ledger sum is zero" };
  }

  return {
    rule: "Rule #3",
    passed: false,
    details: `Global ledger sum is ${totalSum.toString()} J (expected 0)`,
  };
}

// ─── Rule #4: Balances are reproducible ─────────────────────────────
// For every user: SUM(LedgerEntry.amount WHERE userId = user.id) = user.joulesBalance
export async function assertBalancesReproducible(
  prisma: PrismaClient
): Promise<IntegrityResult> {
  // Get all users and their ledger sums
  const users = await prisma.user.findMany({
    select: { id: true, username: true, joulesBalance: true },
  });

  const ledgerSums = await prisma.ledgerEntry.groupBy({
    by: ["userId"],
    _sum: { amount: true },
  });

  const sumMap = new Map(
    ledgerSums.map((row) => [row.userId, new Decimal(row._sum.amount?.toString() ?? "0")])
  );

  const mismatches: string[] = [];

  for (const user of users) {
    const ledgerSum = sumMap.get(user.id) ?? new Decimal(0);
    const balance = new Decimal(user.joulesBalance.toString());

    if (!ledgerSum.eq(balance)) {
      mismatches.push(
        `${user.username}(${user.id}): ledger=${ledgerSum}, balance=${balance}`
      );
    }
  }

  if (mismatches.length === 0) {
    return { rule: "Rule #4", passed: true, details: "All balances match ledger sums" };
  }

  return {
    rule: "Rule #4",
    passed: false,
    details: `${mismatches.length} user(s) with mismatched balances: ${mismatches.slice(0, 5).join("; ")}`,
  };
}

// ─── Rule #5: Bootstrap pool conservation (Pre-Scale only) ──────────
// totalMintedJ = SUM(all PRE_SCALE_TYPES transfers out in J) + remainingJ
export async function assertBootstrapPoolConservation(
  prisma: PrismaClient
): Promise<IntegrityResult> {
  const pool = await prisma.bootstrapPool.findUnique({
    where: { poolId: PRE_SCALE.BOOTSTRAP_POOL_ID },
  });

  if (!pool) {
    return { rule: "Rule #5", passed: true, details: "No bootstrap pool exists (Pre-Scale not active)" };
  }

  if (pool.closedAt) {
    return { rule: "Rule #5", passed: true, details: "Bootstrap pool is closed" };
  }

  // Sum all Pre-Scale type entries where amount > 0 (credits to real users).
  // Both ledger amounts and pool fields are in joules — no conversion needed.
  const result = await prisma.ledgerEntry.aggregate({
    where: {
      entryType: { in: [...PRE_SCALE_TYPES] },
      amount: { gt: 0 },
    },
    _sum: { amount: true },
  });

  const totalTransferredJ = new Decimal(result._sum.amount?.toString() ?? "0");
  const remainingJ = new Decimal(pool.remainingJ.toString());
  const totalMintedJ = new Decimal(pool.totalMintedJ.toString());

  const expected = totalTransferredJ.plus(remainingJ);

  if (expected.eq(totalMintedJ)) {
    return { rule: "Rule #5", passed: true, details: `Bootstrap pool conserved: ${totalMintedJ} J` };
  }

  return {
    rule: "Rule #5",
    passed: false,
    details: `Bootstrap pool mismatch: minted=${totalMintedJ}, transferred=${totalTransferredJ}, remaining=${remainingJ}, expected=${expected}`,
  };
}

// ─── Run all assertions ─────────────────────────────────────────────
export async function runAllIntegrityChecks(
  prisma: PrismaClient
): Promise<IntegrityResult[]> {
  return Promise.all([
    assertDebitsHaveActions(prisma),
    assertPoolMintsHaveSettlement(prisma),
    assertLedgerBalances(prisma),
    assertBalancesReproducible(prisma),
    assertBootstrapPoolConservation(prisma),
  ]);
}
