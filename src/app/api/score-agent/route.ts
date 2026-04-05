import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RATING_SCALE } from "@/lib/constants";

const anthropic = new Anthropic();

const JOULES_PER_INPUT_TOKEN = 0.003;
const JOULES_PER_OUTPUT_TOKEN = 0.015;
const DEFAULT_BATCH_SIZE = 5;
const MAX_RETRIES = 8;

type BackfillStatus = "queued" | "running" | "completed" | "failed";

interface SingleAgentScore {
  score: number;
  critique: string;
}

async function getOwnedAgent(agentId: string, userId: string) {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) return { error: "Agent not found", status: 404 } as const;
  if (agent.creatorId !== userId) {
    return { error: "Not your agent", status: 403 } as const;
  }
  return { agent } as const;
}

async function ratingAvg(photoId: string) {
  const [avg, total] = await Promise.all([
    prisma.agentRating.aggregate({
      where: { photoId },
      _avg: { score: true },
    }),
    prisma.agentRating.aggregate({
      where: { photoId },
      _sum: { computeJoules: true },
    }),
  ]);

  return {
    aiScore:
      avg._avg.score === null ? null : Math.round(avg._avg.score * 10) / 10,
    computeKJ: (total._sum.computeJoules ?? 0) / 1000,
  };
}

