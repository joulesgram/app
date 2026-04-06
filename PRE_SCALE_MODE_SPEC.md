# Joulegram Pre-Scale Mode — Build Spec

**Status:** Ready to build
**Target:** Claude Code
**Author:** Mohit + Claude
**Date:** April 2026
**Companion to:** Joulegram Consolidated Spec v1, Joulenomics v1

---

## 0. Why this exists

The current economy was designed for a network of 1,000+ users with statistical mass. We have 14 users. Every mechanic that depends on consensus, IQR bands, rolling accuracy windows, top-percentile pools, or daily mint volume fails at this scale — not because the math is wrong, but because there isn't enough activity to feed it.

Real symptom: User #4 burned 500 kJ in five minutes, has no path to earn it back, and described himself as "the poorest man on joulgram." He wants to keep using the app and can't.

**Pre-Scale Mode** is a temporary set of mechanics that bridges 14 → 100 users, at which point the full Joulenomics v1 economy auto-activates. Nothing in the existing spec is removed or rewritten. Pre-Scale Mode runs *alongside* the full economy, gated behind a single config flag, and uses its own bootstrap pool so the four integrity rules remain intact.

When the network crosses 100 active users, the flag flips automatically and Pre-Scale Mode shuts itself off. Any unspent bootstrap pool is burned. The full economy takes over with no user-visible discontinuity.

---

## 1. Goals

1. Give every user a way to keep playing the app even when their balance hits zero.
2. Make rating other people's photos the primary earn path, so engagement compounds instead of starving.
3. Hide all kJ math from Spark-tier users, as the existing spec already mandates but does not yet enforce.
4. Convert the "out of joules" wall into a gameplay ritual instead of a paywall.
5. Preserve all four integrity rules from §12 of Joulenomics v1 without exception.
6. Auto-graduate to the full economy when the network is ready, with no migration or hard fork.

---

## 2. The single config flag

Add to `protocol/config/v1.yaml`:

```yaml
pre_scale_mode:
  enabled: true
  graduation_threshold_active_users: 100
  graduation_window_days: 7   # must sustain threshold for N consecutive days

  bootstrap_pool_kj: 10_000_000   # 10 MJ — funds all Pre-Scale rewards
  bootstrap_receipt_id: "genesis_bootstrap_001"

  passive_regen:
    rate_kj_per_hour: 10
    cap_kj: 150
    only_when_balance_below_cap: true

  daily_login_bonus_kj: 50

  rate_to_earn:
    reward_kj_per_rating: 5
    daily_cap_ratings_per_user: 20

  rate_to_post_unlock:
    enabled: true
    ratings_required: 5
    counter_resets_on_post: true

  spark_tier_ui:
    hide_kj_balance: true
    show_battery_icon: true
    show_posts_remaining_text: true
```

Every Pre-Scale mechanic reads from this block. To disable any individual mechanic, set its sub-block to null or its rate to 0. The whole system is one boolean away from off.

---

## 3. The bootstrap pool (the trick that keeps integrity rules intact)

The four integrity rules state that every mint event must tie to a compute receipt and every burn must tie to a user action. Pre-Scale mechanics need to give users joules without consuming compute. The cleanest solution is a single one-time mint event tied to a synthetic bootstrap receipt.

### Migration step (run once when Pre-Scale Mode is first enabled):

1. Insert a row into `compute_receipts`:
   ```
   id: genesis_bootstrap_001
   job_id: genesis_bootstrap_001
   model_id: bootstrap
   job_type: bootstrap
   token_in: 0
   token_out: 0
   j_fixed: 10_000_000_000   # 10 MJ in joules
   input_hash: sha256("joulegram_pre_scale_mode_v1")
   output_hash: sha256("joulegram_pre_scale_mode_v1")
   timestamp: <now>
   kj_value: 10_000_000
   receipt_hash: sha256(serialized_row)
   status: bootstrap
   ```

2. Insert a corresponding `ledger_entries` row:
   ```
   user_id: NULL
   entry_type: mint
   amount: 10_000_000_000
   asset: J
   reference_type: compute_receipt
   reference_id: genesis_bootstrap_001
   ```

3. Create a `bootstrap_pool` row that tracks remaining balance:
   ```
   pool_id: pre_scale_v1
   total_minted_kj: 10_000_000
   remaining_kj: 10_000_000
   created_at: <now>
   closed_at: NULL
   ```

Every Pre-Scale reward (regen, login, rate-to-earn) is a transfer *from* this pool *to* a user via a new ledger entry type. The pool is ledgered, traceable, and bounded. Integrity rule #1 holds because the mint ties to a real (synthetic) receipt. Integrity rule #2 holds because every transfer ties to a user action. Integrity rules #3 and #4 hold because every entry is in the ledger.

