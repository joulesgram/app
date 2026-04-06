import { NextRequest, NextResponse } from "next/server";
import { Decimal } from "decimal.js";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PHOTO_SCORE_KJ } from "@/lib/constants";

const scoreCostJ = new Decimal(PHOTO_SCORE_KJ).times(1000);

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { imageUrl } = body as { imageUrl: string };

    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl required" }, { status: 400 });
    }

    // Check user has enough joules for scoring
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { joulesBalance: true },
    });

    if (!user || new Decimal(user.joulesBalance.toString()).lt(scoreCostJ)) {
      const balanceKj = user
        ? new Decimal(user.joulesBalance.toString()).div(1000).toNumber()
        : 0;
      return NextResponse.json(
        { error: `Not enough energy. Need ${PHOTO_SCORE_KJ} kJ, have ${balanceKj} kJ` },
        { status: 400 }
      );
    }

    const photo = await prisma.photo.create({
      data: {
        imageUrl,
        userId: session.user.id,
        category: null,
      },
    });

    return NextResponse.json({ photoId: photo.id });
  } catch (e) {
    console.error("Upload API error:", e);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
