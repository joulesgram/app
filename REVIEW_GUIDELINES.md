# REVIEW_GUIDELINES.md — Codex Review Guide for Joulegram

> This file is for Codex when reviewing pull requests on the Joulegram codebase. It defines what to prioritize, what to flag, and what to skip. The goal is high-signal reviews that catch real bugs without drowning Claude Code in stylistic churn.

---

## Priority order (top-down)

When reviewing any PR, scan for issues in this exact order. Do not skip up the list to nitpick something lower on the list — higher-priority issues must be addressed first.

1. **Integrity rule violations** — anything that would break one of the four integrity rules in `CLAUDE.md`. These are blockers.
2. **Correctness bugs** — wrong math, wrong SQL, missing null checks, race conditions, broken invariants. Blockers.
3. **Spec compliance** — the change doesn't match the final spec or the decisions documented in `CLAUDE.md` under "Things that are already decided." Usually blockers unless justified in the PR description.
4. **Security concerns** — injection, auth bypass, privilege escalation, secret exposure. Blockers.
5. **Performance issues that affect user experience** — N+1 queries, blocking calls in hot paths, missing indexes on new columns. Usually blockers for merged code; can be follow-up PRs if the scope is small.
6. **Maintainability** — confusing names, missing documentation on non-obvious logic, dead code. Advisory unless it's in a hot path.
7. **Style** — formatting, import ordering, comment wording. Only flag if the PR is already clean on everything above and the project has style consistency rules being violated. **Otherwise skip entirely.**

Most reviews should stay in items 1–5. If you're spending time on items 6–7, you're reviewing the wrong thing.

---

## The integrity rules checklist (category-based)

The four integrity rules are enforced per **category** of ledger entry, not per individual `entryType`. The source of truth for category membership is `src/lib/integrity.ts`, which exports four sets: `DEBIT_TYPES`, `POOL_MINT_TYPES`, `RESERVE_GRANT_TYPES`, `STAKE_RESOLUTION_TYPES`. If a new `EntryType` is added to the enum, it MUST also be added to exactly one of those sets — flag any PR that adds an enum value without updating the sets.

### Rule 1 — Every debit has an action

For every new `LedgerEntry` where `entryType` is in `DEBIT_TYPES`:

- [ ] `amount` is strictly less than zero (debits are negative)
- [ ] `referenceType` is non-null and one of: `'photo'`, `'rating'`, `'agent'`, `'boost'`
- [ ] `referenceId` is non-null and points at a real row in the referenced table
- [ ] The reference makes semantic sense: a `COMPUTE_FEE` references a photo, a `RATING_STAKE` references a rating, an `AGENT_REGISTRATION_FEE` references an agent, a `BOOST_FEE` references a photo or rating being boosted
- [ ] The write is inside the same `prisma.$transaction` as the `joulesBalance` decrement

### Rule 2 — Every pool mint has a settlement

For every new `LedgerEntry` where `entryType` is in `POOL_MINT_TYPES` (`CREATOR_REWARD`, `CURATOR_REWARD`, `ENGAGEMENT_BONUS`):

- [ ] `amount` is strictly greater than zero
- [ ] `referenceType === 'daily_settlement'`
- [ ] `referenceId` is a valid date string matching an existing `DailySettlement.date`
- [ ] The referenced `DailySettlement.integrityPassed` is `true`
- [ ] Pool mints happen only inside the settlement cron, never in a user-facing request handler

Pool mint entries should never be created from API routes or server actions. Flag any PR that creates `CREATOR_REWARD` / `CURATOR_REWARD` / `ENGAGEMENT_BONUS` entries from anywhere other than the settlement cron.

### Rule 2b — Reserve grants and stake resolutions are checked loosely

For `LedgerEntry` where `entryType` is in `RESERVE_GRANT_TYPES` or `STAKE_RESOLUTION_TYPES`:

- [ ] `amount` is strictly greater than zero
- [ ] `referenceType` and `referenceId` are set (what they point at depends on the type — `UPLOAD_REWARD` points at a photo, `REFERRAL_BONUS` points at the referred user, `STAKE_RETURN` points at the resolved rating)
- [ ] The write is paired with a `joulesBalance` increment in the same transaction

### Rule 3 — The ledger balances

For any PR that adds new write paths:

- [ ] Every `joulesBalance` change has a paired `LedgerEntry` in the same transaction
- [ ] Every `LedgerEntry` creation has a paired `joulesBalance` change in the same transaction
- [ ] The operator treasury row is correctly debited when pool mints or reserve grants are issued (every credit to a user must be paired with a debit to the treasury to conserve `SUM(amount) == SUM(balances)`)
- [ ] `ADJUSTMENT` entries include a mandatory `description` field explaining the correction

### Rule 4 — Balances reproducible

For every `LedgerEntry` created:

- [ ] `balanceAfter` is set to the user's `joulesBalance` **after** the balance update in the same transaction
- [ ] `balanceAfter` is a `Prisma.Decimal`, never `Number(...)` (using `Number` on a Decimal at this boundary is a precision bug)
- [ ] The `balanceAfter` is read from an updated user row inside the transaction, not from a stale read from before the update

