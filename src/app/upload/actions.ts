"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PHOTO_SCORE_KJ } from "@/lib/constants";

export async function createPhoto(
  imageUrl: string
): Promise<{ photoId: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Not authenticated");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { coins: true },
  });

  if (!user || user.coins < PHOTO_SCORE_KJ) {
    throw new Error(
      `Not enough energy. Need ${PHOTO_SCORE_KJ} kJ, have ${user?.coins ?? 0} kJ`
    );
  }

  const photo = await prisma.photo.create({
    data: {
      imageUrl,
      userId: session.user.id,
      category: null,
    },
  });

  return { photoId: photo.id };
}
