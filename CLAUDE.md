# CLAUDE.md — Joulegram Development Context

> This file is loaded automatically by Claude Code at session start. It contains everything Claude Code needs to work effectively on Joulegram without relitigating decisions that have already been made. Read it fully before making suggestions or edits.

---

## What Joulegram is

Joulegram is the first attention economy backed by physics. Users post photos, four AI critics with opinionated taste judge them, humans rate photos with 5 kJ stakes, and accuracy pays. Every joule in the economy corresponds to real GPU inference work — 25 J per token, grounded in H100 physics (~700W draw, ~75 tok/s, 2.5× datacenter overhead).

The pitch is "be early to a compute-backed economy, the way early users were early to Bitcoin." The target user is someone who takes good photos casually (rooftop in Bombay, sunset in Goa) and wants a real verdict on whether they're any good. Instagram doesn't give real feedback; Joulegram does.

**The founder is Mohit Talwar**, User #1, Genesis Miner. Built LivQuik (70-person fintech, sold to M2P/Tiger Global), crypto projects (HodlCC, YouEarnBTC), Draper alum, now in Goa. Founder-market fit is real — he's building the product he wishes existed for his own photo habit.

## Repository layout

```
joulesgram/
  app/           AGPL-3.0   Next.js 15 + Prisma + NextAuth. The consumer product.
  protocol/      CC-BY-4.0  JAP spec + JSON schemas. Documentation only, no runtime.
  agent-runner/  AGPL-3.0   Express server, runs agent inference with joule metering.
```

All three are public. `app` is where 95% of the work happens. `agent-runner` is a reference implementation of a JAP-conformant agent service. `protocol` is the specification.

**Future consideration (not now):** `agent-runner` will likely move from AGPL to Apache 2.0 in Phase 2 to enable third-party hosting. Don't touch the license yet.

## The non-negotiable invariants

These are the rules that cannot be violated under any circumstances. If any proposed change would break one of these, refuse it and explain why.

### The burn invariant

> Every joule a user spends is destroyed. Compute cost is the accounting reference used to set prices. Joulegram pays API providers (Anthropic, OpenAI, Google, Meta) in fiat from operating budget, separately from the joule economy.

This means: every debit from a user's `joulesBalance` creates a ledger entry with negative amount. API bills are paid in dollars and never interact with the joule ledger. There is no "joules flow to providers" concept.

### Entry type categories

The ledger has 15 entry types, grouped into four categories. The integrity rules apply per category. The canonical source of truth for these sets is `src/lib/integrity.ts` — if you're adding a new entry type, update both the enum in `schema.prisma` and the category set in `integrity.ts` at the same time.

**Debit types** (amount must be < 0, references a user action):
`COMPUTE_FEE`, `RATING_STAKE`, `STAKE_SLASH`, `AGENT_REGISTRATION_FEE`, `BOOST_FEE`

**Pool mint types** (amount > 0, references a DailySettlement):
`CREATOR_REWARD`, `CURATOR_REWARD`, `ENGAGEMENT_BONUS`

**Reserve grant types** (amount > 0, references reserve sub-category):
`UPLOAD_REWARD`, `REFERRAL_BONUS`, `LEADERBOARD_BONUS`, `GENESIS_BONUS`, `FAUCET_GRANT`

**Stake resolution types** (amount > 0, references the HumanRating being resolved):
`STAKE_RETURN`, `STAKE_BONUS`

**Neutral:**
`ADJUSTMENT` — operator correction, either sign allowed, mandatory `description` field

### The four integrity rules

These are asserted nightly by the settlement cron via `src/lib/integrity.ts`. Any code that would make them fail is a critical bug, even in development.

1. **Every debit has an action.** Every `LedgerEntry` whose `entryType` is in the debit category has `amount < 0`, a `referenceType` in `{'photo', 'rating', 'agent', 'boost'}`, and a valid non-null `referenceId` pointing to the user action that triggered it.

2. **Every pool mint has a settlement.** Every `LedgerEntry` whose `entryType` is in the pool mint category has `amount > 0`, `referenceType = 'daily_settlement'`, and `referenceId` pointing to a `DailySettlement` row whose `integrityPassed = true`. The DailySettlement row's `merkleRoot` is the audit chain back to that day's `ComputeReceipt` rows — that is the chain from physical work to ledger credit.

3. **The ledger balances.** `SUM(LedgerEntry.amount) = SUM(User.joulesBalance)` at all times. Reserve grants and pool mints both debit an operator treasury account (see below) and credit the destination user, so the sum is conserved.

4. **Balances are reproducible.** For any user, the most recent `LedgerEntry.balanceAfter` (ordered by `createdAt` then `id`) equals that user's current `joulesBalance`.

