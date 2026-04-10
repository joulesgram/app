// Pre-Scale Mode — feature flag, bootstrap pool helpers, regen, and login bonus logic.
// All amounts in joules (J). 1 kJ = 1000 J.

import { Decimal } from "decimal.js";
import { PRE_SCALE } from "@/lib/pre-scale-config";
import { TREASURY_USER_ID } from "@/lib/integrity";
import type { PrismaClient } from "@/generated/prisma/client";

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// ─── Feature flag ───────────────────────────────────────────────────

/** Check if Pre-Scale Mode is currently active. */
export async function isPreScaleModeEnabled(prisma: PrismaClient): Promise<boolean> {
  const pool = await prisma.bootstrapPool.findUnique({
    where: { poolId: PRE_SCALE.BOOTSTRAP_POOL_ID },
  });
  return pool !== null && pool.closedAt === null;
}

// ─── Bootstrap pool debit helper ────────────────────────────────────

/**
 * Transfer joules from the bootstrap pool to a user.
 * Creates paired ledger entries (treasury debit + user credit) in the same transaction.
 *
 * @param tx - Prisma transaction client
 * @param userId - Recipient user ID
 * @param amountJ - Amount in joules to transfer
 * @param entryType - The ledger entry type for this transfer
 * @param description - Optional description
 * @returns true if transfer succeeded, false if pool has insufficient funds
 */
export async function transferFromBootstrapPool(
  tx: Tx,
  userId: string,
  amountJ: Decimal,
  entryType: "REGEN_DRIP" | "DAILY_LOGIN_BONUS" | "RATE_EARN_FLAT" | "PRE_SCALE_POST_GRANT",
  description?: string
): Promise<boolean> {
  const amountJBigInt = BigInt(amountJ.toFixed(0));

  // Atomic CAS on pool remaining balance (in joules — no rounding needed)
  const updated = await tx.bootstrapPool.updateMany({
    where: {
      poolId: PRE_SCALE.BOOTSTRAP_POOL_ID,
      closedAt: null,
      remainingJ: { gte: amountJBigInt },
    },
    data: { remainingJ: { decrement: amountJBigInt } },
  });

  if (updated.count === 0) return false;

  // Credit the user
  await tx.user.update({
    where: { id: userId },
    data: { joulesBalance: { increment: amountJ } },
  });

  const userAfter = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { joulesBalance: true },
  });

  await tx.ledgerEntry.create({
    data: {
      userId,
      entryType,
      amount: amountJ,
      balanceAfter: userAfter.joulesBalance,
      referenceType: "bootstrap_pool",
      referenceId: PRE_SCALE.BOOTSTRAP_POOL_ID,
      description,
    },
  });

  // Debit the treasury
  await tx.user.update({
    where: { id: TREASURY_USER_ID },
    data: { joulesBalance: { decrement: amountJ } },
  });

  const treasuryAfter = await tx.user.findUniqueOrThrow({
    where: { id: TREASURY_USER_ID },
    select: { joulesBalance: true },
  });

  await tx.ledgerEntry.create({
    data: {
      userId: TREASURY_USER_ID,
      entryType,
      amount: amountJ.negated(),
      balanceAfter: treasuryAfter.joulesBalance,
      referenceType: "bootstrap_pool",
      referenceId: PRE_SCALE.BOOTSTRAP_POOL_ID,
      description,
    },
  });

  return true;
}

// ─── Passive regen ──────────────────────────────────────────────────

/** Run passive regen for all eligible users. Returns count of users topped up. */
export async function runPassiveRegen(prisma: PrismaClient): Promise<number> {
  const capJ = new Decimal(PRE_SCALE.REGEN_CAP_J);
  const rateJ = new Decimal(PRE_SCALE.REGEN_RATE_J_PER_HOUR);
  let count = 0;

  // Find all non-treasury users below the cap
  const users = await prisma.user.findMany({
    where: {
      id: { not: TREASURY_USER_ID },
      joulesBalance: { lt: capJ },
    },
    select: { id: true, joulesBalance: true },
  });

  for (const user of users) {
    const balance = new Decimal(user.joulesBalance.toString());
    const needed = capJ.minus(balance);
    const grant = Decimal.min(rateJ, needed);

    if (grant.lte(0)) continue;

    const success = await prisma.$transaction(async (tx) => {
      return transferFromBootstrapPool(tx, user.id, grant, "REGEN_DRIP", "Passive regen");
    });

    if (success) count++;
  }

  return count;
}

// ─── Daily login bonus ─────────────────────────────────────────────

/**
 * Grant daily login bonus if the user hasn't received one today.
 * Should be called during authenticated session flow.
 *
 * @returns true if bonus was granted, false if already received today or pool empty
 */
export async function grantDailyLoginBonus(
  prisma: PrismaClient,
  userId: string
): Promise<boolean> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { lastLoginBonusDate: true },
  });

  if (!user) return false;

  // Check if already granted today
  if (user.lastLoginBonusDate) {
    const lastDate = new Date(user.lastLoginBonusDate);
    lastDate.setUTCHours(0, 0, 0, 0);
    if (lastDate.getTime() === today.getTime()) return false;
  }

  const bonusJ = new Decimal(PRE_SCALE.DAILY_LOGIN_BONUS_J);

  const success = await prisma.$transaction(async (tx) => {
    // Double-check inside transaction to prevent race conditions
    const freshUser = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastLoginBonusDate: true },
    });

    if (freshUser.lastLoginBonusDate) {
      const lastDate = new Date(freshUser.lastLoginBonusDate);
      lastDate.setUTCHours(0, 0, 0, 0);
      if (lastDate.getTime() === today.getTime()) return false;
    }

    const transferred = await transferFromBootstrapPool(
      tx,
      userId,
      bonusJ,
      "DAILY_LOGIN_BONUS",
      "Daily login bonus (50 kJ)"
    );

    if (!transferred) return false;

    await tx.user.update({
      where: { id: userId },
      data: { lastLoginBonusDate: new Date() },
    });

    return true;
  });

  return success;
}
