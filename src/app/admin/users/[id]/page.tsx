import { notFound } from "next/navigation";
import Link from "next/link";
import { Decimal } from "decimal.js";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEBIT_TYPES,
  POOL_MINT_TYPES,
  RESERVE_GRANT_TYPES,
  STAKE_RESOLUTION_TYPES,
} from "@/lib/integrity";
import CreditDebitForm from "@/app/admin/CreditDebitForm";
import ResetCounterButton from "@/app/admin/ResetCounterButton";
import SetReferredByForm from "@/app/admin/SetReferredByForm";

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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[11px] text-gray-500 uppercase tracking-wider">
        {label}
      </p>
      <p className="mt-1 text-sm">{children}</p>
    </div>
  );
}

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user || session.user.userNumber !== 1) notFound();

  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      userNumber: true,
      username: true,
      email: true,
      joulesBalance: true,
      ratingsSinceLastPost: true,
      createdAt: true,
      referralCode: true,
      referredBy: true,
    },
  });

  if (!user) notFound();

  const inviter = user.referredBy
    ? await prisma.user.findUnique({
        where: { referralCode: user.referredBy },
        select: { username: true },
      })
    : null;

  const [entries, ledgerSumResult] = await Promise.all([
    prisma.ledgerEntry.findMany({
      where: { userId: id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ledgerEntry.aggregate({
      where: { userId: id },
      _sum: { amount: true },
    }),
  ]);

  const ledgerSum = decimalFrom(ledgerSumResult._sum.amount);
  const balance = decimalFrom(user.joulesBalance);
  const reconciled = ledgerSum.eq(balance);
  const drift = ledgerSum.minus(balance);

  return (
    <main className="min-h-screen pb-20 bg-bg text-gray-200">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-xs text-gray-400 hover:text-blue"
            >
              ← admin
            </Link>
            <h1 className="text-xl font-bold">@{user.username}</h1>
          </div>
          <p className="text-xs text-gray-500">founder view</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* User card */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            User
          </h2>
          <div className="bg-card border border-gray-800 rounded-xl p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Field label="user number">#{user.userNumber}</Field>
            <Field label="username">@{user.username}</Field>
            <Field label="email">{user.email}</Field>
            <Field label="balance">
              <span className="text-blue">{formatKj(user.joulesBalance)}</span>
            </Field>
            <Field label="ratings since last post">
              <span className="inline-flex items-center gap-2">
                {user.ratingsSinceLastPost}
                <ResetCounterButton
                  userId={user.id}
                  currentCount={user.ratingsSinceLastPost}
                />
              </span>
            </Field>
            <Field label="joined">
              {relativeTime(user.createdAt)}{" "}
              <span className="text-gray-600">
                ({user.createdAt.toISOString().slice(0, 10)})
              </span>
            </Field>
            <Field label="invited by">
              {inviter ? `@${inviter.username}` : "—"}
            </Field>
            <Field label="referral code">
              <span className="font-mono text-xs text-gray-300">
                {user.referralCode}
              </span>
            </Field>
            <Field label="user id">
              <span className="font-mono text-xs text-gray-500">{user.id}</span>
            </Field>
          </div>
        </section>

        {/* Set referredBy — only when missing */}
        {user.referredBy === null && (
          <section>
            <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
              Set referredBy (currently unset)
            </h2>
            <div className="bg-card border border-gray-800 rounded-xl p-5">
              <SetReferredByForm userId={user.id} />
            </div>
          </section>
        )}

        {/* Per-user reconciliation */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Rule #4 — balance reconciliation
          </h2>
          <div className="bg-card border border-gray-800 rounded-xl p-5">
            {reconciled ? (
              <p className="font-mono text-green-400">
                ✓ reconciled · ledger sum {ledgerSum.toFixed(4)} J = balance{" "}
                {balance.toFixed(4)} J
              </p>
            ) : (
              <p className="font-mono text-red-500">
                ✗ DRIFT: diff = {drift.toFixed(4)} J · ledger sum{" "}
                {ledgerSum.toFixed(4)} J vs balance {balance.toFixed(4)} J
              </p>
            )}
          </div>
        </section>

        {/* Credit / debit */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Credit / debit
          </h2>
          <div className="bg-card border border-gray-800 rounded-xl p-5">
            <CreditDebitForm userId={user.id} />
          </div>
        </section>

        {/* Full ledger history */}
        <section>
          <h2 className="text-sm uppercase tracking-wider text-gray-400 mb-3">
            Full ledger history ({entries.length}{" "}
            {entries.length === 1 ? "entry" : "entries"})
          </h2>
          {entries.length === 0 ? (
            <p className="text-sm text-gray-500">No ledger entries yet</p>
          ) : (
            <div className="rounded-xl border border-gray-800 overflow-hidden">
              <div className="grid grid-cols-[170px_200px_130px_110px_140px_1fr] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
                <span>when</span>
                <span>entry type</span>
                <span className="text-right">amount</span>
                <span>ref type</span>
                <span>ref id</span>
                <span>description</span>
              </div>
              <div className="divide-y divide-gray-800">
                {entries.map((e) => (
                  <div
                    key={e.id}
                    className="grid grid-cols-[170px_200px_130px_110px_140px_1fr] px-4 py-2 text-sm items-center"
                  >
                    <span className="font-mono text-xs text-gray-400">
                      {e.createdAt.toISOString().slice(0, 19).replace("T", " ")}
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
                    <span className="text-xs text-gray-500 font-mono">
                      {e.referenceType ?? "—"}
                    </span>
                    <span className="text-xs text-gray-500 font-mono truncate">
                      {e.referenceId ? e.referenceId.slice(0, 12) : "—"}
                    </span>
                    <span className="text-xs text-gray-400 truncate">
                      {e.description ?? "—"}
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
