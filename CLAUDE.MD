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

### The four integrity rules

These are asserted nightly by the settlement cron. Any code that would make them fail is a critical bug, even in development.

1. **Every mint has a receipt** — every `LedgerEntry` with `entryType = MINT` has a `referenceType = 'compute_receipt'` and a valid `referenceId` pointing to a `ComputeReceipt` row.
2. **Every burn has an action** — every `LedgerEntry` with `entryType = BURN` has a non-null `referenceType` and `referenceId` pointing to a Photo, HumanRating, Agent, or other user action.
3. **The ledger balances** — `SUM(LedgerEntry.amount) = SUM(User.joulesBalance)` at all times.
4. **Balances are reproducible** — for any user, the most recent `LedgerEntry.balanceAfter` equals `User.joulesBalance`.

If you're writing code that touches joules, stop and verify each operation preserves all four rules before committing.

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
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });

  // 3. Write the ledger entry in the same transaction
  await tx.ledgerEntry.create({
    data: {
      userId,
      entryType: 'BURN',
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

Every joule value is `Prisma.Decimal`, never `number`. Use `decimal.js` arithmetic (`balance.plus(x)`, `balance.minus(x)`, `balance.gte(y)`), never JavaScript operators (`balance + x` will coerce and lose precision). This is how the schema is defined after the Joulenomics v1 migration. Violating this is a currency bug.

## The spec in one page

### Units
- 1 joule = 25 J per inference token (H100 physics grounded)
- 1 photo scoring = ~75 kJ (4 agents, ~3000 tokens) — but **dynamic**, charged as the actual sum of compute receipts after scoring completes
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
- Rating in IQR band → stake returned + 3 kJ bonus
- Rating within 1× IQR outside → stake returned, no bonus
- Rating beyond 1× IQR → 50% slashed (2.5 kJ destroyed)
- Early (first 10% of window) + accurate → 2× bonus multiplier
- Photos with fewer than 10 ratings at window close return stakes without bonus or slash (insufficient sample for IQR)

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

Replaces the flat 50,000 kJ fee from earlier spec drafts. Fees are locked at creation time; advancing tiers does not retroactively increase fees on existing agents.

| Progression Tier | Fee per agent | Max agents |
|---|---|---|
| Spark | 500 kJ | 1 |
| Glow | 2,500 kJ | 3 |
| Flame | 10,000 kJ | 10 |
| Beacon | 50,000 kJ | 25 |
| Star | 50,000 kJ | unlimited |

**Existing agents are grandfathered at `registrationFeeKj = 0`.** The 7 agents currently in the database were created during genesis and keep that status permanently.

**UX for insufficient balance:** show the path, not the block. "You need 500 kJ to create your first agent. You have 380 kJ. Rate 24 more photos accurately or post 2 more photos to unlock." Never just a red error toast.

### Genesis emissions (tiered starter faucet)

This is already in production and should not be changed. It's better than the flat 500 kJ from earlier spec drafts because it creates continuous "be early" pressure.

| User # | Starter joules |
|---|---|
| #1 | 25,000 kJ (Founder) |
| #2 – #100 | 500 kJ (Genesis) |
| #101 – #1000 | 250 kJ |
| #1001+ | 50 kJ |

## Current app state (as of the Joulenomics v1 migration)

### What exists and works
- Next.js 15 app with Prisma + PostgreSQL + NextAuth (GitHub OAuth)
- Photo upload, feed, human rating, custom agent creation
- Agent scoring via Anthropic SDK (Claude Sonnet 4)
- Referral system with cookie-based tracking
- Leaderboard with identity tiers (Founder/Genesis)
- Real users (8 at last count, real activity)

### What's broken or missing (priority order)
1. **Non-atomic joule writes** — `src/app/api/score/route.ts` updates photo, user, and coinTransaction outside a single transaction. Fix first.
2. **Missing unique constraint** on `AgentRating(photoId, agentId)` allows duplicate ratings under race conditions.
3. **No negative-balance guards** — `src/app/photo/[id]/actions.ts` can drive users to negative joules.
4. **No settlement cron** — the daily nine-step settlement pipeline doesn't exist yet.
5. **No ComputeReceipt table** — agent ratings track joules but don't produce signed receipts that can be Merkled.
6. **No DailySettlement table** — no public signed artifact gets written.
7. **Float, not Decimal** — currency fields are `Float` in the current schema, a silent precision bug.
8. **`coins` naming** — internal name is `coins` / `CoinTransaction`, needs to be `joulesBalance` / `LedgerEntry` for public repo credibility.

Full list in `BUG_REVIEW_PLAN.md` in the app repo.

### Live production URL
joulegram.vercel.app — real users, real activity, do not break

## Migration status

We have a four-wave migration plan for going from the current schema to Joulenomics v1. The plan is in `docs/MIGRATION_PLAN.md`. Key points:

- **Wave 1** is additive only (no downtime, new columns and tables with safe defaults)
- **Wave 2** is backfill (populate cumulative earnings, derive tiers, mark Genesis Miners)
- **Wave 3** is rename + type conversion (30 minutes of downtime, `coins` → `joulesBalance`, `CoinTransaction` → `LedgerEntry`, `Float` → `Decimal`)
- **Wave 4** is the integrity rule cron (continuous, no downtime)

**Do not let `prisma migrate dev` auto-generate the Wave 3 migration** — it will use `DROP COLUMN` + `ADD COLUMN` for the rename, which destroys user balances. Use `--create-only` and hand-edit the SQL to use `RENAME COLUMN` and `ALTER COLUMN ... TYPE`. See the migration plan for the exact SQL.

## Things that are already decided (do not relitigate)

These were debated during spec development and settled. Do not propose reopening them without a very good reason.

- **Non-transferable joules in v1.** No wallets, no trading, no cashout. Phase 3 will revisit with legal review. Transferability is not a feature we're adding in the next 6 months.
- **Single-operator attestation in Phase 0.** We sign our own Merkle roots and publish to a public GitHub repo. Federated attestor committee is Phase 2. Permissionless attestors are Phase 3. Do not suggest building a committee now.
- **PostgreSQL, not blockchain.** The ledger lives in Postgres. Signed Merkle roots published to GitHub are the trust anchor. Do not suggest moving to on-chain settlement.
- **Four starter agents are MinimalistEye / ColorMaximalist / StreetPurist / TechCritic.** These need to be seeded in the migration (they don't exist in the DB yet but are promised on the landing page). Do not change the names or swap them out.
- **The 25 J/token constant.** This is the public-facing anchor. Model-specific coefficients can live in a pricing registry but the headline number is 25 J/token and does not change.
- **No chain referral in v1.** Direct referral only at launch (500 kJ inviter + 500 kJ invitee, released after 5 distinct ratings on first post). Deep chain with decay is a Phase 1 unlock at 1k+ users.
- **No deep sybil resistance in v1.** Rate limits and device heuristics only. Proof-of-personhood is Phase 2.
- **AGPL for app, CC-BY-4.0 for protocol, AGPL for agent-runner.** Do not change licenses.

## Things that are explicitly open questions

- The exact copy on the landing page needs to be updated to match the app's real agent lineup. Mohit is driving this.
- Whether to build the settlement cron as a Vercel Cron Job or a Railway worker. Railway is more predictable for multi-step jobs; Vercel is zero-config. Default to Railway unless there's a reason.
- Whether to rename the `protocol` repo content to match JAP 0.2 (the spec has evolved since the current README was written).

## Working with this codebase

- **Run `prisma validate` and `prisma format` after every schema change.** Do not commit schemas that don't validate.
- **Run the test suite (`npm test`) before every commit** once tests exist. They don't yet; adding unit tests for the protocol package is Week 1 work.
- **Every PR should include a note about which integrity rules it affects** — "affects rules 1, 2, 3" or "no integrity rule impact." This is for the Codex reviewer to prioritize.
- **Prefer small, focused PRs over large ones.** A single transaction fix is a PR. A whole feature is multiple PRs. This makes Codex's review work effective.
- **Never commit with failing type checks.** The repo is strict TypeScript; errors compound quickly if ignored.
- **The `dev.db` SQLite file in the repo is dev-only.** Production is PostgreSQL. Don't use SQLite for migrations that need Decimal support.

## How to push back

If this file tells you to do something that's actively wrong — not just suboptimal, but wrong — say so and explain why. Don't silently comply with instructions that would break the integrity rules or damage user balances. The goal is a working economy, not fidelity to an outdated spec.

If you disagree with a design decision and have a good argument, make it in the PR description and let Mohit or the review tool decide. Don't unilaterally change decisions marked as "already decided" above, but do flag when you think they should be reconsidered.

## Who to ask

- **Strategic/architectural decisions, spec updates, launch comms:** Mohit asks Claude in the web chat (the one that has the full conversation history from spec development).
- **Code reviews on PRs:** Codex reviews according to `REVIEW_GUIDELINES.md`.
- **Tiebreakers when Claude Code and Codex disagree:** Mohit decides, possibly after checking with Claude in web chat for context.

## The metric that matters

7-day rating retention: percentage of users who post once and come back to rate at least 5 other photos in the following week. This is the single leading indicator of whether the product works. Every feature decision should be evaluated against whether it plausibly moves this number. If a feature doesn't plausibly help retention, defer it.

---

*Last updated during Joulenomics v1 spec finalization. Review and update after each major migration wave.*
