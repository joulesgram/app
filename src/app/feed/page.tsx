import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Logo from "@/components/Logo";
import PhotoCard from "@/components/PhotoCard";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";
import IssuancePolicyLink from "@/components/IssuancePolicyLink";
import BatteryWidget from "@/components/BatteryWidget";
import { isSparkUIMode } from "@/lib/spark-ui";

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const userId = session.user.id;

  const photos = await prisma.photo.findMany({
    where: {
      aiScore: { not: null },
      nsfw: false,
    },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { username: true } },
      humanRatings: {
        where: { userId },
        select: { id: true },
      },
      _count: {
        select: { humanRatings: true },
      },
    },
  });

  const sortedPhotos = [...photos].sort((a, b) => {
    const aNeedsVotes = a.userId === userId && a._count.humanRatings === 0;
    const bNeedsVotes = b.userId === userId && b._count.humanRatings === 0;
    if (aNeedsVotes !== bNeedsVotes) return aNeedsVotes ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });

  // One aggregate query for all photo averages. Previously this was N+1,
  // which made the feed page multi-second to render and made clicking the
  // Feed bottom-nav item feel like a dead click while the RSC payload loaded.
  const photoIds = sortedPhotos.map((p) => p.id);
  const humanAvgRows =
    photoIds.length === 0
      ? []
      : await prisma.humanRating.groupBy({
          by: ["photoId"],
          where: { photoId: { in: photoIds } },
          _avg: { score: true },
        });
  const humanAvgByPhotoId = new Map(
    humanAvgRows.map((row) => [row.photoId, row._avg.score])
  );

  const feed = sortedPhotos.map((p) => ({
    id: p.id,
    imageUrl: p.imageUrl,
    username: p.user.username,
    aiScore: p.aiScore,
    humanScore: humanAvgByPhotoId.get(p.id) ?? null,
    isOwner: p.userId === userId,
    hasRated: p.humanRatings.length > 0,
  }));

  return (
    <main className="min-h-screen pb-20">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Logo className="text-xl" />
          <div className="flex items-center gap-3">
            <IssuancePolicyLink />
            <Link
              href="/agents"
              className="w-9 h-9 flex items-center justify-center bg-card border border-gray-700 rounded-full text-lg hover:border-blue transition-colors"
              title="Create Agent"
            >
              🤖
            </Link>
            <div className="text-right">
              <p className="text-xs text-gray-500">@{session.user.username ?? "user"}</p>
              {isSparkUIMode({ joulesBalance: session.user.joulesBalance ?? 0 }) ? (
                <BatteryWidget joulesBalance={session.user.joulesBalance ?? 0} size="sm" />
              ) : (
                <p className="text-sm font-mono text-blue">
                  {Math.floor((session.user.joulesBalance ?? 0) / 1000).toLocaleString()} kJ
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Photo feed */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        {feed.length === 0 ? (
          <div className="text-center text-gray-500 mt-20">
            <p className="text-lg">No photos yet</p>
            <Link
              href="/upload"
              className="mt-4 inline-block text-blue hover:text-deepblue transition-colors"
            >
              Upload the first photo &rarr;
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {feed.map((photo) => (
              <Link key={photo.id} href={`/photo/${photo.id}`}>
                <PhotoCard
                  imageUrl={photo.imageUrl}
                  username={photo.username}
                  aiScore={photo.aiScore}
                  humanScore={photo.humanScore}
                  isOwner={photo.isOwner}
                  hasRated={photo.hasRated}
                />
              </Link>
            ))}
          </div>
        )}
      </div>

      <BottomNav />
    </main>
  );
}