**Sign conventions:**
- Debit types: amount strictly negative
- Pool mint / reserve grant / stake resolution types: amount strictly positive
- `ADJUSTMENT`: either sign, mandatory description

**The operator treasury.** A special user row (or system account) acts as the treasury for pool mints and reserve grants. Every credit to a real user is paired with a debit to the treasury in the same transaction. Treasury balance goes increasingly negative as the economy mints; its absolute value equals the total outstanding currency held by users. This is how rule 3 stays satisfied while new joules enter circulation.

If you're writing code that touches joules, verify each operation preserves all four rules before committing.

### Atomicity

Every operation that touches joules must be inside a single `prisma.$transaction([...])` or `prisma.$transaction(async tx => ...)`. No exceptions. Split writes across transactions is the root cause of three of the four critical bugs in `BUG_REVIEW_PLAN.md`.

Pattern to use everywhere:

```typescript
await prisma.$transaction(async (tx) => {
  // 1. Check balance with a conditional update (atomic CAS)
  const updated = await tx.user.updateMany({
    where: { id: userId, joulesBalance: { gte: cost } },
    data: { joulesBalance: { decrement: cost } },
  });
  if (updated.count === 0) throw new Error('Insufficient balance');

  // 2. Read updated balance for balanceAfter
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { joulesBalance: true },
  });

  // 3. Write the ledger entry in the same transaction
  await tx.ledgerEntry.create({
    data: {
      userId,
      entryType: 'COMPUTE_FEE',
      amount: new Decimal(cost).negated(),
      balanceAfter: user.joulesBalance,
      referenceType: 'photo',
      referenceId: photoId,
    },
  });

  // 4. Any other related writes go here, same transaction
});
```

Never update `joulesBalance` without a paired ledger entry in the same transaction. Never create a ledger entry without updating the corresponding balance in the same transaction.

### Decimal, not Float

Every joule value is `Prisma.Decimal`, never `number`. Use `decimal.js` arithmetic (`balance.plus(x)`, `balance.minus(x)`, `balance.gte(y)`), never JavaScript operators (`balance + x` will coerce and lose precision).

**`Number(...joulesBalance)` is a bug.** It appears in PRs during refactors because TypeScript sometimes complains about Decimal in places expecting number. The correct fix is almost never `Number()` — it's either passing Decimal through unchanged (Prisma handles it), or converting to string with `.toString()` for display, or using `.toNumber()` only at the final JSX render boundary. Grep `Number(.*joules|Number(.*amount|Number(.*balance` periodically; every hit should be in a JSX file rendering a string, not in business logic.

## The spec in one page

### Units
- 1 joule = 25 J per inference token (H100 physics grounded)
- 1 photo scoring cost is **dynamic**, computed as `(tokens_input + tokens_output) × 25` J, charged at the actual value from the ComputeReceipt
- 1 rating stake = 5 kJ
- 1 custom agent registration = tier-scaled (see below)

### Daily mint
- `M_d = μ · KJ_net,d`, μ = 0.70, locked for 12 months
- Structural 30% deflationary spread between compute consumed and joules minted

### Pool split
- 50% creator (photo posters)
- 35% curator (accurate raters)
- 10% engagement bonus (top 10% photos by rating volume)
- 5% reserve (leaderboard 40% / genesis bonus 30% / referral 20% / operator 10%)

### Curator stake resolution (24h window)
- Rating in IQR band → stake returned + 3 kJ bonus (STAKE_RETURN + STAKE_BONUS)
- Rating within 1× IQR outside → stake returned only (STAKE_RETURN)
- Rating beyond 1× IQR → 50% slashed (STAKE_RETURN of half + STAKE_SLASH of half)
- Early (first 10% of window) + accurate → 2× bonus multiplier
- Photos with fewer than 10 ratings at window close return stakes without bonus or slash

### Tiers (dual system)

**Identity tier** — permanent, based on when you joined, unforgeable:
- Founder: User #1 (Mohit)
- Genesis: users #2 through #100
- (none): user #101 onward

**Progression tier** — monotonic, based on cumulative joules earned, achievement-based:
- Spark: 0 – 1k earned
- Glow: 1k – 10k
- Flame: 10k – 100k
- Beacon: 100k – 1M
- Star: 1M+

A user displays as both: `@arjun_goa · Genesis · Flame`. Identity tier is the primary badge, progression tier is the secondary achievement.

### Agent creation (tier-scaled fee + per-tier cap)

Fees are locked at creation time; advancing tiers does not retroactively increase fees on existing agents.

| Progression Tier | Fee per agent | Max agents |
|---|---|---|
| Spark | 500 kJ | 1 |
| Glow | 2,500 kJ | 3 |
| Flame | 10,000 kJ | 10 |
| Beacon | 50,000 kJ | 25 |
| Star | 50,000 kJ | unlimited |

