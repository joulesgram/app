#!/usr/bin/env tsx
/**
 * Joulegram → Joulenomics v1 migration script
 * ============================================
 *
 * Reads from the legacy database (OLD_DATABASE_URL) and writes to the new
 * Joulenomics v1 database (DATABASE_URL). Preserves photos, ratings, and
 * agents. Starts a fresh ledger: each existing user gets exactly one
 * GENESIS_BONUS ledger entry equal to their current balance.
 *
 * Usage:
 *   OLD_DATABASE_URL=postgres://...  \
 *   DATABASE_URL=postgres://...      \
 *   npx tsx scripts/migrate-to-joulenomics-v1.ts [--reset] [--dry-run]
 *
 * Flags:
 *   --reset     Wipe the target database before importing. Dangerous. Only
 *               safe if the target is empty or a disposable staging copy.
 *   --dry-run   Read from old, compute everything, but do not write.
 *   --verify    Skip import, only run integrity checks on the target.
 *
 * Exit codes:
 *   0   success
 *   1   integrity check failed
 *   2   target database is not empty (use --reset)
 *   3   old database unreachable or schema mismatch
 *   4   unexpected error during import
 */

import { PrismaClient, Prisma } from '../src/generated/prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';
import { Client as PgClient } from 'pg';
import { createHash } from 'crypto';

function newPrisma(url: string): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: url });
  return new PrismaClient({ adapter });
}

const { Decimal } = Prisma;
type Decimal = Prisma.Decimal;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const OLD_DB = process.env.OLD_DATABASE_URL;
const NEW_DB = process.env.DATABASE_URL;
const FLAGS = new Set(process.argv.slice(2));
const DRY_RUN = FLAGS.has('--dry-run');
const RESET = FLAGS.has('--reset');
const VERIFY_ONLY = FLAGS.has('--verify');

if (!OLD_DB && !VERIFY_ONLY) {
  console.error('ERROR: OLD_DATABASE_URL env var is required');
  process.exit(3);
}
if (!NEW_DB) {
  console.error('ERROR: DATABASE_URL env var is required');
  process.exit(3);
}

// The four starter agents that will be seeded as STARTER type, owned by user #1.
// These match the four agents referenced on the landing page and in the spec.
// Deterministic IDs make the script safely re-runnable and debuggable.
const STARTER_AGENTS = [
  {
    id: 'starter_minimalisteye',
    name: 'MinimalistEye',
    color: '#00d4ff',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    persona:
      'You value negative space, compositional restraint, and the elimination of visual clutter. Busy compositions score low. Clean lines, strong asymmetry, and a single clear subject score high. You are the minimalist critic — you reward photographers who know what to leave out.',
  },
  {
    id: 'starter_colormaximalist',
    name: 'ColorMaximalist',
    color: '#ff00aa',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    persona:
      'Muted palettes are cowardice. You reward daring color, saturated skies, unapologetic vibrance, and photographers who embrace chromatic risk. Grayscale is acceptable only when it is a deliberate statement. You are the opposite of MinimalistEye on color — if the photo is safe, you are unimpressed.',
  },
  {
    id: 'starter_streetpurist',
    name: 'StreetPurist',
    color: '#ffaa00',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    persona:
      'Staged is dead. You reward candid moments, human presence, narrative tension, and the unrepeatable instant. A beautiful empty landscape scores mid at best — you want story, people, and authenticity. You penalize anything that looks posed, composed-to-death, or decorative without purpose.',
  },
  {
    id: 'starter_techcritic',
    name: 'TechCritic',
    color: '#00ff66',
    modelProvider: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    persona:
      'Only focus, exposure, and craft matter. You judge by technical execution: sharpness in the right places, exposure handled cleanly, dynamic range used well, rule of thirds, leading lines, depth of field used deliberately. Content is secondary to execution. You are the objective technician.',
  },
] as const;

// Tier thresholds from the Joulenomics v1 spec (in kJ earned)
const TIER_THRESHOLDS = {
  STAR: 1_000_000,
  BEACON: 100_000,
  FLAME: 10_000,
  GLOW: 1_000,
  SPARK: 0,
} as const;

