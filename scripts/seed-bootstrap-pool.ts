/**
 * One-time migration script to seed the Pre-Scale Mode bootstrap pool.
 *
 * Creates:
 * 1. A BootstrapPool row with 10 MJ
 *
 * Treasury user creation and paired ledger entries are handled elsewhere:
 * the Joulenomics v1 migration (prisma/migrations/20260407120000_joulenomics_v1)
 * creates the treasury user, and the runtime transferFromBootstrapPool in
 * src/lib/pre-scale.ts writes treasury/user paired entries as joules flow
 * out of the pool. This seed only registers pool metadata.
 *
 * Run with: node --experimental-strip-types scripts/seed-bootstrap-pool.ts
 *
 * Safe to re-run — checks for existing records before creating.
 */

import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const BOOTSTRAP_POOL_ID = "pre_scale_v1";
const BOOTSTRAP_POOL_J = 10_000_000_000; // 10 MJ in joules

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
    // Create bootstrap pool if not exists
    const existingPool = await prisma.bootstrapPool.findUnique({
      where: { poolId: BOOTSTRAP_POOL_ID },
    });

    if (existingPool) {
      console.log(`Bootstrap pool already exists: ${existingPool.remainingJ} J remaining`);
      return;
    }

    await prisma.bootstrapPool.create({
      data: {
        poolId: BOOTSTRAP_POOL_ID,
        totalMintedJ: BigInt(BOOTSTRAP_POOL_J),
        remainingJ: BigInt(BOOTSTRAP_POOL_J),
      },
    });

    console.log(`Bootstrap pool created: ${BOOTSTRAP_POOL_J.toLocaleString()} J`);
    console.log("Done! Pre-Scale Mode is now ready to activate.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
