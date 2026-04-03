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

/** Reward multiplier for referral chain depth */
export function chainReward(level: number): number {
  return Math.max(0, 1 / Math.pow(2, level));
}
