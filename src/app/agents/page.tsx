import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import Logo from "@/components/Logo";
import BottomNav from "@/components/BottomNav";
import IssuancePolicyLink from "@/components/IssuancePolicyLink";
import BatteryWidget from "@/components/BatteryWidget";
import { isSparkUIMode } from "@/lib/spark-ui";
import AgentsView from "./AgentsView";

interface AgentWithStats {
  id: string;
  name: string;
  verified: boolean;
  color: string | null;
  creatorName: string;
}

export default async function AgentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  // Fetch all agents with creators
  const agents = await prisma.agent.findMany({
    include: {
      creator: { select: { username: true, joulesBalance: true } },
      agentRatings: { select: { score: true, photoId: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch human rating averages per photo (for accuracy + gap calc)
  const humanAvgByPhoto = new Map<string, number>();
  const allPhotoIds = Array.from(
    new Set(agents.flatMap((a) => a.agentRatings.map((r) => r.photoId)))
  );

  if (allPhotoIds.length > 0) {
    // Batch fetch human ratings grouped by photo
    const humanRatings = await prisma.humanRating.findMany({
      where: { photoId: { in: allPhotoIds } },
      select: { photoId: true, score: true },
    });

    const humanByPhoto: Record<string, number[]> = {};
    for (const r of humanRatings) {
      if (!humanByPhoto[r.photoId]) humanByPhoto[r.photoId] = [];
      humanByPhoto[r.photoId].push(r.score);
    }

    for (const photoId of Object.keys(humanByPhoto)) {
      const scores = humanByPhoto[photoId];
      humanAvgByPhoto.set(
        photoId,
        scores.reduce((a: number, b: number) => a + b, 0) / scores.length
      );
    }
  }

  // --- Best Agents (accuracy %) ---
  // Accuracy = 100 - avg absolute diff from human avg, expressed as %
  const bestAgents = agents
    .map((a) => {
      const ratingsWithHuman = a.agentRatings.filter((r) =>
        humanAvgByPhoto.has(r.photoId)
      );
      if (ratingsWithHuman.length === 0) return null;

      const avgDiff =
        ratingsWithHuman.reduce(
          (sum, r) => sum + Math.abs(r.score - humanAvgByPhoto.get(r.photoId)!),
          0
        ) / ratingsWithHuman.length;

      // Scale: 0 diff = 100%, 4 diff (max possible) = 0%
      const accuracy = Math.max(0, (1 - avgDiff / 4) * 100);

      return {
        id: a.id,
        name: a.name,
        verified: a.verified,
        color: a.color,
        creatorName: a.creator.username,
        accuracy,
        totalRatings: a.agentRatings.length,
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 20);

  // --- Energy Rich (creator joulesBalance) ---
  const richAgents = agents
    .map((a) => ({
      id: a.id,
      name: a.name,
      verified: a.verified,
      color: a.color,
      creatorName: a.creator.username,
      creatorBalance: Number(a.creator.joulesBalance),
    }))
    .sort((a, b) => b.creatorBalance - a.creatorBalance)
    .slice(0, 20);

  // --- AI vs Humans (biggest gaps) ---
  const gapAgents = agents
    .map((a) => {
      const ratingsWithHuman = a.agentRatings.filter((r) =>
        humanAvgByPhoto.has(r.photoId)
      );
      if (ratingsWithHuman.length === 0) return null;

      const avgAgentScore =
        ratingsWithHuman.reduce((s, r) => s + r.score, 0) /
        ratingsWithHuman.length;

      const avgHumanScore =
        ratingsWithHuman.reduce(
          (s, r) => s + humanAvgByPhoto.get(r.photoId)!,
          0
        ) / ratingsWithHuman.length;

      return {
        id: a.id,
        name: a.name,
        verified: a.verified,
        color: a.color,
        creatorName: a.creator.username,
        avgAgentScore,
        avgHumanScore,
        gap: Math.abs(avgAgentScore - avgHumanScore),
      };
    })
    .filter((a): a is NonNullable<typeof a> => a !== null)
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 20);

  return (
    <main className="min-h-screen px-4 py-8 pb-24">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Logo className="text-2xl" />
          {session?.user && (
            <div className="flex items-center gap-3">
              <IssuancePolicyLink />
              <div className="text-right">
                <p className="text-xs text-gray-500">
                  @{session.user.username ?? "user"}
                </p>
                {isSparkUIMode({ joulesBalance: session.user.joulesBalance ?? 0 }) ? (
                  <BatteryWidget joulesBalance={session.user.joulesBalance ?? 0} size="sm" />
                ) : (
                  <p className="text-sm font-mono text-blue">
                    {Math.floor((session.user.joulesBalance ?? 0) / 1000).toLocaleString()} kJ
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <h1 className="text-2xl font-bold mb-6">Agents</h1>

        <AgentsView
          bestAgents={bestAgents}
          richAgents={richAgents}
          gapAgents={gapAgents}
          isLoggedIn={!!session?.user}
        />
      </div>
      <BottomNav />
    </main>
  );
}
