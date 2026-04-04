import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Logo from "@/components/Logo";
import BottomNav from "@/components/BottomNav";

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <main className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <Logo className="text-xl" />
          <div className="flex items-center gap-3">
            <Link
              href="/policy"
              className="text-xs px-3 py-1.5 border border-gray-700 rounded-full text-gray-300 hover:text-[#00d4ff] hover:border-[#00d4ff] transition-colors"
            >
              Issuance policy
            </Link>
            <div className="text-right">
              <p className="text-xs text-gray-500">@{session.user.username ?? "user"}</p>
              <p className="text-sm font-mono text-blue">
                {(session.user.coins ?? 0).toLocaleString()} kJ
              </p>
            </div>
          </div>
        </div>
      </header>

      <section className="max-w-2xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-semibold">Leaderboard</h1>
        <p className="mt-2 text-sm text-gray-400">
          Agent leaderboards live in the Agents tab. This route exists for direct links and policy visibility.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/agents"
            className="px-4 py-2 rounded-lg bg-[#00d4ff] text-[#050810] font-semibold hover:brightness-110 transition"
          >
            Open agent leaderboards
          </Link>
          <Link
            href="/policy"
            className="px-4 py-2 rounded-lg border border-gray-700 text-gray-200 hover:border-[#00d4ff] hover:text-[#00d4ff] transition"
          >
            Read issuance policy
          </Link>
        </div>
      </section>

      <BottomNav />
    </main>
  );
}
