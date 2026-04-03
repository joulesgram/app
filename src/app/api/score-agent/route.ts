import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { RATING_SCALE } from "@/lib/constants";

const anthropic = new Anthropic();

const JOULES_PER_INPUT_TOKEN = 0.003;
const JOULES_PER_OUTPUT_TOKEN = 0.015;

interface SingleAgentScore {
  score: number;
  critique: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { agentId } = (await req.json()) as { agentId: string };
  if (!agentId) {
    return NextResponse.json({ error: "agentId required" }, { status: 400 });
  }

  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }
  if (agent.creatorId !== session.user.id) {
    return NextResponse.json({ error: "Not your agent" }, { status: 403 });
  }

  // Find all scored photos this agent hasn't rated yet
  const photos = await prisma.photo.findMany({
    where: {
      aiScore: { not: null },
      agentRatings: { none: { agentId } },
    },
    select: { id: true, imageUrl: true },
  });

  if (photos.length === 0) {
    return NextResponse.json({ scored: 0 });
  }

  const systemPrompt = `You are an AI photo critic with this persona:
Name: "${agent.name}"
Persona: ${agent.persona || "A professional photography critic."}

Rate each photo on a scale of ${RATING_SCALE.min} to ${RATING_SCALE.max} (0.1 precision).

Respond ONLY with valid JSON: an array of objects, one per photo, in the same order as presented:
[
  { "score": <float 1.0-5.0>, "critique": "<2-3 sentences>" }
]`;

  let totalComputeJoules = 0;
  let scored = 0;

  // Process in batches of 5 to avoid oversized requests
  const batchSize = 5;
  for (let i = 0; i < photos.length; i += batchSize) {
    const batch = photos.slice(i, i + batchSize);

    const imageBlocks: Anthropic.ContentBlockParam[] = [];
    for (let j = 0; j < batch.length; j++) {
      const photo = batch[j];

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
      imageBlocks.push({
        type: "text",
        text: `Photo ${j + 1} of ${batch.length}`,
      });
    }

    imageBlocks.push({
      type: "text",
      text: `Score all ${batch.length} photos above from your persona's perspective.`,
    });

    try {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: imageBlocks }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") continue;

      let jsonStr = textBlock.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr
          .replace(/^```(?:json)?\n?/, "")
          .replace(/\n?```$/, "");
      }

      const parsed: SingleAgentScore[] = JSON.parse(jsonStr);

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;
      const batchJoules =
        inputTokens * JOULES_PER_INPUT_TOKEN +
        outputTokens * JOULES_PER_OUTPUT_TOKEN;
      totalComputeJoules += batchJoules;
      const perPhotoJoules = batchJoules / batch.length;

      for (let j = 0; j < batch.length && j < parsed.length; j++) {
        const score = Math.max(
          RATING_SCALE.min,
          Math.min(
            RATING_SCALE.max,
            Math.round(parsed[j].score * 10) / 10
          )
        );

        await prisma.agentRating.create({
          data: {
            photoId: batch[j].id,
            agentId,
            score,
            critique: parsed[j].critique,
            computeJoules: perPhotoJoules,
          },
        });

        // Recompute photo aiScore with new agent included
        const agg = await prisma.agentRating.aggregate({
          where: { photoId: batch[j].id },
          _avg: { score: true },
        });
        if (agg._avg.score !== null) {
          const newAiScore = Math.round(agg._avg.score * 10) / 10;
          const totalKJ = await prisma.agentRating.aggregate({
            where: { photoId: batch[j].id },
            _sum: { computeJoules: true },
          });
          await prisma.photo.update({
            where: { id: batch[j].id },
            data: {
              aiScore: newAiScore,
              computeKJ: (totalKJ._sum.computeJoules ?? 0) / 1000,
            },
          });
        }

        scored++;
      }
    } catch (e) {
      console.error("Batch scoring error:", e);
      // Continue with next batch
    }
  }

  return NextResponse.json({
    scored,
    computeJoules: Math.round(totalComputeJoules * 100) / 100,
  });
}
