"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PHOTO_SCORE_KJ } from "@/lib/constants";

export async function createPhoto(imageUrl: string, _category: string | null) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  // Check user has enough coins for scoring
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { coins: true },
  });
  if (!user || user.coins < PHOTO_SCORE_KJ) {
    throw new Error(
      `Not enough energy. Need ${PHOTO_SCORE_KJ} kJ, have ${user?.coins ?? 0} kJ`
    );
  }

  // Category is always null here — AI scoring detects it
  const photo = await prisma.photo.create({
    data: {
      imageUrl,
      userId: session.user.id,
      category: null,
    },
  });

  return { photoId: photo.id };
}