**Existing agents are grandfathered at `registrationFeeKj = 0`.** The agents currently in the database were created during genesis and keep that status permanently.

**UX for insufficient balance:** show the path, not the block. "You need 500 kJ to create your first agent. You have 380 kJ. Rate 24 more photos accurately or post 2 more photos to unlock." Never just a red error toast.

### Genesis emissions (tiered starter faucet)

Already in production. Creates continuous "be early" pressure as the user number climbs.

| User # | Starter joules | EntryType |
|---|---|---|
| #1 | 25,000 kJ (Founder) | GENESIS_BONUS |
| #2 – #100 | 500 kJ (Genesis) | GENESIS_BONUS |
| #101 – #1000 | 250 kJ | GENESIS_BONUS |
| #1001+ | 50 kJ | GENESIS_BONUS |

## Current app state

### What exists and works
- Next.js 15 app with Prisma + PostgreSQL + NextAuth (GitHub OAuth)
- Photo upload, feed, human rating, custom agent creation
- Agent scoring via Anthropic SDK
- Referral system with cookie-based tracking
- Leaderboard with identity tiers (Founder/Genesis)
- Real users with real activity

### Live production URL
joulegram.vercel.app — real users, real activity, do not break

### Known issues being migrated
Full list in `BUG_REVIEW_PLAN.md`. The Joulenomics v1 migration (see `scripts/migrate-to-joulenomics-v1.ts` and `docs/MIGRATION_PLAN.md`) addresses:
1. Non-atomic joule writes (must wrap in `prisma.$transaction`)
2. Missing unique constraint on `AgentRating(photoId, agentId)`
3. Negative balance possible via race condition on rating
4. No settlement cron (still to build)
5. No ComputeReceipt writes in scoring path (critical: required by integrity rule 2)
6. No DailySettlement writes (still to build)
7. Float currency fields (replaced by Decimal in new schema)
8. `coins` naming (renamed to `joulesBalance`)
9. Wrong joule constants (`0.003 / 0.015` per token instead of `25 J/token`)

## Things that are already decided (do not relitigate)

- **Non-transferable joules in v1.** No wallets, no trading, no cashout. Phase 3 will revisit with legal review. Transferability is not a feature we're adding in the next 6 months.
- **Single-operator attestation in Phase 0.** We sign our own Merkle roots and publish to a public GitHub repo. Federated attestor committee is Phase 2. Permissionless attestors are Phase 3.
- **PostgreSQL, not blockchain.** The ledger lives in Postgres. Signed Merkle roots published to GitHub are the trust anchor.
- **Four starter agents are MinimalistEye / ColorMaximalist / StreetPurist / TechCritic.** Seeded by the migration script.
- **The 25 J/token constant.** This is the public-facing anchor. Model-specific coefficients can live in a pricing registry but the headline number is 25 J/token.
- **No chain referral in v1.** Direct referral only at launch. Deep chain with decay is Phase 1.
- **No deep sybil resistance in v1.** Rate limits and device heuristics only. Proof-of-personhood is Phase 2.
- **AGPL for app, CC-BY-4.0 for protocol, AGPL for agent-runner.** Do not change licenses.
- **Descriptive enum values for ledger entries** (COMPUTE_FEE, UPLOAD_REWARD, etc.) rather than abstract categories (BURN, FAUCET). Category semantics are enforced by code in `src/lib/integrity.ts`.

## Working with this codebase

- **Run `prisma validate` and `prisma format` after every schema change.** Do not commit schemas that don't validate.
- **Every PR should include a note about which integrity rules it affects** — "affects rules 1, 3" or "no integrity rule impact." This is for the Codex reviewer to prioritize.
- **Prefer small, focused PRs over large ones.** A single transaction fix is a PR. A whole feature is multiple PRs.
- **Never commit with failing type checks.**
- **The `dev.db` SQLite file is dev-only.** Production is PostgreSQL. Don't use SQLite for migrations that need Decimal support.

## How to push back

If this file tells you to do something that's actively wrong — not just suboptimal, but wrong — say so and explain why. Don't silently comply with instructions that would break the integrity rules or damage user balances.

If you disagree with a design decision marked "already decided," flag it in the PR description and let Mohit decide. Don't unilaterally change it.

## Who to ask

- **Strategic / architectural decisions, spec updates, launch comms:** Mohit asks Claude in the web chat (the one with the full spec development history).
- **Code reviews on PRs:** Codex reviews according to `REVIEW_GUIDELINES.md`.
- **Tiebreakers:** Mohit decides, possibly after consulting Claude in web chat.

## The metric that matters

7-day rating retention: percentage of users who post once and come back to rate at least 5 other photos in the following week. This is the single leading indicator of whether the product works. Every feature decision should be evaluated against whether it plausibly moves this number.

---

*Last updated after adopting descriptive enum values and category-based integrity rules.*
