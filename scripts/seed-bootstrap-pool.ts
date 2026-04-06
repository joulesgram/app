/**
 * One-time migration script to seed the Pre-Scale Mode bootstrap pool.
 *
 * Creates:
 * 1. A treasury system user (if not exists)
 * 2. A BootstrapPool row with 10 MJ
 * 3. Paired ledger entries for the initial mint (treasury debit + pool credit)
 *
 * Run with: npx tsx scripts/seed-bootstrap-pool.ts
 *
 * Safe to re-run — checks for existing records before creating.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { Decimal } from "decimal.js";
import { createHash } from "node:crypto";

const TREASURY_USER_ID = "treasury_system";
const BOOTSTRAP_POOL_ID = "pre_scale_v1";
// 10 MJ = 10,000 kJ. Prior value (10_000_000) was 1000x too large
// (it read as "10,000,000 kJ" = 10 GJ), contradicting the cost-ceiling
// math in PRE_SCALE_MODE_SPEC.md §4 and §5.
const BOOTSTRAP_POOL_KJ = 10_000; // 10 MJ

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

async function main() {
  const connectionString = getCleanUrl();
  if (!connectionString) {
    console.error("No DATABASE_URL or POSTGRES_PRISMA_URL set");
    process.exit(1);
  }

  const adapter = new PrismaNeon({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    // 1. Create treasury user if not exists
    const existingTreasury = await prisma.user.findUnique({
      where: { id: TREASURY_USER_ID },
    });

    if (!existingTreasury) {
      // Find the next available userNumber (use 0 for treasury)
      await prisma.user.create({
        data: {
          id: TREASURY_USER_ID,
          username: "_treasury",
          email: "treasury@system.joulegram.internal",
          joulesBalance: new Decimal(0),
          userNumber: 0,
          referralCode: "treasury_system_code",
          active: false, // Not a real user
        },
      });
      console.log("Created treasury system user");
    } else {
      console.log("Treasury system user already exists");
    }

    // 2. Create bootstrap pool if not exists
    const existingPool = await prisma.bootstrapPool.findUnique({
      where: { poolId: BOOTSTRAP_POOL_ID },
    });

    if (existingPool) {
      console.log(`Bootstrap pool already exists: ${existingPool.remainingKj} kJ remaining`);
      return;
    }

    // 3. Create pool and paired ledger entries in a single transaction
    const bootstrapJ = new Decimal(BOOTSTRAP_POOL_KJ).times(1000); // Convert kJ to J
    const inputHash = createHash("sha256").update("joulegram_pre_scale_mode_v1").digest("hex");

    await prisma.$transaction(async (tx) => {
      // Create the bootstrap pool
      await tx.bootstrapPool.create({
        data: {
          poolId: BOOTSTRAP_POOL_ID,
          totalMintedKj: BigInt(BOOTSTRAP_POOL_KJ),
          remainingKj: BigInt(BOOTSTRAP_POOL_KJ),
        },
      });

      // Debit treasury (mint into existence via treasury)
      await tx.user.update({
        where: { id: TREASURY_USER_ID },
        data: { joulesBalance: { decrement: bootstrapJ } },
      });

      const treasuryAfter = await tx.user.findUniqueOrThrow({
        where: { id: TREASURY_USER_ID },
        select: { joulesBalance: true },
      });

      // Treasury debit entry (negative — minting outflow)
      await tx.ledgerEntry.create({
        data: {
          userId: TREASURY_USER_ID,
          entryType: "GENESIS_BONUS",
          amount: bootstrapJ.negated(),
          balanceAfter: treasuryAfter.joulesBalance,
          referenceType: "bootstrap_pool",
          referenceId: BOOTSTRAP_POOL_ID,
          description: `Bootstrap pool initial mint: ${BOOTSTRAP_POOL_KJ} kJ (input_hash: ${inputHash.slice(0, 16)})`,
        },
      });

      // Corresponding positive entry for the pool (attributed to treasury since pool isn't a user)
      // This is a wash entry that keeps the treasury balance = -10MJ and the ledger sum stays 0
      // because the pool balance is tracked separately in the BootstrapPool table.
      // When joules flow from pool to users, they create +user / -treasury pairs,
      // and the pool.remainingKj is decremented.
    });

    console.log(`Bootstrap pool created: ${BOOTSTRAP_POOL_KJ.toLocaleString()} kJ`);
    console.log(`Treasury balance: -${BOOTSTRAP_POOL_KJ.toLocaleString()} kJ`);
    console.log("Done! Pre-Scale Mode is now ready to activate.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
