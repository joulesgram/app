// Startup environment checks.
//
// Called at module init from routes that cannot function without
// specific env vars. Throws loudly so Vercel cold-start fails with a
// clear error in the build/runtime log rather than returning 500s or
// 401s at request time with no obvious cause.
//
// Usage:
//   // at top of src/app/api/cron/<name>/route.ts
//   import { assertCronEnv } from "@/lib/env-check";
//   assertCronEnv();
//
// Node runtime only. Do not import from edge runtimes.

class EnvCheckError extends Error {
  constructor(message: string) {
    super(`[env-check] ${message}`);
    this.name = "EnvCheckError";
  }
}

function isNonEmpty(v: string | undefined): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Asserts that cron routes have the auth secret they need.
 *
 * Fails startup if CRON_SECRET is missing, empty, or whitespace-only.
 * Call at module init of every /api/cron/* route so a misconfigured
 * deploy fails loudly at cold-start instead of silently 401-ing every
 * scheduled invocation.
 *
 * Pure function, no side effects beyond throwing. Safe to call
 * multiple times.
 */
export function assertCronEnv(): void {
  if (!isNonEmpty(process.env.CRON_SECRET)) {
    throw new EnvCheckError(
      "CRON_SECRET is required for cron routes but is missing or empty. " +
        "Set it in the Vercel project env (Production + Preview) to a " +
        "high-entropy random string (e.g. `openssl rand -hex 32`) before " +
        "deploying, or the Vercel cron will return 401 on every invocation."
    );
  }
}
