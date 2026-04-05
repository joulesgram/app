# Bug Review and Fix Plan

## Scope and method
- Performed a full pass over the application code under `src/` and data model in `prisma/schema.prisma`.
- Ran a production build and TypeScript check to surface compile-time/runtime integration issues.
- Focused this plan on bugs and reliability risks that can cause wrong balances, duplicate scoring, bad data, and production regressions.

## Critical bugs to fix first

1. **Non-atomic coin ledger updates can create balance drift**
   - `src/app/api/score/route.ts` performs multiple writes (`photo.update`, `user.update`, `coinTransaction.create`, reward credit) outside one transaction.
   - Partial failures can leave photo state updated without matching coin ledger entries, or vice versa.
   - **Fix plan**: wrap all score-side writes in a single `prisma.$transaction`, and make each credit/debit operation paired with its ledger row in the same transaction.

2. **Agent creation can charge coins without creating an agent (or the reverse)**
   - `src/app/agents/actions.ts` creates agent and then deducts coins in separate operations.
   - **Fix plan**: move agent creation + coin decrement + transaction log into a single DB transaction.

3. **Human rating can drive users into negative balances**
   - `src/app/photo/[id]/actions.ts` deducts `RATING_KJ` but never checks available coins first.
   - **Fix plan**: enforce pre-check and transactional guard (`updateMany` with `coins >= RATING_KJ`) before creating rating.

4. **Duplicate agent ratings are possible at schema level**
   - `AgentRating` in `prisma/schema.prisma` has no uniqueness constraint on `(photoId, agentId)`.
   - This allows duplicate rows in race conditions and skews `aiScore` recomputation.
   - **Fix plan**: add `@@unique([photoId, agentId])` and handle conflict retries in API routes.

## High-priority correctness issues

5. **`/api/score-agent` lacks explicit API key guard and robust response validation**
   - `src/app/api/score-agent/route.ts` does not verify `ANTHROPIC_API_KEY` before calling the SDK and assumes parsed JSON length/shape is valid.
   - **Fix plan**: add early env validation, strict parsed payload validation (array length/field checks), and skip invalid entries safely.

6. **Feed page has N+1 query pattern for human averages**
   - `src/app/feed/page.tsx` fetches photos and then issues one query per photo for human ratings.
   - Under load this is a latency bug and can cause timeouts.
   - **Fix plan**: replace with a single aggregate/group-by query keyed by `photoId`.

7. **Referral code cookie accepts unbounded/unvalidated input**
   - `src/middleware.ts` stores raw `?ref=` in cookie.
   - **Fix plan**: apply length/charset validation before storing cookie; reject malformed values.

## Data and API hardening

8. **Image ingestion is too permissive for persisted `imageUrl` payloads**
   - `src/app/api/upload/route.ts` accepts any string and persists it; later routes attempt to parse as data URL or remote URL.
   - **Fix plan**: validate allowed schemes (`data:image/*` with allowed MIME or `https://` URL), enforce size constraints and reject malformed values.

9. **Photo scoring path should be idempotency-safe**
   - Concurrent requests on same photo can race between `aiScore === null` check and writes.
   - **Fix plan**: transactional conditional update (or row lock) to guarantee score-only-once semantics.

## Suggested execution order

### Phase 1 (stability + money correctness)
- Add DB constraints/migrations for `AgentRating` uniqueness.
- Refactor score, create-agent, and human-rating flows to full transactional units.
- Add negative-balance protection in all debit paths.

### Phase 2 (input/model robustness)
- Harden upload URL/data parsing and API key checks.
- Add strict schema validation for AI JSON responses.
- Add retry/conflict handling around unique-constraint collisions.

### Phase 3 (performance + observability)
- Remove feed N+1 queries with aggregate fetch.
- Improve structured logs for scoring pipeline (`photoId`, `userId`, token usage, failures).
- Add alertable error categories (parse failure, provider failure, constraint conflict).

## Test plan to ship safely
- Unit tests for validation and rounding/score normalization logic.
- Integration tests for coin ledger invariants (sum of transactions equals balance delta).
- Concurrency tests for duplicate scoring/rating requests.
- Build + typecheck gates in CI.

## Protocol accounting amendments (rating flow)

### 2. Rating submission accounting
- On rating submission, the user stake of **`5 kJ`** is moved to **`escrow_locked`**.
- The stake is **not burned at submission time**. Burn/release decisions are deferred until resolution.
- Ledger emission for submission must include a **`stake_lock`** event.

### 4. Resolution accounting outcomes
- **Accurate**: release the locked escrow to the rater and mint a bonus from the curator pool.
  - Ledger events: **`stake_release`** + **`curator_bonus`**.
- **Neutral**: release the locked escrow only.
  - Ledger event: **`stake_release`**.
- **Inaccurate**: burn a configurable portion of escrow (example baseline: **50%**) and release the remainder.
  - Ledger events: **`stake_burn`** + **`stake_release`**.

### 5.2 Burn invariant
- Burn invariants must **exclude funds held in `escrow_locked`** until slashing outcome is resolved.
- Only finalized slashing outcomes contribute to burn totals (e.g., `stake_burn`), while unresolved escrow remains non-burned supply state.