async function updateStatus(agentId: string, status: BackfillStatus, updates = {}) {
  return prisma.agent.update({
    where: { id: agentId },
    data: { backfillStatus: status, ...updates },
    select: {
      id: true,
      backfillStatus: true,
      backfillTotal: true,
      backfillDone: true,
      backfillFailed: true,
      backfillRetries: true,
      backfillLastError: true,
    },
  });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  const owned = await getOwnedAgent(agentId, session.user.id);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }

  const { agent } = owned;
  return NextResponse.json({
    status: agent.backfillStatus,
    total: agent.backfillTotal,
    done: agent.backfillDone,
    failed: agent.backfillFailed,
    retries: agent.backfillRetries,
    error: agent.backfillLastError,
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { agentId, batchSize } = (await req.json()) as {
    agentId: string;
    batchSize?: number;
  };

  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  const owned = await getOwnedAgent(agentId, session.user.id);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }

  const agent = owned.agent;
  if (agent.backfillStatus === "completed") {
    return NextResponse.json({
      status: agent.backfillStatus,
      total: agent.backfillTotal,
      done: agent.backfillDone,
      failed: agent.backfillFailed,
      retries: agent.backfillRetries,
      computeJoules: 0,
      scored: 0,
    });
  }

  if (agent.backfillStatus === "failed" && agent.backfillRetries >= MAX_RETRIES) {
    return NextResponse.json({
      status: "failed",
      total: agent.backfillTotal,
      done: agent.backfillDone,
      failed: agent.backfillFailed,
      retries: agent.backfillRetries,
      error: agent.backfillLastError,
      scored: 0,
      computeJoules: 0,
    });
  }

  await updateStatus(agentId, "running", {
    backfillStartedAt: agent.backfillStartedAt ?? new Date(),
    backfillLastError: null,
  });

  const effectiveBatchSize = Math.max(1, Math.min(batchSize ?? DEFAULT_BATCH_SIZE, 10));
  const photos = await prisma.photo.findMany({
    where: {
      aiScore: { not: null },
      agentRatings: { none: { agentId } },
    },
    select: { id: true, imageUrl: true },
    take: effectiveBatchSize,
    orderBy: { createdAt: "asc" },
  });

  if (photos.length === 0) {
    const completed = await updateStatus(agentId, "completed", {
      backfillDone: agent.backfillTotal,
      backfillCompletedAt: new Date(),
      backfillLastError: null,
    });

    return NextResponse.json({
      status: completed.backfillStatus,
      total: completed.backfillTotal,
      done: completed.backfillDone,
      failed: completed.backfillFailed,
      retries: completed.backfillRetries,
      computeJoules: 0,
      scored: 0,
    });
  }

  const systemPrompt = `You are an AI photo critic with this persona:
Name: "${agent.name}"
Persona: ${agent.persona || "A professional photography critic."}

Rate each photo on a scale of ${RATING_SCALE.min} to ${RATING_SCALE.max} (0.1 precision).

Respond ONLY with valid JSON: an array of objects, one per photo, in the same order as presented:
[
  { "score": <float 1.0-5.0>, "critique": "<2-3 sentences>" }
]`;

  const imageBlocks: Anthropic.ContentBlockParam[] = [];
  for (let j = 0; j < photos.length; j++) {
    const photo = photos[j];

    let imageContent: Anthropic.ImageBlockParam;
    if (photo.imageUrl.startsWith("data:")) {
      const [meta, data] = photo.imageUrl.split(",");
      const mediaType = meta.split(":")[1].split(";")[0] as
        | "image/jpeg"
        | "image/png"
        | "image/gif"
        | "image/webp";
      imageContent = {
        type: "image",
        source: { type: "base64", media_type: mediaType, data },
      };
    } else {
      imageContent = {
        type: "image",
        source: { type: "url", url: photo.imageUrl },
      };
    }

    imageBlocks.push(imageContent);
    imageBlocks.push({ type: "text", text: `Photo ${j + 1} of ${photos.length}` });
  }

  imageBlocks.push({
    type: "text",
    text: `Score all ${photos.length} photos above from your persona's perspective.`,
  });

  let scored = 0;
  let totalComputeJoules = 0;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: imageBlocks }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Model did not return parsable text content");
    }

    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed: SingleAgentScore[] = JSON.parse(jsonStr);

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const batchJoules =
      inputTokens * JOULES_PER_INPUT_TOKEN +
      outputTokens * JOULES_PER_OUTPUT_TOKEN;
    totalComputeJoules += batchJoules;
    const perPhotoJoules = batchJoules / photos.length;

    for (let j = 0; j < photos.length && j < parsed.length; j++) {
      const entry = parsed[j];
      const score = Math.max(
        RATING_SCALE.min,
        Math.min(RATING_SCALE.max, Math.round(entry.score * 10) / 10)
      );

      try {
        await prisma.agentRating.create({
          data: {
            photoId: photos[j].id,
            agentId,
            score,
            critique: entry.critique,
            computeJoules: perPhotoJoules,
          },
        });

        const aggregates = await ratingAvg(photos[j].id);
        if (aggregates.aiScore !== null) {
          await prisma.photo.update({
            where: { id: photos[j].id },
            data: { aiScore: aggregates.aiScore, computeKJ: aggregates.computeKJ },
          });
        }

        scored++;
      } catch (err) {
        console.error("Failed scoring photo", photos[j].id, err);
      }
    }

    const remaining = await prisma.photo.count({
      where: {
        aiScore: { not: null },
        agentRatings: { none: { agentId } },
      },
    });

    const nextStatus: BackfillStatus =
      remaining === 0 ? "completed" : scored === 0 ? "queued" : "running";

    const updated = await updateStatus(agentId, nextStatus, {
      backfillDone: { increment: scored },
      backfillFailed: { increment: Math.max(0, photos.length - scored) },
      backfillCompletedAt: remaining === 0 ? new Date() : null,
    });

    return NextResponse.json({
      status: updated.backfillStatus,
      total: updated.backfillTotal,
      done: updated.backfillDone,
      failed: updated.backfillFailed,
      retries: updated.backfillRetries,
      computeJoules: Math.round(totalComputeJoules * 100) / 100,
      scored,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown backfill error";
    const refreshed = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { backfillRetries: true },
    });
    const retries = (refreshed?.backfillRetries ?? 0) + 1;

    const failedStatus: BackfillStatus = retries >= MAX_RETRIES ? "failed" : "queued";

    const updated = await updateStatus(agentId, failedStatus, {
      backfillRetries: retries,
      backfillFailed: { increment: photos.length },
      backfillLastError: message,
      backfillCompletedAt: failedStatus === "failed" ? new Date() : null,
    });

    return NextResponse.json({
      status: updated.backfillStatus,
      total: updated.backfillTotal,
      done: updated.backfillDone,
      failed: updated.backfillFailed,
      retries: updated.backfillRetries,
      error: updated.backfillLastError,
      scored,
      computeJoules: 0,
    });
  }
}