**How to read this fast:** look at every `tx.ledgerEntry.create(...)` and every `tx.user.update(...)` or `tx.user.updateMany(...)` that touches `joulesBalance`. For each one, ask: where is its pair? If the pair is in a different `prisma.$transaction()` call — or outside one entirely — it's a bug. If the pair doesn't exist at all, it's a bug.

---

## The atomicity pattern

The correct pattern for any joule-touching operation is:

```typescript
await prisma.$transaction(async (tx) => {
  // 1. Atomic conditional update for debits
  const updated = await tx.user.updateMany({
    where: { id: userId, joulesBalance: { gte: cost } },
    data: { joulesBalance: { decrement: cost } },
  });
  if (updated.count === 0) throw new InsufficientBalanceError();

  // 2. Read updated state for balanceAfter
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { joulesBalance: true },
  });

  // 3. Write the ledger entry with the specific EntryType, not a generic value
  await tx.ledgerEntry.create({
    data: {
      userId,
      entryType: 'COMPUTE_FEE', // pick from the right category set
      amount: cost.negated(),
      balanceAfter: user.joulesBalance, // Decimal, not Number(...)
      referenceType: 'photo',
      referenceId: photoId,
    },
  });

  // 4. Any related domain writes go here, same transaction
  await tx.photo.update(/* ... */);
});
```

**Flag any deviation from this pattern.** Common deviations to catch:

- **Non-atomic balance reads:** `const user = await prisma.user.findUnique(...)` followed by `if (user.joulesBalance.gte(cost))` followed by an update. Race condition. Use `updateMany` with a `where` clause instead.
- **Split transactions:** `await prisma.user.update(...)` and `await prisma.ledgerEntry.create(...)` as separate top-level calls. Must be inside one `$transaction` block.
- **Using `prisma` instead of `tx` inside a transaction:** accidentally calling `prisma.something` inside a `$transaction(async (tx) => ...)` block uses the top-level connection and escapes the transaction. Always use `tx.*` inside the callback.
- **Missing `balanceAfter`:** creating a `LedgerEntry` without computing the post-update balance. Breaks rule 4.
- **`Number(...joulesBalance)` or `Number(...balanceAfter)`:** converting Decimals to JavaScript numbers at write boundaries. Breaks rule 4 silently and sets precedent for precision bugs elsewhere. The ONLY place `Number(...)` is acceptable is the very last step before rendering to a JSX element.
- **Float arithmetic:** using `+`, `-`, `>=` on `Decimal` values coerces them to JavaScript numbers and loses precision. Must use `.plus()`, `.minus()`, `.gte()`, etc. from decimal.js.
- **Generic or wrong `entryType`:** using a placeholder like `BURN` or `MINT` when a specific type exists. Every debit should pick the right one from `DEBIT_TYPES`, every credit from one of the credit-category sets.

---

## Spec compliance checks

Flag any of these:

- Transferable joules (wallets, sends, cashouts) — **blocker**
- A federated or permissionless attestor committee — **blocker until Phase 2**
- On-chain settlement or smart contracts — **blocker**
- Deep chain referral with decay — **blocker until Phase 1 (1k+ users)**
- Proof-of-personhood integration — **blocker until Phase 2**
- Changes to the 25 J/token constant — **blocker**
- Changes to license files — **blocker**
- Changes to the four starter agent names (MinimalistEye / ColorMaximalist / StreetPurist / TechCritic) — **blocker**
- New `EntryType` enum values that aren't added to the category sets in `integrity.ts` — **blocker** (would silently bypass integrity rules)

---

## Schema and migration review

For any PR that touches `prisma/schema.prisma` or adds a file under `prisma/migrations/`:

1. **Does the migration use `DROP COLUMN` for anything named `coins` or `CoinTransaction`?** If yes, **blocker** — this destroys user balances. Must use `RENAME COLUMN` / `RENAME TO` and `ALTER COLUMN ... TYPE` with a `USING` clause.
2. **Does the migration add a new column with `NOT NULL` and no default?** If the table has existing rows, this will fail on production.
3. **Does the migration add a unique constraint without first deduping existing data?** If yes, it'll fail on production.
4. **Are all new currency fields `Decimal` with appropriate precision?** `Decimal(24, 6)` for balances, `Decimal(20, 6)` for amounts, `Decimal(5, 2)` for scores. Flag any new `Float` fields for currency.
5. **Does it add a new `EntryType` enum value?** If yes, verify that `src/lib/integrity.ts` has been updated in the same PR to include the new value in exactly one of the four category sets. A new enum value without category membership is a **blocker**.
6. **Was `prisma validate` run?** If the PR description doesn't confirm this, ask for it.

---

## Scoring pipeline specific checks

The photo scoring flow is especially error-prone. For PRs touching `src/app/api/score/route.ts` or related files:

