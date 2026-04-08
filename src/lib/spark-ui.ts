export const SPARK_UI_THRESHOLD_J = 200_000;
export const BATTERY_CAP_J = 150_000;
export const POST_COST_J = 75_000;

export function isSparkUIMode(user: { joulesBalance: number | string }): boolean {
  const b = typeof user.joulesBalance === "string" ? parseFloat(user.joulesBalance) : user.joulesBalance;
  return b < SPARK_UI_THRESHOLD_J;
}

export function batteryPercent(j: number | string): number {
  const b = typeof j === "string" ? parseFloat(j) : j;
  return Math.max(0, Math.min(1, b / BATTERY_CAP_J));
}

export function postsRemaining(j: number | string): number {
  const b = typeof j === "string" ? parseFloat(j) : j;
  return Math.max(0, Math.floor(b / POST_COST_J));
}

export function batteryLabel(postsLeft: number): string {
  if (postsLeft === 0) return "Out of charge";
  if (postsLeft === 1) return "1 free post left";
  return `${postsLeft} free posts left`;
}