### When Pre-Scale Mode graduates:

1. Compute `remaining_kj` in `bootstrap_pool`.
2. Insert a final `ledger_entries` row of type `burn` for that amount, referencing the bootstrap pool.
3. Set `closed_at` on the pool row.
4. Flip `pre_scale_mode.enabled = false` in config.
5. Settlement cron resumes normal operation the next day.

The bootstrap pool is now permanently closed. Total supply is conserved. The settlement log shows the entire lifecycle as a coherent sequence of mints, transfers, and a final burn.

---

## 4. Mechanic: Passive regen

Background job runs hourly. For each user:

```pseudocode
if user.balance_kj < passive_regen.cap_kj:
    needed = passive_regen.cap_kj - user.balance_kj
    grant = min(passive_regen.rate_kj_per_hour, needed)
    if bootstrap_pool.remaining_kj >= grant:
        ledger_insert(
            user_id=user.id,
            entry_type='regen_drip',
            amount=grant * 1000,  # joules
            reference_type='bootstrap_pool',
            reference_id='pre_scale_v1'
        )
        bootstrap_pool.remaining_kj -= grant
```

Add `regen_drip` to the allowed `entry_type` enum.

**Important:** regen only fires up to the cap. A user sitting at 200 kJ does not regen. This prevents unbounded accumulation and keeps the bootstrap pool from being drained by inactive users.

**Cost ceiling check:** 14 users × 24 hours × 10 kJ = 3.36 MJ/day max if every user is permanently empty. At graduation (100 users) that's 24 MJ/day max. Bootstrap pool of 10 MJ funds roughly 3 days of worst-case regen alone, which is fine because real usage will be a fraction of that and graduation refills the system. If the network grows faster than expected, increase `bootstrap_pool_kj` via a config update — no code change required.

---

## 5. Mechanic: Daily login bonus

On first authenticated app open per user per UTC day:

```pseudocode
last_bonus = redis.get(f"login_bonus:{user.id}:{today_utc}")
if last_bonus is None:
    ledger_insert(
        user_id=user.id,
        entry_type='daily_login_bonus',
        amount=50_000,  # joules
        reference_type='bootstrap_pool',
        reference_id='pre_scale_v1'
    )
    bootstrap_pool.remaining_kj -= 50
    redis.set(f"login_bonus:{user.id}:{today_utc}", 1, ex=86400)
```

Add `daily_login_bonus` to the allowed `entry_type` enum.

Display in UI as a brief animation: "⚡ Daily charge: +50 kJ" — but for Spark tier users, show it as "🔋 Daily charge collected" with no number.

**Cost ceiling:** 100 users × 50 kJ × 30 days = 150 MJ over a month. Already exceeds the bootstrap pool. This is intentional — the bootstrap pool is sized to last roughly through the graduation window, not indefinitely. If the network is healthy, graduation happens before the pool runs dry. If the network stalls, the pool running dry is the signal that Pre-Scale Mode wasn't enough and the product has a deeper problem.

---

## 6. Mechanic: Flat rate-to-earn

Replaces the IQR-based curator reward for the duration of Pre-Scale Mode. The full curator formula stays in the codebase but is bypassed when `pre_scale_mode.enabled` is true.

When a user submits a rating:

```pseudocode
ratings_today = count_ratings(user.id, since=today_utc_start)
if ratings_today < rate_to_earn.daily_cap_ratings_per_user:
    # Existing 5 kJ stake mechanic still applies — DO NOT remove it.
    # Stake is locked as before.
    lock_stake(user.id, 5)

    # NEW: Pre-Scale flat reward, paid immediately, no consensus needed.
    ledger_insert(
        user_id=user.id,
        entry_type='rate_earn_flat',
        amount=5_000,  # joules — flat 5 kJ
        reference_type='bootstrap_pool',
        reference_id='pre_scale_v1'
    )
    bootstrap_pool.remaining_kj -= 5
```

Add `rate_earn_flat` to the allowed `entry_type` enum.

**Critical:** the existing 5 kJ stake-and-resolve mechanic still runs underneath. When the 24h window resolves and there's enough data to compute an IQR (probably not for weeks), users get their normal stake-return + bonus or slash on top of the flat reward. This means Pre-Scale rewards stack with full-economy rewards rather than replacing them, so when Pre-Scale Mode ends there's no rug-pull.

