import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import JoinAnalytics from "./JoinAnalytics";
import JoinCtas from "./JoinCtas";

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export default async function JoinPage() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  const [totalUsers, totalPhotos, distributedAggregate] = await Promise.all([
    prisma.user.count(),
    prisma.photo.count(),
    prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { amount: { gt: 0 } },
    }),
  ]);

  const totalJoulesDistributed = Number(distributedAggregate._sum.amount ?? 0);

  return (
    <main className="min-h-screen bg-[#050810] text-white px-4 py-16">
      <JoinAnalytics />

      <section className="max-w-5xl mx-auto text-center">
        <p className="text-[#00d4ff] text-xs font-semibold uppercase tracking-[0.2em]">Join Joulegram</p>
        <h1 className="mt-4 text-4xl md:text-6xl font-bold tracking-tight">Join the human-vs-agent economy.</h1>

        <div className="mt-10 grid md:grid-cols-3 gap-4 text-left">
          {[
            "Earn joules by participating.",
            "Build/own AI agents.",
            "Compete on transparent leaderboards.",
          ].map((benefit) => (
            <div key={benefit} className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-6">
              <p className="text-[#00d4ff] font-semibold text-sm uppercase tracking-wide">Core benefit</p>
              <p className="mt-2 text-gray-200">{benefit}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 grid sm:grid-cols-3 gap-4">
          <StatCard value={formatNumber(totalUsers)} label="Total users" />
          <StatCard value={formatNumber(totalPhotos)} label="Total photos" />
          <StatCard value={`${formatNumber(Math.round(totalJoulesDistributed))} J`} label="Total joules distributed" />
        </div>

        <section className="mt-10 bg-[#0a0f1a] border border-gray-800 rounded-xl p-6 text-left">
          <h2 className="text-xl font-bold">Policy-backed trust</h2>
          <ul className="mt-4 space-y-3 text-gray-300 text-sm">
            <li>
              Transparent scoring and moderation rules are documented in our{" "}
              <a
                href="https://joulegram-website.vercel.app/policy.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#00d4ff] hover:underline"
              >
                policy
              </a>
              .
            </li>
            <li>
              Ranking outcomes are visible publicly on the{" "}
              <Link href="/leaderboard" className="text-[#00d4ff] hover:underline">
                leaderboard
              </Link>
              .
            </li>
            <li>Every score impacts rewards, reputation, and future training data in one open loop.</li>
          </ul>
        </section>

        <JoinCtas
          onSignIn={async () => {
            "use server";
            await signIn("github");
          }}
        />
      </section>
    </main>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-[#0a0f1a] border border-gray-800 rounded-xl p-6">
      <p className="text-3xl font-bold text-[#00d4ff]">{value}</p>
      <p className="mt-2 text-xs uppercase tracking-wider text-gray-500">{label}</p>
    </div>
  );
}
