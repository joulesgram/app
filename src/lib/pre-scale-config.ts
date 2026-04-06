// Pre-Scale Mode configuration loader.
//
// NODE RUNTIME ONLY. This module calls fs.readFileSync at import time
// and must never be imported from an edge runtime route or middleware.
// If you need these values in an edge context, fetch them through a
// Node API route instead.
//
// Loads config/pre-scale.yaml at module init, validates every field
// with hand-rolled assertions, and exposes both the typed config and
// a flat PRE_SCALE constants object for ergonomic use at call sites.
// Validation failures throw — a YAML typo producing an undefined
// field MUST crash startup rather than silently drain the bootstrap
// pool.
//
// All monetary values are in joules (J). 1 kJ = 1000 J. Convert to kJ
// only at the UI layer.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { PHOTO_SCORE_KJ } from "./constants";

// ---------------------------------------------------------------------------
// Types — the shape we expect after parsing and validation.
// ---------------------------------------------------------------------------

export interface PreScaleConfig {
  enabled: boolean;
  graduation_threshold_active_users: number;
  graduation_window_days: number;
  bootstrap_pool_j: number;
  bootstrap_receipt_id: string;
  bootstrap_pool_id: string;
  passive_regen: {
    rate_j_per_hour: number;
    cap_j: number;
    only_when_balance_below_cap: boolean;
  };
  daily_login_bonus_j: number;
  rate_to_earn: {
    reward_j_per_rating: number;
    daily_cap_ratings_per_user: number;
  };
  rate_to_post_unlock: {
    enabled: boolean;
    ratings_required: number;
    counter_resets_on_post: boolean;
  };
  spark_tier_ui: {
    hide_kj_balance: boolean;
    show_battery_icon: boolean;
    show_posts_remaining_text: boolean;
  };
}

// ---------------------------------------------------------------------------
// Validation helpers. Each one throws a descriptive Error on failure so the
// stack trace points at exactly which field is wrong.
// ---------------------------------------------------------------------------

class PreScaleConfigError extends Error {
  constructor(message: string) {
    super(`[pre-scale-config] ${message}`);
    this.name = "PreScaleConfigError";
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireObject(v: unknown, path: string): Record<string, unknown> {
  if (!isPlainObject(v)) {
    throw new PreScaleConfigError(
      `${path} must be an object, got ${v === null ? "null" : typeof v}`
    );
  }
  return v;
}

function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string
): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") {
    throw new PreScaleConfigError(
      `${path}.${key} must be a boolean, got ${
        v === undefined ? "undefined" : typeof v
      }`
    );
  }
  return v;
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new PreScaleConfigError(
      `${path}.${key} must be a non-empty string, got ${
        v === undefined ? "undefined" : typeof v
      }`
    );
  }
  return v;
}