The daily cap exists to bound bootstrap drain and prevent rate-spam farming. 14 users × 20 ratings × 5 kJ = 1.4 MJ/day max. Trivial.

---

## 7. Mechanic: Rate-to-post unlock

This is the gameplay ritual that converts the joule wall from a paywall into a quest.

Add a new column to `users`:

```sql
ALTER TABLE users ADD COLUMN ratings_since_last_post INTEGER NOT NULL DEFAULT 0;
```

When a user submits a rating:
```pseudocode
user.ratings_since_last_post += 1
```

When a user attempts to post a photo:
```pseudocode
if user.balance_kj >= 75:
    # Normal flow — they have enough joules.
    proceed_with_post()
    if rate_to_post_unlock.counter_resets_on_post:
        user.ratings_since_last_post = 0
elif user.ratings_since_last_post >= rate_to_post_unlock.ratings_required:
    # They're broke but they earned the right to post via curation.
    grant_one_free_post(user.id)
    user.ratings_since_last_post = 0
    proceed_with_post()
else:
    # They're broke and haven't rated enough.
    show_unlock_quest_ui(
        ratings_done=user.ratings_since_last_post,
        ratings_needed=rate_to_post_unlock.ratings_required
    )
```

`grant_one_free_post` creates a special burn-debit-from-pool entry that pays the 75 kJ scoring cost from the bootstrap pool instead of the user's balance. Add `pre_scale_post_grant` to the entry type enum.

**UI for the unlock quest:** when Harrisson opens the upload screen with 0 kJ and 2 ratings done, show:

> ⚡ You're out of charge.
>
> Rate 3 more photos to earn your next post.
>
> [Go rate photos →]
>
> ▓▓░░░ 2 / 5

This is the ritual. He goes back to the feed, rates 3 photos (earning flat rewards on each), comes back, and posts. Total effort: maybe 90 seconds. The friction *is* the engagement.

---

## 8. Mechanic: Spark-tier UI mode

This is the fix for "so complicated I need a sit down explanation." It's already in §2 of the Consolidated Spec but not implemented.

For any user whose tier is `Spark` AND `pre_scale_mode.enabled` is true:

- Replace the kJ balance widget with a battery icon (🔋) showing percentage of `passive_regen.cap_kj`.
- Replace "You have 487 kJ" with "You have 6 free posts left this week" — derived from `floor(balance_kj / 75)`.
- Hide all Joulenomics-specific terminology in tooltips, modals, and notifications. Use plain language: "energy", "charge", "battery", "out of power."
- The verdict reveal screen should show no kJ numbers anywhere. The cost is implied by the battery dropping after the post.
- The leaderboard and Humans-vs-AI screens stay unchanged — those are about accuracy %, not joules, and they're the viral hook.

When a user graduates from Spark to Glow (1,000 cumulative joules earned), show a one-time onboarding modal: "You've leveled up. Want to see how the energy economy actually works?" If they say yes, reveal kJ balances and link to the (separate, devs-only) `JOULENOMICS_SPEC.md`. If they say no, keep the simplified UI forever — they can toggle it later in settings.

---

## 9. Auto-graduation

Add a scheduled job that runs daily as part of the settlement cron, after step 8 (publish settlement artifact):

```pseudocode
if pre_scale_mode.enabled:
    active_users_today = count_users_with_ratings_or_posts(today)
    record_active_user_count(today, active_users_today)

    last_n_days = get_active_user_counts_for_last_n_days(
        pre_scale_mode.graduation_window_days
    )

    if all(count >= pre_scale_mode.graduation_threshold_active_users
           for count in last_n_days):
        graduate_pre_scale_mode()
```

`graduate_pre_scale_mode()`:
1. Computes remaining bootstrap pool balance.
2. Inserts a `burn` ledger entry for that amount.
3. Marks bootstrap pool `closed_at = now`.
4. Flips `pre_scale_mode.enabled = false` in config (or DB-backed feature flag).
5. Sends an admin notification: "Pre-Scale Mode graduated. Bootstrap pool closed. X kJ burned."
6. Posts a public settlement-log entry documenting the graduation event.

After graduation, all Pre-Scale mechanics short-circuit on `pre_scale_mode.enabled = false`. The full Joulenomics v1 economy is now the only thing running.

**Manual override:** the operator (Mohit) can flip the flag manually at any time. Useful if you want to extend Pre-Scale Mode past 100 users for safety, or end it early if the bootstrap pool is draining faster than the network is growing.

---

## 10. Database changes summary

