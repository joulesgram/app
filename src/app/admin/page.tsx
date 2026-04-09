import { notFound } from "next/navigation";
import Link from "next/link";
import { Decimal } from "decimal.js";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  TREASURY_USER_ID,
  DEBIT_TYPES,
  POOL_MINT_TYPES,
  RESERVE_GRANT_TYPES,
  STAKE_RESOLUTION_TYPES,
} from "@/lib/integrity";

const BOOTSTRAP_POOL_ID = "pre_scale_v1";

const DEBIT_SET = new Set<string>(DEBIT_TYPES);
const CREDIT_SET = new Set<string>([
  ...POOL_MINT_TYPES,
  ...RESERVE_GRANT_TYPES,
  ...STAKE_RESOLUTION_TYPES,
]);

function entryTypeColor(entryType: string): string {
  if (DEBIT_SET.has(entryType)) return "text-red-400";
  if (CREDIT_SET.has(entryType)) return "text-green-400";
  return "text-gray-400";
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toISOString().slice(0, 10);
}

function formatTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function decimalFrom(v: unknown): Decimal {
  if (v === null || v === undefined) return new Decimal(0);
  return new Decimal(String(v));
}

function formatJ(v: unknown): string {
  const d = decimalFrom(v);
  const sign = d.isNegative() ? "" : "+";
  return `${sign}${d.toFixed(0)} J`;
}

function formatKj(v: unknown): string {
  const d = decimalFrom(v);
  return `${d.div(1000).toFixed(1)} kJ`;
}

