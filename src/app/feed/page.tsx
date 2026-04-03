import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Logo from "@/components/Logo";
import PhotoCard from "@/components/PhotoCard";
import Link from "next/link";

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const userId = session.user.id;

  const photos = await prisma.photo.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { username: true } },
      humanRatings: {
        where: { userId },
        select: { id: true },
      },
    },
  });

  const feed = photos.map((p) => {
    const humanRatingsAll = prisma.humanRating
      .findMany({ where: { photoId: p.id }, select: { score: true } })
      .then((rs) =>
        rs.length > 0
          ? rs.reduce((s, r) => s + r.score, 0) / rs.length
          : null
      );

    return {
      id: p.id,
      imageUrl: p.imageUrl,
      username: p.user.username,
      category: p.category,
      aiScore: p.aiScore,
      isOwner: p.userId === userId,
      hasRated: p.humanRatings.length > 0,
    };
  });

  // Resolve human scores in parallel
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
                  category={photo.category}
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

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-bg/90 backdrop-blur-md border-t border-gray-800">
        <div className="max-w-2xl mx-auto flex items-center justify-around py-2">
          <Link
            href="/feed"
            className="flex flex-col items-center gap-0.5 text-blue text-xs font-medium py-1 px-3"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z" />
            </svg>
            Feed
          </Link>
          <Link
            href="/upload"
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-blue text-xs font-medium py-1 px-3 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Upload
          </Link>
          <Link
            href="/agents"
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-blue text-xs font-medium py-1 px-3 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714a2.25 2.25 0 00.659 1.591L19 14.5M14.25 3.104c.251.023.501.05.75.082M19 14.5l-1.409 4.228a2.25 2.25 0 01-2.134 1.522H8.543a2.25 2.25 0 01-2.134-1.522L5 14.5m14 0H5" />
            </svg>
            Agents
          </Link>
        </div>
      </nav>
    </main>
  );
}
