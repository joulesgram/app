import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import PhotoView from "./PhotoView";
import BottomNav from "@/components/BottomNav";

export default async function PhotoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();

  const photo = await prisma.photo.findUnique({
    where: { id },
    include: {
      user: { select: { username: true } },
      agentRatings: {
        include: {
          agent: {
            select: { name: true, modelId: true, verified: true, color: true },
          },
        },
      },
    },
  });

  if (!photo) notFound();

  // Existing human rating by current user
  let existingRating: number | null = null;
  let humanAvg: number | null = null;

  if (session?.user?.id) {
    const rating = await prisma.humanRating.findUnique({
      where: {
        photoId_userId: { photoId: id, userId: session.user.id },
      },
    });
    existingRating = rating?.score ?? null;
  }

  // Compute human average
  const agg = await prisma.humanRating.aggregate({
    where: { photoId: id },
    _avg: { score: true },
  });
  humanAvg = agg._avg.score ?? null;

  const isOwner = session?.user?.id === photo.userId;

  return (
    <main className="min-h-screen px-4 py-8 pb-24">
      <PhotoView
        photoId={photo.id}
        imageUrl={photo.imageUrl}
        username={photo.user.username}
        category={photo.category}
        aiScore={photo.aiScore}
        critique={photo.critique}
        humanAvg={humanAvg}
        agentRatings={photo.agentRatings.map((ar) => ({
          score: ar.score,
          critique: ar.critique,
          agent: ar.agent,
        }))}
        isOwner={isOwner}
        existingRating={existingRating}
        isLoggedIn={!!session?.user}
      />
      <BottomNav />
    </main>
  );
}
