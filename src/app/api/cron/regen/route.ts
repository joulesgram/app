import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isPreScaleModeEnabled, runPassiveRegen } from "@/lib/pre-scale";
import { assertCronEnv } from "@/lib/env-check";

// Fail cold-start if CRON_SECRET is missing, rather than silently
// 401-ing every scheduled Vercel cron invocation.
assertCronEnv();

/**
 * Vercel Cron endpoint for hourly passive regen.
 * Schedule: every hour (configured in vercel.json)
 *
 * Auth: requires CRON_SECRET env var, sent as Authorization: Bearer header.
 * Idempotency: tracks last run via CronRunLog with hourly bucket key.
 */
export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Compute hour bucket key (e.g. "2026-04-06T14")
  const now = new Date();
  const bucketKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}T${String(now.getUTCHours()).padStart(2, "0")}`;

  // Idempotency check
  const existing = await prisma.cronRunLog.findUnique({
    where: { jobName_bucketKey: { jobName: "regen", bucketKey } },
  });

  if (existing) {
    return NextResponse.json({ status: "no-op", bucketKey, reason: "already processed" });
  }

  // Check if Pre-Scale Mode is active
  const enabled = await isPreScaleModeEnabled(prisma);
  if (!enabled) {
    return NextResponse.json({ status: "skipped", reason: "pre-scale mode not active" });
  }

  // Run regen
  const usersTopped = await runPassiveRegen(prisma);

  // Record completion
  await prisma.cronRunLog.create({
    data: { jobName: "regen", bucketKey },
  });

  return NextResponse.json({
    status: "completed",
    bucketKey,
    usersTopped,
  });
}