- **Is the scoring idempotent?** It should use the `scoreStatus` field with an atomic check-and-set (`updateMany where scoreStatus = 'PENDING' set scoreStatus = 'SCORING'`) rather than checking `aiScore IS NULL`. The `IS NULL` check races.
- **Is compute cost settled dynamically from actual tokens?** The PR should read actual `tokensInput` / `tokensOutput` from the response and charge the user the actual `(input + output) * 25` joules, not a fixed constant. A fixed `PHOTO_SCORE_KJ` is a spec violation.
- **Does the scoring route use `JOULES_PER_TOKEN = 25`?** Not `0.003` / `0.015` or any other constants. The 25 J/token constant is the physics anchor and must be used unchanged.
- **Does every scoring job produce a `ComputeReceipt`?** Every scoring call should write one `ComputeReceipt` row with input/output hashes, model version, token counts, and `kjValue`. Every `AgentRating` in the batch links to that receipt via `computeReceiptId`.
- **Does scoring failure refund the user?** If the Anthropic call or parsing fails after the user was pre-debited, the transaction must include a compensating ledger entry (typically an `ADJUSTMENT` credit) and the photo must transition to `FAILED` — not back to `PENDING`.
- **Is the terminal state correct?** `scoreStatus` transitions are `PENDING → SCORING → SCORED` on success or `PENDING → SCORING → FAILED` on failure. `SCORING → PENDING` is never valid.

---

## What to skip (do not flag)

Do not flag any of the following unless the PR is already clean on higher-priority items:

- **Formatting preferences** — line length, semicolons, quote style. The repo uses Prettier defaults; anything that passes `prettier --check` is fine.
- **Variable naming bike-shedding** — if the name is clear, don't suggest a better one. Only flag names that are actively misleading.
- **Additional comments** — don't request comments on code that's self-explanatory.
- **"Consider refactoring..." without a concrete issue** — vague refactoring suggestions are noise.
- **Alternative approaches that are equally valid** — if Claude Code's approach works and matches the spec, don't suggest a different approach just because you would have done it differently.
- **Upgrading dependencies** — stability matters more than latest versions at this stage.
- **Adding tests that aren't in scope** — tests for the specific change are fair game. Tests for unrelated code are out of scope for the PR.

---

## Review format

```
## Summary
[One sentence: approve / request changes / blocker, and why]

## Integrity rule impact
[Rules 1-4 and which ones this PR affects, if any. "No impact" is a valid answer.
 For PRs that touch ledger entries, list which category sets are touched:
 DEBIT_TYPES, POOL_MINT_TYPES, RESERVE_GRANT_TYPES, STAKE_RESOLUTION_TYPES.]

## Critical issues (blockers)
[Items from priorities 1-4 that must be fixed before merge.
 Include file + line number + suggested fix.]

## Advisory items
[Items from priorities 5-6 that should be addressed but aren't blockers.
 Can be follow-up PRs.]

## What's good
[What Claude Code got right. Brief — 1-2 bullets. Useful for reinforcing patterns.]
```

**Do not include a "style" section unless there are genuine style violations.** Skip it entirely. Short reviews are fine — padding them with advisory items just to fill space is worse than a clean approval.

---

## How to push back on Claude Code

1. **Check `CLAUDE.md` first** — you might be missing a decision that's already been made.
2. **Check `src/lib/integrity.ts`** for the category sets if the disagreement is about ledger entries.
3. **If you still think it's wrong, flag it as a critical issue with a specific citation** — "this contradicts CLAUDE.md section X" or "this adds an entryType without updating integrity.ts." Don't just say "I think this is wrong."
4. **If Claude Code explains why the spec should change, don't unilaterally accept or reject** — escalate to Mohit via the PR description.

---

## When to escalate to Mohit

- There's a genuine disagreement between you and Claude Code on what the spec requires, and the spec is genuinely ambiguous.
- The PR would change something marked "already decided" in `CLAUDE.md` and Claude Code argues the decision should be reconsidered.
- The PR touches economic parameters (μ, pool split, tier thresholds, agent fee schedule) in a way that's not already approved in the spec.
- The PR adds a new `EntryType` enum value that doesn't fit cleanly into any existing category — this needs a spec decision.
- The PR touches the signing key, operator secrets, or production deployment configuration.
- You find a pre-existing bug in the codebase that's not related to the PR but is critical.

---

## Quick reference: the 60-second review

1. Read the PR description. Does it explain what changed and why?
2. Check which files are touched. Is it scoped appropriately (not sprawling)?
3. For each file that touches joules/ledger/balance:
   - Find every `$transaction` call
   - Verify each has paired balance + ledger writes
   - Verify `balanceAfter` is set correctly, as a Decimal (not `Number(...)`)
   - Verify `referenceType` and `referenceId` are set on new entries
   - Verify `entryType` is a specific value from the right category set
4. For each file that touches schema:
   - Check for `DROP COLUMN` on currency fields
   - Check for new `Float` currency fields
   - Check for new `EntryType` enum values (must be added to a category set)
   - Verify migration is reversible
5. Run the tests mentally: what's the failure mode if this ships?
6. Write the review using the format above.

If the PR passes all five steps, approve. If any fail, request changes with specific line numbers and suggested fixes.

---

*Last updated with category-based integrity rules. Source of truth for category membership is `src/lib/integrity.ts`.*