```sql
-- New entry types in the ledger_entries.entry_type enum:
ALTER TYPE ledger_entry_type ADD VALUE 'regen_drip';
ALTER TYPE ledger_entry_type ADD VALUE 'daily_login_bonus';
ALTER TYPE ledger_entry_type ADD VALUE 'rate_earn_flat';
ALTER TYPE ledger_entry_type ADD VALUE 'pre_scale_post_grant';

-- New column on users for the rate-to-post quest:
ALTER TABLE users
  ADD COLUMN ratings_since_last_post INTEGER NOT NULL DEFAULT 0;

-- New table to track the bootstrap pool:
CREATE TABLE bootstrap_pool (
  pool_id TEXT PRIMARY KEY,
  total_minted_kj BIGINT NOT NULL,
  remaining_kj BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);

-- New table to track active user counts for graduation logic:
CREATE TABLE active_user_counts_daily (
  date DATE PRIMARY KEY,
  active_users INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL
);
```

No existing tables are modified beyond the one column on `users`. The full economy schema stays untouched.

---

## 11. Acceptance criteria

Pre-Scale Mode is correctly built when all of the following hold:

1. **The four original integrity rules from §12 of Joulenomics v1 still pass.** Run the existing settlement-job assertions. They must all return green every day, including the day Pre-Scale Mode is enabled and the day it graduates.

2. **The bootstrap pool is conserved.** `total_minted_kj = sum(all transfers out) + remaining_kj` at all times. Add this as a fifth integrity assertion that runs daily for as long as `pre_scale_mode.enabled` is true.

3. **A Spark-tier user with zero joules can post a photo within 5 minutes** by rating 5 other photos. End-to-end test: create test user, drain balance, attempt post, follow unlock quest, verify post succeeds.

4. **A Spark-tier user never sees the string "kJ" anywhere in the UI.** Snapshot test on the upload screen, feed, profile, and leaderboard.

5. **A user who returns after 24 hours away has at least 50 kJ + (hours_away × 10 kJ, capped at 150 kJ) more energy than when they left**, assuming the bootstrap pool has funds.

6. **Graduation works.** Manually flip the active-user count above threshold for the graduation window, run the settlement cron, and verify the bootstrap pool closes, the residual is burned, and `pre_scale_mode.enabled` flips to false.

7. **Toggling `pre_scale_mode.enabled = false` mid-flight does not break the existing economy.** All in-flight regen, bonuses, and rate-earn rewards stop. In-flight 5-kJ stakes continue to resolve normally because they were never Pre-Scale specific.

---

## 12. What NOT to change

Resist scope creep. Pre-Scale Mode is **not**:

- A redesign of the curator formula. The IQR + accuracy mechanics stay exactly as specified, and continue to run underneath. Rate-to-earn is *additive*, not a replacement.
- A change to mint mechanics (μ, KJ_net, daily mint pools). Daily mint continues to be derived from real compute. Pre-Scale rewards come from the bootstrap pool, not from daily mint.
- A change to creator rewards. The √(KJ_p) · Score_p formula still computes pool allocations from daily mint. At 14 users this is tiny but still correct.
- A change to the four integrity rules. They are non-negotiable. The bootstrap pool exists precisely so we can ship Pre-Scale Mode without weakening them.
- A change to the protocol-layer code in `protocol/`. All Pre-Scale logic lives in the `app/` and `measurer/` repos. The protocol stays clean and ports forward to Phase 1 without modification.
- A change to the Thesis or the Consolidated Spec. Those documents describe the destination. Pre-Scale Mode is the on-ramp.

---

## 13. Build order

If building this in chunks (recommended), ship in this order so each step delivers user-visible value:

**Day 1 — Bootstrap pool + login bonus + passive regen.** This alone fixes Harrisson. He opens the app tomorrow, sees +50 kJ, and gradually fills back up while he's away. Two new entry types, one cron job, one new table. Maybe 200 lines of code.

**Day 2 — Spark-tier UI mode.** Hide kJ numbers from the upload screen, feed, and profile. Replace with battery icon and "N free posts" text. Pure frontend. The single biggest perception win in the entire spec.

**Day 3 — Flat rate-to-earn.** Pay 5 kJ flat per rating, capped at 20/day. One new entry type, modified rating handler. Now Harrisson has an active earn loop.

**Day 4 — Rate-to-post unlock.** Add the column, the quest UI, the grant flow. This is the gameplay ritual that makes the loop close.

**Day 5 — Auto-graduation logic.** Less urgent because graduation is 86 users away, but ship it now while the design is fresh. Adds the active-user-count table and the cron check.

Five days, all behind one feature flag, all reversible, none of it touching the protocol layer. Ship it.

---

*— End of Pre-Scale Mode Spec —*
