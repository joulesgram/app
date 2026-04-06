import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import BottomNav from "@/components/BottomNav";
import Logo from "@/components/Logo";
import { GENESIS_KJ, SIGNUP_TIERS } from "@/lib/constants";
import { getTierLabel } from "@/lib/joules";
import { getLeaderboard } from "@/lib/leaderboard";

const TOP_LIMIT = 100;

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const rows = await getLeaderboard(TOP_LIMIT, session.user.id);
  const topRows = rows.filter((row) => row.rank <= TOP_LIMIT);

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

        {topRows.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">No users on the leaderboard yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-800 overflow-hidden">
            <div className="grid grid-cols-[64px_1fr_96px_110px_120px] bg-[#0d1423] px-4 py-3 text-xs uppercase tracking-wider text-gray-400">
              <span>Rank</span>
              <span>User</span>
              <span>User #</span>
              <span>Balance</span>
              <span>Tier</span>
            </div>
            <div className="divide-y divide-gray-800">
              {rows.map((row) => {
                const isCurrentUser = row.id === session.user.id;
                return (
                  <div
                    key={row.id}
                    className={`grid grid-cols-[64px_1fr_96px_110px_120px] px-4 py-3 text-sm ${
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
                    <span className="font-mono text-[#00d4ff]">{row.joulesBalance.toLocaleString("en-US")} kJ</span>
                    <span className="text-xs">
                      <span className="inline-flex px-2 py-1 rounded-full border border-gray-700 text-gray-200">
                        {getTierLabel(row.userNumber)}
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
