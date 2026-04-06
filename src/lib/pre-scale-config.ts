// Pre-Scale Mode configuration constants.
// All monetary values are in joules (J). 1 kJ = 1000 J.
// Convert to kJ only at the UI layer.

export const PRE_SCALE = {
  /** Passive regen: joules granted per hour when balance is below cap */
  REGEN_RATE_J_PER_HOUR: 10_000, // 10 kJ

  /** Passive regen cap: regen stops when balance reaches this */
  REGEN_CAP_J: 150_000, // 150 kJ

  /** Daily login bonus in joules */
  DAILY_LOGIN_BONUS_J: 50_000, // 50 kJ

  /** Flat rate-to-earn reward per rating in joules */
  RATE_EARN_REWARD_J: 5_000, // 5 kJ

  /** Max ratings rewarded per user per UTC day */
  RATE_EARN_DAILY_CAP: 20,

  /** Number of ratings required to unlock a free post */
  RATE_TO_POST_RATINGS_REQUIRED: 5,

  /** Photo scoring cost in joules (matches PHOTO_SCORE_KJ * 1000) */
  POST_COST_J: 75_000, // 75 kJ

  /** Active user count required for graduation */
  GRADUATION_THRESHOLD_ACTIVE_USERS: 100,

  /** Consecutive days the threshold must be met */
  GRADUATION_WINDOW_DAYS: 7,

  /** Bootstrap pool total in kJ (stored as kJ in the BootstrapPool table) */
  BOOTSTRAP_POOL_KJ: 10_000_000, // 10 MJ

  /** Bootstrap pool ID */
  BOOTSTRAP_POOL_ID: "pre_scale_v1",
} as const;