function actionResultColor(result: string): string {
  if (result === "success") return "text-green-400";
  if (result === "failed" || result === "integrity_failed")
    return "text-red-400";
  if (result === "pending") return "text-yellow-400";
  return "text-gray-400";
}

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user || session.user.userNumber !== 1) notFound();

  // ── Section 1: Health banner ──
  const [ledgerSumResult, treasury, bootstrapPool, totalUsers] =
    await Promise.all([
      prisma.ledgerEntry.aggregate({ _sum: { amount: true } }),
      prisma.user.findUnique({
        where: { id: TREASURY_USER_ID },
        select: { joulesBalance: true },
      }),
      prisma.bootstrapPool.findUnique({
        where: { poolId: BOOTSTRAP_POOL_ID },
        select: { remainingKj: true },
      }),
      prisma.user.count({ where: { id: { not: TREASURY_USER_ID } } }),
    ]);

  const globalLedgerSum = decimalFrom(ledgerSumResult._sum.amount);
  const ledgerSumOk = globalLedgerSum.eq(0);

  // ── Section 2: Top 30 users by recent activity ──
  const recentActivity = await prisma.ledgerEntry.groupBy({
    by: ["userId"],
    where: { userId: { not: TREASURY_USER_ID } },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: 30,
  });
  const topUserIds = recentActivity.map((r) => r.userId);
  const topUsersUnsorted = topUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: topUserIds } },
        select: {
          id: true,
          userNumber: true,
          username: true,
          joulesBalance: true,
          ratingsSinceLastPost: true,
          createdAt: true,
          referredBy: true,
        },
      })
    : [];
  const topUsersById = new Map(topUsersUnsorted.map((u) => [u.id, u]));
  const topUsers = topUserIds
    .map((id) => topUsersById.get(id))
    .filter((u): u is (typeof topUsersUnsorted)[number] => u !== undefined);

  const inviterCodes = Array.from(
    new Set(
      topUsers
        .map((u) => u.referredBy)
        .filter((c): c is string => typeof c === "string" && c.length > 0)
    )
  );
  const inviters = inviterCodes.length
    ? await prisma.user.findMany({
        where: { referralCode: { in: inviterCodes } },
        select: { referralCode: true, username: true },
      })
    : [];
  const inviterMap = new Map(inviters.map((i) => [i.referralCode, i.username]));

  // ── Section 3: Last 50 ledger entries ──
  const recentEntries = await prisma.ledgerEntry.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { username: true } },
    },
  });

  // ── Section 4: 24h entry type breakdown ──
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const breakdownRaw = await prisma.ledgerEntry.groupBy({
    by: ["entryType"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { amount: true },
    orderBy: { _count: { entryType: "desc" } },
  });

  // ── Section 5: Recent admin actions ──
  const recentActions = await prisma.adminAction.findMany({
    take: 20,
    orderBy: { createdAt: "desc" },
  });

  // Resolve operator and target usernames in one batch
  const actionUserIds = Array.from(
    new Set(
      recentActions.flatMap((a) =>
        [a.operatorId, a.targetUserId].filter(
          (id): id is string => id !== null
        )
      )
    )
  );
  const actionUsers = actionUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actionUserIds } },
        select: { id: true, username: true },
      })
    : [];
  const actionUserMap = new Map(actionUsers.map((u) => [u.id, u.username]));

  return (
    <main className="min-h-screen pb-20 bg-bg text-gray-200">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">Joulegram Admin</h1>
          <p className="text-xs text-gray-500">founder view</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* Section 1: Health banner */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Health
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-card border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Global ledger sum
              </p>
              <p
                className={`mt-2 font-mono text-2xl ${
                  ledgerSumOk ? "text-green-400" : "text-red-500"
                }`}
              >
                {globalLedgerSum.toFixed(4)} J
              </p>
              <p className="text-[11px] text-gray-600 mt-1">
                Rule #3 — should be 0
              </p>
            </div>

            <div className="bg-card border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Treasury balance
              </p>
              <p className="mt-2 font-mono text-2xl text-blue">
                {treasury ? formatKj(treasury.joulesBalance) : "—"}
              </p>
              <p className="text-[11px] text-gray-600 mt-1">
                {TREASURY_USER_ID}
              </p>
            </div>

            <div className="bg-card border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Bootstrap pool remaining
              </p>
              <p className="mt-2 font-mono text-2xl text-blue">
                {bootstrapPool
                  ? `${bootstrapPool.remainingKj.toLocaleString()} kJ`
                  : "—"}
              </p>
              <p className="text-[11px] text-gray-600 mt-1">
                {BOOTSTRAP_POOL_ID}
              </p>
            </div>

            <div className="bg-card border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider">
                Total users
              </p>
              <p className="mt-2 font-mono text-2xl text-blue">
                {totalUsers.toLocaleString()}
              </p>
              <p className="text-[11px] text-gray-600 mt-1">
                excluding treasury
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: User list */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Top 30 users by recent activity
          </h2>
          {topUsers.length === 0 ? (
            <p className="text-sm text-gray-500">No users yet</p>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="grid grid-cols-[60px_1fr_120px_70px_120px_140px] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
                <span>#</span>
                <span>username</span>
                <span className="text-right">balance</span>
                <span className="text-right">rspt</span>
                <span>joined</span>
                <span>invited by</span>
              </div>
              <div className="divide-y divide-gray-800">
                {topUsers.map((u) => {
                  const inviter = u.referredBy
                    ? inviterMap.get(u.referredBy) ?? null
                    : null;
                  return (
                    <div
                      key={u.id}
                      className="grid grid-cols-[60px_1fr_120px_70px_120px_140px] px-4 py-2.5 text-sm items-center"
                    >
                      <span className="font-mono text-gray-300">
                        #{u.userNumber}
                      </span>
                      <Link
                        href={`/admin/users/${u.id}`}
                        className="font-medium text-blue hover:text-deepblue truncate"
                      >
                        @{u.username}
                      </Link>
                      <span className="text-right font-mono text-gray-200">
                        {formatKj(u.joulesBalance)}
                      </span>
                      <span className="text-right font-mono text-gray-400">
                        {u.ratingsSinceLastPost}
                      </span>
                      <span className="font-mono text-xs text-gray-400">
                        {relativeTime(u.createdAt)}
                      </span>
                      <span className="text-xs text-gray-400 truncate">
                        {inviter ? `@${inviter}` : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Section 3: Recent ledger entries */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Last 50 ledger entries
          </h2>
          {recentEntries.length === 0 ? (
            <p className="text-sm text-gray-500">No ledger entries yet</p>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="grid grid-cols-[88px_200px_120px_140px_110px_140px] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
                <span>time</span>
                <span>entry type</span>
                <span className="text-right">amount</span>
                <span>user</span>
                <span>ref type</span>
                <span>ref id</span>
              </div>
              <div className="divide-y divide-gray-800">
                {recentEntries.map((e) => (
                  <div
                    key={e.id}
                    className="grid grid-cols-[88px_200px_120px_140px_110px_140px] px-4 py-2 text-sm items-center"
                  >
                    <span className="font-mono text-xs text-gray-400">
                      {formatTime(e.createdAt)}
                    </span>
                    <span
                      className={`font-mono text-xs ${entryTypeColor(e.entryType)}`}
                    >
                      {e.entryType}
                    </span>
                    <span
                      className={`text-right font-mono text-xs ${entryTypeColor(e.entryType)}`}
                    >
                      {formatJ(e.amount)}
                    </span>
                    <span className="text-xs text-gray-300 truncate">
                      @{e.user.username}
                    </span>
                    <span className="text-xs text-gray-500 font-mono">
                      {e.referenceType ?? "—"}
                    </span>
                    <span className="text-xs text-gray-500 font-mono truncate">
                      {e.referenceId ? e.referenceId.slice(0, 12) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Section 4: 24h entry type breakdown */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Last 24h — entry type breakdown
          </h2>
          {breakdownRaw.length === 0 ? (
            <p className="text-sm text-gray-500">No activity in the last 24h</p>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden max-w-2xl">
              <div className="grid grid-cols-[1fr_100px_180px] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
                <span>entry type</span>
                <span className="text-right">count</span>
                <span className="text-right">sum</span>
              </div>
              <div className="divide-y divide-gray-800">
                {breakdownRaw.map((row) => (
                  <div
                    key={row.entryType}
                    className="grid grid-cols-[1fr_100px_180px] px-4 py-2 text-sm items-center"
                  >
                    <span
                      className={`font-mono text-xs ${entryTypeColor(row.entryType)}`}
                    >
                      {row.entryType}
                    </span>
                    <span className="text-right font-mono text-gray-200">
                      {row._count._all.toLocaleString()}
                    </span>
                    <span
                      className={`text-right font-mono text-xs ${entryTypeColor(row.entryType)}`}
                    >
                      {formatJ(row._sum.amount ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Section 5: Recent admin actions */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Recent admin actions
          </h2>
          {recentActions.length === 0 ? (
            <p className="text-sm text-gray-500">No admin actions yet</p>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="grid grid-cols-[88px_120px_160px_140px_120px_1fr] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
                <span>time</span>
                <span>operator</span>
                <span>operation</span>
                <span>target</span>
                <span>result</span>
                <span>error</span>
              </div>
              <div className="divide-y divide-gray-800">
                {recentActions.map((a) => (
                  <div
                    key={a.id}
                    className="grid grid-cols-[88px_120px_160px_140px_120px_1fr] px-4 py-2 text-sm items-center"
                  >
                    <span className="font-mono text-xs text-gray-400">
                      {formatTime(a.createdAt)}
                    </span>
                    <span className="text-xs text-gray-300 truncate">
                      @{actionUserMap.get(a.operatorId) ??
                        a.operatorId.slice(0, 8)}
                    </span>
                    <span className="text-xs font-mono text-gray-200">
                      {a.operation}
                    </span>
                    <span className="text-xs text-gray-300 truncate">
                      {a.targetUserId
                        ? `@${actionUserMap.get(a.targetUserId) ?? a.targetUserId.slice(0, 8)}`
                        : "—"}
                    </span>
                    <span
                      className={`text-xs font-mono ${actionResultColor(a.result)}`}
                    >
                      {a.result}
                    </span>
                    <span className="text-xs text-gray-500 truncate">
                      {a.errorMessage ?? "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