function deriveTier(cumulativeKj: Decimal): 'SPARK' | 'GLOW' | 'FLAME' | 'BEACON' | 'STAR' {
  const n = cumulativeKj.toNumber();
  if (n >= TIER_THRESHOLDS.STAR) return 'STAR';
  if (n >= TIER_THRESHOLDS.BEACON) return 'BEACON';
  if (n >= TIER_THRESHOLDS.FLAME) return 'FLAME';
  if (n >= TIER_THRESHOLDS.GLOW) return 'GLOW';
  return 'SPARK';
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

function log(phase: string, msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${phase.padEnd(14)} ${msg}`);
}

// ---------------------------------------------------------------------------
// Legacy row shapes (what we read from the old DB)
// ---------------------------------------------------------------------------

interface LegacyUser {
  id: string;
  username: string;
  email: string;
  coins: number;
  userNumber: number;
  referralCode: string;
  referredBy: string | null;
  active: boolean;
  createdAt: Date;
}

interface LegacyPhoto {
  id: string;
  imageUrl: string;
  userId: string;
  category: string | null;
  aiScore: number | null;
  critique: string | null;
  computeKJ: number;
  nsfw: boolean;
  createdAt: Date;
}

interface LegacyAgent {
  id: string;
  name: string;
  persona: string | null;
  modelProvider: string;
  modelId: string;
  creatorId: string;
  color: string | null;
  verified: boolean;
  createdAt: Date;
}

interface LegacyHumanRating {
  id: string;
  photoId: string;
  userId: string;
  score: number;
  createdAt: Date;
}

interface LegacyAgentRating {
  id: string;
  photoId: string;
  agentId: string;
  score: number;
  critique: string | null;
  computeJoules: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Read legacy data
// ---------------------------------------------------------------------------

async function readLegacy() {
  const pg = new PgClient({ connectionString: OLD_DB });
  await pg.connect();
  log('read', 'connected to legacy database');

  const users = (await pg.query<LegacyUser>(
    'SELECT id, username, email, coins, "userNumber", "referralCode", "referredBy", active, "createdAt" FROM "User" ORDER BY "userNumber" ASC'
  )).rows;
  log('read', `users: ${users.length}`);

  const photos = (await pg.query<LegacyPhoto>(
    'SELECT id, "imageUrl", "userId", category, "aiScore", critique, "computeKJ", nsfw, "createdAt" FROM "Photo" ORDER BY "createdAt" ASC'
  )).rows;
  log('read', `photos: ${photos.length}`);

  const agents = (await pg.query<LegacyAgent>(
    'SELECT id, name, persona, "modelProvider", "modelId", "creatorId", color, verified, "createdAt" FROM "Agent" ORDER BY "createdAt" ASC'
  )).rows;
  log('read', `agents: ${agents.length}`);

  const humanRatings = (await pg.query<LegacyHumanRating>(
    'SELECT id, "photoId", "userId", score, "createdAt" FROM "HumanRating" ORDER BY "createdAt" ASC'
  )).rows;
  log('read', `human ratings: ${humanRatings.length}`);

  // Dedupe agent ratings on read: the old schema lacked a unique constraint,
  // so the same (photoId, agentId) pair may appear multiple times. Keep the
  // most recent row per pair.
  const rawAgentRatings = (await pg.query<LegacyAgentRating>(
    'SELECT id, "photoId", "agentId", score, critique, "computeJoules", "createdAt" FROM "AgentRating" ORDER BY "createdAt" DESC'
  )).rows;

  const seenAgentRatingKeys = new Set<string>();
  const agentRatings: LegacyAgentRating[] = [];
  let duplicatesSkipped = 0;
  for (const r of rawAgentRatings) {
    const key = `${r.photoId}::${r.agentId}`;
    if (seenAgentRatingKeys.has(key)) {
      duplicatesSkipped++;
      continue;
    }
    seenAgentRatingKeys.add(key);
    agentRatings.push(r);
  }
  log('read', `agent ratings: ${agentRatings.length} (skipped ${duplicatesSkipped} duplicates)`);

  await pg.end();
  return { users, photos, agents, humanRatings, agentRatings };
}

// ---------------------------------------------------------------------------
// Write to new database
// ---------------------------------------------------------------------------

async function writeNew(legacy: Awaited<ReturnType<typeof readLegacy>>) {
  const db = newPrisma(NEW_DB!);

  // Safety: target must be empty unless --reset was passed
  const existingUsers = await db.user.count();
  if (existingUsers > 0) {
    if (!RESET) {
      console.error(
        `ERROR: target database has ${existingUsers} users. Pass --reset to wipe, or point at an empty database.`
      );
      await db.$disconnect();
      process.exit(2);
    }
    log('reset', `wiping target database (${existingUsers} existing users)`);
    if (!DRY_RUN) {
      // Order matters — respect foreign keys
      await db.$transaction([
        db.ledgerEntry.deleteMany(),
        db.agentRating.deleteMany(),
        db.humanRating.deleteMany(),
        db.computeReceipt.deleteMany(),
        db.dailySettlement.deleteMany(),
        db.photo.deleteMany(),
        db.agent.deleteMany(),
        db.user.deleteMany(),
      ]);
    }
  }

  if (DRY_RUN) {
    log('dry-run', 'no writes will be performed');
  }

  // -------------------------------------------------------------------------
  // Phase 1: Users (two passes for self-referential referredBy)
  // -------------------------------------------------------------------------

  log('users', 'importing (pass 1: without referrals)');
  for (const u of legacy.users) {
    const balance = new Decimal(u.coins);
    const cumulative = balance; // fresh start: current balance = lifetime earnings
    const tier = deriveTier(cumulative);
    const isGenesis = u.userNumber <= 100;

    if (!DRY_RUN) {
      await db.user.create({
        data: {
          id: u.id, // preserve CUID for OAuth link continuity
          username: u.username,
          email: u.email,
          userNumber: u.userNumber,
          joulesBalance: balance,
          cumulativeJoulesEarned: cumulative,
          currentTier: tier,
          referralCode: u.referralCode,
          referredBy: null, // set in pass 2
          active: u.active,
          isGenesisMiner: isGenesis,
          createdAt: u.createdAt,
        },
      });
    }
  }
  log('users', `imported ${legacy.users.length} users`);

  log('users', 'pass 2: setting referredBy links');
  let referralsSet = 0;
  for (const u of legacy.users) {
    if (!u.referredBy) continue;
    const referrerExists = legacy.users.some((x: LegacyUser) => x.id === u.referredBy);
    if (!referrerExists) {
      log('users', `  orphan referral: user ${u.id} referredBy ${u.referredBy} (skipped)`);
      continue;
    }
    if (!DRY_RUN) {
      await db.user.update({
        where: { id: u.id },
        data: { referredBy: u.referredBy },
      });
    }
    referralsSet++;
  }
  log('users', `set ${referralsSet} referral links`);

  // -------------------------------------------------------------------------
  // Phase 2: Starter agents (owned by user #1)
  // -------------------------------------------------------------------------

  const userOne = legacy.users.find((u: LegacyUser) => u.userNumber === 1);
  if (!userOne) {
    console.error('ERROR: no user #1 found in legacy database — cannot seed starter agents');
    await db.$disconnect();
    process.exit(4);
  }

  log('starters', `seeding ${STARTER_AGENTS.length} starter agents owned by user #1 (${userOne.username})`);
  for (const a of STARTER_AGENTS) {
    if (!DRY_RUN) {
      await db.agent.create({
        data: {
          id: a.id,
          name: a.name,
          persona: a.persona,
          modelProvider: a.modelProvider,
          modelId: a.modelId,
          color: a.color,
          creatorId: userOne.id,
          agentType: 'STARTER',
          active: true,
          systemPromptHash: md5(a.persona),
          registrationFeeKj: new Decimal(0),
          verified: true,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: User-created agents (grandfathered at 0 kJ fee)
  // -------------------------------------------------------------------------

  log('agents', `importing ${legacy.agents.length} user-created agents (grandfathered)`);
  for (const a of legacy.agents) {
    const hash = md5(a.persona ?? 'default');
    if (!DRY_RUN) {
      await db.agent.create({
        data: {
          id: a.id,
          name: a.name,
          persona: a.persona,
          modelProvider: a.modelProvider,
          modelId: a.modelId,
          color: a.color,
          creatorId: a.creatorId,
          agentType: 'USER',
          active: true,
          systemPromptHash: hash,
          registrationFeeKj: new Decimal(0), // grandfathered, pre-genesis
          verified: a.verified,
          createdAt: a.createdAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 4: Photos
  // -------------------------------------------------------------------------

  log('photos', `importing ${legacy.photos.length} photos`);
  for (const p of legacy.photos) {
    const windowCloses = new Date(p.createdAt.getTime() + 24 * 60 * 60 * 1000);
    const scoreStatus = p.aiScore != null ? 'SCORED' : 'PENDING';
    const feedEligible = p.aiScore == null || p.aiScore >= 2.5;

    if (!DRY_RUN) {
      await db.photo.create({
        data: {
          id: p.id,
          imageUrl: p.imageUrl,
          userId: p.userId,
          category: p.category,
          aiScore: p.aiScore != null ? new Decimal(p.aiScore) : null,
          critique: p.critique,
          computeKj: new Decimal(p.computeKJ),
          scoreStatus,
          ratingWindowClosesAt: windowCloses,
          // humanConsensus* left null; the new cron will populate for photos
          // whose window is still open. Photos whose window has already
          // passed get humanResolvedAt set to signal "no more resolution"
          humanResolvedAt: windowCloses < new Date() ? windowCloses : null,
          publicFeedEligible: feedEligible,
          nsfw: p.nsfw,
          createdAt: p.createdAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 5: Human ratings (all marked as RESOLVED, pre-genesis)
  // -------------------------------------------------------------------------

  log('hratings', `importing ${legacy.humanRatings.length} human ratings`);
  for (const r of legacy.humanRatings) {
    if (!DRY_RUN) {
      await db.humanRating.create({
        data: {
          id: r.id,
          photoId: r.photoId,
          userId: r.userId,
          score: new Decimal(r.score),
          stakeAmount: new Decimal(5), // nominal; no stake was actually taken pre-genesis
          status: 'RESOLVED',
          resolvedAt: r.createdAt, // mark as resolved at creation time
          accuracyBand: null, // unknown — pre-genesis ratings have no IQR history
          rewardAmount: null,
          timingMultiplier: new Decimal(1.0),
          createdAt: r.createdAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 6: Agent ratings (deduped on read)
  // -------------------------------------------------------------------------

  log('aratings', `importing ${legacy.agentRatings.length} agent ratings`);
  for (const r of legacy.agentRatings) {
    if (!DRY_RUN) {
      await db.agentRating.create({
        data: {
          id: r.id,
          photoId: r.photoId,
          agentId: r.agentId,
          score: new Decimal(r.score),
          critique: r.critique,
          computeJoules: new Decimal(r.computeJoules),
          inConsensusBand: null, // unknown — pre-genesis, no IQR history
          computeReceiptId: null, // pre-genesis ratings have no receipts
          createdAt: r.createdAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Phase 7: Genesis ledger entries
  // -------------------------------------------------------------------------
  // Each user gets exactly one GENESIS_BONUS entry equal to their migrated
  // balance. This is the "block zero" of the Joulenomics v1 ledger. After
  // this, all integrity rules must hold.

  log('ledger', 'writing genesis ledger entries');
  for (const u of legacy.users) {
    const balance = new Decimal(u.coins);
    if (balance.isZero()) continue; // skip users with no balance

    if (!DRY_RUN) {
      await db.ledgerEntry.create({
        data: {
          userId: u.id,
          entryType: 'GENESIS_BONUS',
          amount: balance,
          balanceAfter: balance,
          referenceType: 'genesis_migration',
          referenceId: u.id,
          description: `Joulenomics v1 genesis migration (user #${u.userNumber})`,
          createdAt: u.createdAt, // attribute to the user's join time
        },
      });
    }
  }
  log('ledger', `wrote ${legacy.users.filter((u: LegacyUser) => u.coins > 0).length} genesis entries`);

  await db.$disconnect();
}

// ---------------------------------------------------------------------------
// Integrity verification
// ---------------------------------------------------------------------------

async function verifyIntegrity(): Promise<boolean> {
  const db = newPrisma(NEW_DB!);
  let allPassed = true;

  log('verify', 'running integrity checks');

  // Rule 3: sum of ledger amounts == sum of user balances
  const [ledgerSum, balanceSum] = await Promise.all([
    db.ledgerEntry.aggregate({ _sum: { amount: true } }),
    db.user.aggregate({ _sum: { joulesBalance: true } }),
  ]);
  const ledger = ledgerSum._sum.amount ?? new Decimal(0);
  const balances = balanceSum._sum.joulesBalance ?? new Decimal(0);
  if (ledger.equals(balances)) {
    log('verify', `  [ok] rule 3: ledger sum (${ledger}) == balance sum (${balances})`);
  } else {
    log('verify', `  [FAIL] rule 3: ledger sum (${ledger}) != balance sum (${balances})`);
    allPassed = false;
  }

  // Rule 4: each user's most recent ledger balanceAfter == their current balance
  const users = await db.user.findMany();
  let rule4Failures = 0;
  for (const u of users) {
    const last = await db.ledgerEntry.findFirst({
      where: { userId: u.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const expected = last?.balanceAfter ?? new Decimal(0);
    if (!u.joulesBalance.equals(expected)) {
      log(
        'verify',
        `  [FAIL] rule 4: user ${u.id} balance ${u.joulesBalance} != last ledger ${expected}`
      );
      rule4Failures++;
      allPassed = false;
    }
  }
  if (rule4Failures === 0) {
    log('verify', `  [ok] rule 4: ${users.length} users all reproducible from ledger`);
  }

  // Rule 1 and 2 are informational at genesis: no MINT or BURN entries exist yet
  const mints = await db.ledgerEntry.count({ where: { entryType: 'MINT' } });
  const burns = await db.ledgerEntry.count({ where: { entryType: 'BURN' } });
  log('verify', `  [info] rules 1/2: ${mints} MINT, ${burns} BURN entries (expected 0 at genesis)`);

  // Additional sanity: every photo's user exists, every rating's photo+user exist
  const orphanPhotos = await db.photo.count({
    where: { userId: { notIn: users.map((u) => u.id) } },
  });
  if (orphanPhotos > 0) {
    log('verify', `  [FAIL] ${orphanPhotos} orphan photos (missing user)`);
    allPassed = false;
  } else {
    log('verify', `  [ok] no orphan photos`);
  }

  // Starter agents present
  const starters = await db.agent.count({ where: { agentType: 'STARTER' } });
  if (starters !== STARTER_AGENTS.length) {
    log('verify', `  [FAIL] expected ${STARTER_AGENTS.length} starter agents, found ${starters}`);
    allPassed = false;
  } else {
    log('verify', `  [ok] ${starters} starter agents present`);
  }

  // No negative balances
  const negativeBalances = await db.user.count({
    where: { joulesBalance: { lt: 0 } },
  });
  if (negativeBalances > 0) {
    log('verify', `  [FAIL] ${negativeBalances} users have negative balances`);
    allPassed = false;
  } else {
    log('verify', `  [ok] no negative balances`);
  }

  // Agent rating uniqueness: no duplicate (photoId, agentId) pairs
  const totalAgentRatings = await db.agentRating.count();
  const distinctAgentRatings = await db.agentRating.groupBy({
    by: ['photoId', 'agentId'],
  });
  if (distinctAgentRatings.length !== totalAgentRatings) {
    log(
      'verify',
      `  [FAIL] agent rating dupes: ${totalAgentRatings} total vs ${distinctAgentRatings.length} distinct pairs`
    );
    allPassed = false;
  } else {
    log('verify', `  [ok] ${totalAgentRatings} agent ratings, all unique (photo, agent) pairs`);
  }

  // Summary counts
  const [photoCount, humanRatingCount, agentCount, ledgerCount] = await Promise.all([
    db.photo.count(),
    db.humanRating.count(),
    db.agent.count(),
    db.ledgerEntry.count(),
  ]);
  log('verify', `  summary: ${users.length} users, ${photoCount} photos, ${agentCount} agents`);
  log('verify', `  summary: ${humanRatingCount} human ratings, ${totalAgentRatings} agent ratings`);
  log('verify', `  summary: ${ledgerCount} ledger entries`);

  await db.$disconnect();
  return allPassed;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log('main', `flags: ${Array.from(FLAGS).join(', ') || '(none)'}`);

  if (VERIFY_ONLY) {
    const ok = await verifyIntegrity();
    process.exit(ok ? 0 : 1);
  }

  try {
    const legacy = await readLegacy();
    await writeNew(legacy);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(4);
  }

  log('main', 'import complete — running verification');
  const ok = await verifyIntegrity();

  if (ok) {
    log('main', 'all integrity checks passed');
    process.exit(0);
  } else {
    log('main', 'INTEGRITY CHECK FAILED — review output above');
    process.exit(1);
  }
}

main();