function requirePositiveInt(
  obj: Record<string, unknown>,
  key: string,
  path: string
): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new PreScaleConfigError(
      `${path}.${key} must be a positive integer, got ${
        v === undefined ? "undefined" : JSON.stringify(v)
      }`
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// Validator: turns unknown YAML output into a fully typed PreScaleConfig.
// ---------------------------------------------------------------------------

function validate(raw: unknown): PreScaleConfig {
  const root = requireObject(raw, "root");
  const block = requireObject(root.pre_scale_mode, "pre_scale_mode");

  const passive = requireObject(
    block.passive_regen,
    "pre_scale_mode.passive_regen"
  );
  const rateEarn = requireObject(
    block.rate_to_earn,
    "pre_scale_mode.rate_to_earn"
  );
  const rateUnlock = requireObject(
    block.rate_to_post_unlock,
    "pre_scale_mode.rate_to_post_unlock"
  );
  const sparkUi = requireObject(
    block.spark_tier_ui,
    "pre_scale_mode.spark_tier_ui"
  );

  const config: PreScaleConfig = {
    enabled: requireBoolean(block, "enabled", "pre_scale_mode"),
    graduation_threshold_active_users: requirePositiveInt(
      block,
      "graduation_threshold_active_users",
      "pre_scale_mode"
    ),
    graduation_window_days: requirePositiveInt(
      block,
      "graduation_window_days",
      "pre_scale_mode"
    ),
    bootstrap_pool_j: requirePositiveInt(
      block,
      "bootstrap_pool_j",
      "pre_scale_mode"
    ),
    bootstrap_receipt_id: requireString(
      block,
      "bootstrap_receipt_id",
      "pre_scale_mode"
    ),
    bootstrap_pool_id: requireString(
      block,
      "bootstrap_pool_id",
      "pre_scale_mode"
    ),
    passive_regen: {
      rate_j_per_hour: requirePositiveInt(
        passive,
        "rate_j_per_hour",
        "pre_scale_mode.passive_regen"
      ),
      cap_j: requirePositiveInt(
        passive,
        "cap_j",
        "pre_scale_mode.passive_regen"
      ),
      only_when_balance_below_cap: requireBoolean(
        passive,
        "only_when_balance_below_cap",
        "pre_scale_mode.passive_regen"
      ),
    },
    daily_login_bonus_j: requirePositiveInt(
      block,
      "daily_login_bonus_j",
      "pre_scale_mode"
    ),
    rate_to_earn: {
      reward_j_per_rating: requirePositiveInt(
        rateEarn,
        "reward_j_per_rating",
        "pre_scale_mode.rate_to_earn"
      ),
      daily_cap_ratings_per_user: requirePositiveInt(
        rateEarn,
        "daily_cap_ratings_per_user",
        "pre_scale_mode.rate_to_earn"
      ),
    },
    rate_to_post_unlock: {
      enabled: requireBoolean(
        rateUnlock,
        "enabled",
        "pre_scale_mode.rate_to_post_unlock"
      ),
      ratings_required: requirePositiveInt(
        rateUnlock,
        "ratings_required",
        "pre_scale_mode.rate_to_post_unlock"
      ),
      counter_resets_on_post: requireBoolean(
        rateUnlock,
        "counter_resets_on_post",
        "pre_scale_mode.rate_to_post_unlock"
      ),
    },
    spark_tier_ui: {
      hide_kj_balance: requireBoolean(
        sparkUi,
        "hide_kj_balance",
        "pre_scale_mode.spark_tier_ui"
      ),
      show_battery_icon: requireBoolean(
        sparkUi,
        "show_battery_icon",
        "pre_scale_mode.spark_tier_ui"
      ),
      show_posts_remaining_text: requireBoolean(
        sparkUi,
        "show_posts_remaining_text",
        "pre_scale_mode.spark_tier_ui"
      ),
    },
  };

  // Cross-field sanity checks.
  if (config.passive_regen.cap_j < config.passive_regen.rate_j_per_hour) {
    throw new PreScaleConfigError(
      `passive_regen.cap_j (${config.passive_regen.cap_j}) must be >= rate_j_per_hour (${config.passive_regen.rate_j_per_hour})`
    );
  }

  return config;
}

// ---------------------------------------------------------------------------
// Load at module init. Throws if the file is missing, malformed, or invalid.
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(process.cwd(), "config", "pre-scale.yaml");

function load(): PreScaleConfig {
  let source: string;
  try {
    source = readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    throw new PreScaleConfigError(
      `failed to read ${CONFIG_PATH}: ${(err as Error).message}`
    );
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (err) {
    throw new PreScaleConfigError(
      `failed to parse ${CONFIG_PATH}: ${(err as Error).message}`
    );
  }

  return validate(parsed);
}

export const PRE_SCALE_CONFIG: PreScaleConfig = load();

// ---------------------------------------------------------------------------
// Derived flat constants. Call sites should prefer these over reaching into
// PRE_SCALE_CONFIG directly; the flat shape matches the previous hand-written
// export so existing imports keep working.
//
// POST_COST_J is the one value NOT sourced from the YAML — it belongs to the
// full economy (photo scoring cost), not Pre-Scale Mode, and the canonical
// source is PHOTO_SCORE_KJ in src/lib/constants.ts. Re-derived here so call
// sites have a single flat constant bag to import from.
// ---------------------------------------------------------------------------

export const PRE_SCALE = {
  /** Passive regen: joules granted per hour when balance is below cap */
  REGEN_RATE_J_PER_HOUR: PRE_SCALE_CONFIG.passive_regen.rate_j_per_hour,

  /** Passive regen cap: regen stops when balance reaches this */
  REGEN_CAP_J: PRE_SCALE_CONFIG.passive_regen.cap_j,

  /** Daily login bonus in joules */
  DAILY_LOGIN_BONUS_J: PRE_SCALE_CONFIG.daily_login_bonus_j,

  /** Flat rate-to-earn reward per rating in joules */
  RATE_EARN_REWARD_J: PRE_SCALE_CONFIG.rate_to_earn.reward_j_per_rating,

  /** Max ratings rewarded per user per UTC day */
  RATE_EARN_DAILY_CAP: PRE_SCALE_CONFIG.rate_to_earn.daily_cap_ratings_per_user,

  /** Number of ratings required to unlock a free post */
  RATE_TO_POST_RATINGS_REQUIRED:
    PRE_SCALE_CONFIG.rate_to_post_unlock.ratings_required,

  /** Photo scoring cost in joules. Derived from PHOTO_SCORE_KJ (constants.ts)
   *  so the full economy and Pre-Scale Mode stay in lockstep. */
  POST_COST_J: PHOTO_SCORE_KJ * 1000,

  /** Active user count required for graduation */
  GRADUATION_THRESHOLD_ACTIVE_USERS:
    PRE_SCALE_CONFIG.graduation_threshold_active_users,

  /** Consecutive days the threshold must be met */
  GRADUATION_WINDOW_DAYS: PRE_SCALE_CONFIG.graduation_window_days,

  /** Bootstrap pool total in joules */
  BOOTSTRAP_POOL_J: PRE_SCALE_CONFIG.bootstrap_pool_j,

  /** Bootstrap pool primary key (BootstrapPool.poolId) */
  BOOTSTRAP_POOL_ID: PRE_SCALE_CONFIG.bootstrap_pool_id,

  /** Bootstrap synthetic ComputeReceipt primary key */
  BOOTSTRAP_RECEIPT_ID: PRE_SCALE_CONFIG.bootstrap_receipt_id,
} as const;
