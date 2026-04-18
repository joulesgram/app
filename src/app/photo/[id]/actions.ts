"use server";

import { Decimal } from "decimal.js";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RATING_KJ } from "@/lib/constants";
import { TREASURY_USER_ID } from "@/lib/integrity";
import { transferFromBootstrapPool } from "@/lib/pre-scale";
import { PRE_SCALE } from "@/lib/pre-scale-config";

const ratingCostJ = new Decimal(RATING_KJ).times(1000);
const rateEarnRewardJ = new Decimal(PRE_SCALE.RATE_EARN_REWARD_J);

export async function submitRating(photoId: string, score: number) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  if (score < 1 || score > 5) throw new Error("Score must be 1.0-5.0");

  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo) throw new Error("Photo not found");
  if (photo.userId === session.user.id) throw new Error("Cannot rate own photo");

  const existing = await prisma.humanRating.findUnique({
    where: { photoId_userId: { photoId, userId: session.user.id } },
  });
  if (existing) throw new Error("Already rated");

  const roundedScore = Math.round(score * 10) / 10;
  const userId = session.user.id;

  // Use a transaction so rating + joule deduction are atomic
  const rating = await prisma.$transaction(async (tx) => {
    const r = await tx.humanRating.create({
      data: { photoId, userId, score: roundedScore },
    });

    // Atomic CAS for balance deduction + ratingsSinceLastPost increment.
    // Both fields update in the same row write, no race window between them.
    const updated = await tx.user.updateMany({
      where: { id: userId, joulesBalance: { gte: ratingCostJ } },
      data: {
        joulesBalance: { decrement: ratingCostJ },
        ratingsSinceLastPost: { increment: 1 },
      },
    });
    if (updated.count === 0) throw new Error("Insufficient balance");

    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { joulesBalance: true },
    });

await tx.ledgerEntry.create({
      data: {
        userId,
        entryType: "RATING_STAKE",
        amount: ratingCostJ.negated(),
        balanceAfter: user.joulesBalance,
        referenceType: "rating",
        referenceId: r.id,
      },
    });
    // Treasury counterparty for rating stake (paired credit, Rule 3)
    await tx.user.update({
      where: { id: TREASURY_USER_ID },
      data: { joulesBalance: { increment: ratingCostJ } },
    });
    const treasuryAfter = await tx.user.findUniqueOrThrow({
      where: { id: TREASURY_USER_ID },
      select: { joulesBalance: true },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: TREASURY_USER_ID,
        entryType: "RATING_STAKE",
        amount: ratingCostJ,
        balanceAfter: treasuryAfter.joulesBalance,
        referenceType: "rating",
        referenceId: r.id,
      },
    });

    // Day 3: flat rate-to-earn. Credit 5 kJ back, capped at 20 per UTC day.
    // Net cost to user: 0 kJ when under cap. Stake debit above is unchanged.
    // Note: count-then-insert under Read Committed isolation means two
    // concurrent ratings from the same user could both observe count=19 and
    // each insert, briefly overshooting the cap. Acceptable at current scale;
    // revisit with a unique (userId, utcDate, seq) index if it matters.
    const todayUtcMidnight = new Date();
    todayUtcMidnight.setUTCHours(0, 0, 0, 0);

    const earnCountToday = await tx.ledgerEntry.count({
      where: {
        userId,
        entryType: "RATE_EARN_FLAT",
        createdAt: { gte: todayUtcMidnight },
      },
    });

    if (earnCountToday < PRE_SCALE.RATE_EARN_DAILY_CAP) {
      await transferFromBootstrapPool(
        tx,
        userId,
        rateEarnRewardJ,
        "RATE_EARN_FLAT",
        "Flat rate-to-earn reward (5 kJ)"
      );
    }

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
