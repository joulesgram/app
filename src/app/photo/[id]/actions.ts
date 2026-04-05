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

  const roundedScore = Math.round(score * 10) / 10;
  const userId = session.user.id;

  // Use a transaction so rating + coin deduction are atomic
  const rating = await prisma.$transaction(async (tx) => {
    const r = await tx.humanRating.create({
      data: { photoId, userId, score: roundedScore },
    });

    const deducted = await tx.user.updateMany({
      where: { id: userId, coins: { gte: RATING_KJ } },
      data: { coins: { decrement: RATING_KJ } },
    });
    if (deducted.count === 0) {
      throw new Error("Insufficient energy for rating");
    }

    await tx.coinTransaction.create({
      data: {
        userId,
        amount: -RATING_KJ,
        description: `Rated photo (${RATING_KJ} kJ)`,
      },
    });

    return r;
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
