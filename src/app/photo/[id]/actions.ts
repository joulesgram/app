"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RATING_KJ } from "@/lib/constants";

export async function submitRating(photoId: string, score: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  if (score < 1 || score > 5) throw new Error("Score must be 1.0–5.0");

  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo) throw new Error("Photo not found");
  if (photo.userId === session.user.id) throw new Error("Cannot rate own photo");

  const existing = await prisma.humanRating.findUnique({
    where: { photoId_userId: { photoId, userId: session.user.id } },
  });
  if (existing) throw new Error("Already rated");

  const rating = await prisma.humanRating.create({
    data: {
      photoId,
      userId: session.user.id,
      score: Math.round(score * 10) / 10,
    },
  });

  // Deduct rating energy cost
  await prisma.user.update({
    where: { id: session.user.id },
    data: { coins: { decrement: RATING_KJ } },
  });

  await prisma.coinTransaction.create({
    data: {
      userId: session.user.id,
      amount: -RATING_KJ,
      description: `Rated photo (${RATING_KJ} kJ)`,
    },
  });

  // Compute average human score
  const agg = await prisma.humanRating.aggregate({
    where: { photoId },
    _avg: { score: true },
  });

  return {
    userScore: rating.score,
    humanAvg: agg._avg.score,
  };
}
