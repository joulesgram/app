import { SIGNUP_TIERS } from "./constants";

/** Format kilojoules for display (e.g. 25000 → "25,000 kJ") */
export function fmtJ(kj: number): string {
  return `${kj.toLocaleString("en-US")} kJ`;
}

/** Get the signup reward for the nth user (1-indexed) */
export function getSignupReward(n: number): number {
  const tier = SIGNUP_TIERS.find((t) => n <= t.max);
  return tier?.reward ?? SIGNUP_TIERS[SIGNUP_TIERS.length - 1].reward;
}

/** Get the tier label for the nth user (1-indexed) */
export function getTierLabel(n: number): string {
  const tier = SIGNUP_TIERS.find((t) => n <= t.max);
  return tier?.label ?? SIGNUP_TIERS[SIGNUP_TIERS.length - 1].label;
}

/** Reward multiplier for referral chain depth.
 *  Level 1 (direct invite) = 1.0, Level 2 = 0.5, Level 3 = 0.25, etc. */
export function chainReward(level: number): number {
  if (level < 1) return 0;
  return 1 / Math.pow(2, level - 1);
}
