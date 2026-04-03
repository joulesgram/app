import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Logo from "@/components/Logo";
import PhotoCard from "@/components/PhotoCard";
import Link from "next/link";
import BottomNav from "@/components/BottomNav";

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
    },
  });

  const feed = photos.map((p) => ({
    id: p.id,
    imageUrl: p.imageUrl,
    username: p.user.username,
    aiScore: p.aiScore,
    isOwner: p.userId === userId,
    hasRated: p.humanRatings.length > 0,
  }));

  // Compute human score averages in parallel
  const humanScores = await Promise.all(
    photos.map((p) =>
      prisma.humanRating
        .findMany({ where: { photoId: p.id }, select: { score: true } })
        .then((rs) =>
          rs.length > 0
            ? rs.reduce((s, r) => s + r.score, 0) / rs.length
            : null
        )
    )
  );

  return (
    <main className="min-h-screen pb-20">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Logo className="text-xl" />
          <div className="flex items-center gap-3">
            <Link
              href="/agents"
              className="w-9 h-9 flex items-center justify-center bg-card border border-gray-700 rounded-full text-lg hover:border-blue transition-colors"
              title="Create Agent"
            >
              🤖
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
            {feed.map((photo, i) => (
              <Link key={photo.id} href={`/photo/${photo.id}`}>
                <PhotoCard
                  imageUrl={photo.imageUrl}
                  username={photo.username}
                  aiScore={photo.aiScore}
                  humanScore={humanScores[i]}
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
