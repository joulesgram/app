import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import Logo from "@/components/Logo";
import { GENESIS_KJ, SIGNUP_TIERS } from "@/lib/constants";
import { getTierLabel } from "@/lib/joules";
import { getLeaderboard } from "@/lib/leaderboard";

const TOP_LIMIT = 100;

const UPLOAD_NET_KJ = -70;
const RATING_NET_KJ = -0.1;
const DIRECT_REFERRAL_NET_KJ = 0.5;

function actionsNeeded(deltaKj: number, effectPerActionKj: number): number {
  if (deltaKj <= 0 || effectPerActionKj <= 0) return 0;
  return Math.ceil(deltaKj / effectPerActionKj);
}

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const rows = await getLeaderboard(TOP_LIMIT, session.user.id);
  const topRows = rows.filter((row) => row.rank <= TOP_LIMIT);

  const currentIndex = rows.findIndex((row) => row.id === session.user.id);
  const currentUserRow = currentIndex >= 0 ? rows[currentIndex] : null;
  const aheadRow = currentIndex > 0 ? rows[currentIndex - 1] : null;
  const behindRow = currentIndex >= 0 && currentIndex < rows.length - 1 ? rows[currentIndex + 1] : null;

  const gapToAhead = aheadRow && currentUserRow ? aheadRow.coins - currentUserRow.coins : null;

  return (
    <main className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Logo className="text-xl" />
          <p className="text-xs text-gray-400">Updated just now</p>
        </div>
      </header>

      <section className="max-w-4xl mx-auto px-4 py-6">
        <div className="bg-card border border-gray-800 rounded-xl p-4 mb-5">
          <p className="text-sm text-gray-300 leading-relaxed">
            Founder #1 = {GENESIS_KJ.toLocaleString("en-US")} kJ genesis; early users receive tiered
            emissions (#{SIGNUP_TIERS[1].max}: {SIGNUP_TIERS[1].reward} kJ, #
            {SIGNUP_TIERS[2].max}: {SIGNUP_TIERS[2].reward} kJ, beyond: {SIGNUP_TIERS[3].reward} kJ).
          </p>
        </div>

        {currentUserRow && (
          <div className="bg-card border border-gray-800 rounded-xl p-4 mb-5 space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-300">Rank projection</h2>
            <p className="text-xs text-gray-400 leading-relaxed">
              To move up from your current position, you need to close your gap to the user directly ahead.
              Under current economics: uploads are net {UPLOAD_NET_KJ} kJ each (non-improving for rank),
              ratings are net {RATING_NET_KJ} kJ each, and direct referrals at level 1 add +
              {DIRECT_REFERRAL_NET_KJ} kJ each.
            </p>
            {aheadRow && gapToAhead !== null ? (
              <div className="grid gap-2 text-sm">
                <p className="text-gray-200">
                  You are <span className="font-mono text-[#00d4ff]">{gapToAhead.toFixed(1)} kJ</span> behind @
                  {aheadRow.username}.
                </p>
                <ul className="space-y-1 text-xs text-gray-400">
                  <li>
                    Uploads needed: <span className="font-mono text-red-300">N/A for rank climb</span> (each
                    upload decreases balance by 70 kJ).
                  </li>
                  <li>
                    Ratings needed: <span className="font-mono">N/A for rank climb</span> (each rating decreases
                    balance by 0.1 kJ).
                  </li>
                  <li>
                    Direct referrals needed: <span className="font-mono text-green-300">
                      {actionsNeeded(gapToAhead, DIRECT_REFERRAL_NET_KJ).toLocaleString("en-US")}
                    </span>{" "}
                    = ceil({gapToAhead.toFixed(1)} / {DIRECT_REFERRAL_NET_KJ}).
                  </li>
                </ul>
              </div>
            ) : (
              <p className="text-xs text-green-300">You are currently #1. No user ahead to catch.</p>
            )}
          </div>
        )}

        {topRows.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">No users on the leaderboard yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-[64px_1fr_96px_110px_120px_170px] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
              <span>Rank</span>
              <span>User</span>
              <span>User #</span>
              <span>Balance</span>
              <span>Tier</span>
              <span>Adj. Gap</span>
            </div>
            <div className="divide-y divide-gray-800">
              {rows.map((row, index) => {
                const isCurrentUser = row.id === session.user.id;
                const prev = index > 0 ? rows[index - 1] : null;
                const next = index < rows.length - 1 ? rows[index + 1] : null;
                const aheadGap = prev ? prev.coins - row.coins : null;
                const behindGap = next ? row.coins - next.coins : null;

                return (
                  <div
                    key={row.id}
                    className={`grid grid-cols-[64px_1fr_96px_110px_120px_170px] px-4 py-3 text-sm ${
                      isCurrentUser ? "bg-[#10243c] border-l-2 border-l-[#00d4ff]" : "bg-transparent"
                    }`}
                  >
                    <span className="font-mono text-gray-300">#{row.rank}</span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-white">@{row.username}</p>
                      <p className="text-xs text-gray-500">
                        Joined {new Date(row.createdAt).toLocaleDateString("en-US")}
                      </p>
                    </div>
                    <span className="text-gray-300">#{row.userNumber}</span>
                    <span className="font-mono text-[#00d4ff]">{row.coins.toLocaleString("en-US")} kJ</span>
                    <span className="text-xs">
                      <span className="inline-flex px-2 py-1 rounded-full border border-gray-700 text-gray-200">
                        {getTierLabel(row.userNumber)}
                      </span>
                    </span>
                    <span className="text-xs text-gray-300 leading-tight">
                      <span className="block">
                        Ahead: {aheadGap === null ? "—" : `${aheadGap.toFixed(1)} kJ`}
                      </span>
                      <span className="block text-gray-500">
                        Behind: {behindGap === null ? "—" : `${behindGap.toFixed(1)} kJ`}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
