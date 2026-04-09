import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  runAllIntegrityChecks,
  TREASURY_USER_ID,
  type IntegrityResult,
} from "@/lib/integrity";

// CORS allowlist — marketing site domains and localhost dev
const ALLOWED_ORIGINS = [
  "https://joulegram.com",
  "https://www.joulegram.com",
  "https://joulegram.vercel.app",
  "https://joulegram-website.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

// Cache for 60 seconds at the edge so we don't hammer the DB
// on every marketing site visitor
export const revalidate = 60;

interface StatsResponse {
  activeUsers: number;
  circulationJ: string; // stringified Decimal (can exceed Number range)
  bootstrapPoolJ: string; // stringified BigInt
  integrityPassing: number;
  integrityTotal: number;
  asOf: string; // ISO timestamp
}

function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["vary"] = "origin";
  }
  return headers;
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";

  try {
    const [activeUsers, balancesSum, pool, integrityResults] =
      await Promise.all([
        prisma.user.count({
          where: { id: { not: TREASURY_USER_ID } },
        }),
        prisma.user.aggregate({
          where: { id: { not: TREASURY_USER_ID } },
          _sum: { joulesBalance: true },
        }),
        prisma.bootstrapPool.findUnique({
          where: { poolId: "pre_scale_v1" },
          select: { remainingJ: true },
        }),
        runAllIntegrityChecks(prisma),
      ]);

    const body: StatsResponse = {
      activeUsers,
      circulationJ: (balancesSum._sum.joulesBalance ?? "0").toString(),
      bootstrapPoolJ: (pool?.remainingJ ?? BigInt(0)).toString(),
      integrityPassing: integrityResults.filter(
        (r: IntegrityResult) => r.passed,
      ).length,
      integrityTotal: integrityResults.length,
      asOf: new Date().toISOString(),
    };

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: corsHeaders(origin),
    });
  } catch (err) {
    console.error("[public/stats] failed:", err);
    return new Response(JSON.stringify({ error: "stats unavailable" }), {
      status: 500,
      headers: corsHeaders(origin),
    });
  }
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = {};
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers["access-control-max-age"] = "86400";
  }
  return new Response(null, { status: 204, headers });
}
