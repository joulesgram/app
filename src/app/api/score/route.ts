import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  PHOTO_SCORE_KJ,
  PUBLISH_THRESHOLD,
  RATING_SCALE,
} from "@/lib/constants";

const anthropic = new Anthropic();

// Joules per input/output token for Claude Sonnet (approximate energy cost)
const JOULES_PER_INPUT_TOKEN = 0.003;
const JOULES_PER_OUTPUT_TOKEN = 0.015;

interface AgentScore {
  agentId: string;
  agentName: string;
  score: number;
  critique: string;
}

interface ScoreResponse {
  agent_scores: {
    agent_name: string;
    score: number;
    critique: string;
  }[];
  overall_critique: string;
  nsfw: boolean;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { photoId } = body as { photoId: string };

  if (!photoId) {
    return NextResponse.json({ error: "photoId required" }, { status: 400 });
  }

  // Fetch photo
  const photo = await prisma.photo.findUnique({ where: { id: photoId } });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }
  if (photo.userId !== session.user.id) {
    return NextResponse.json({ error: "Not your photo" }, { status: 403 });
  }
  if (photo.aiScore !== null) {
    return NextResponse.json({ error: "Already scored" }, { status: 409 });
  }

  // Fetch all active agents
  const agents = await prisma.agent.findMany({
    where: { creator: { active: true } },
    select: { id: true, name: true, persona: true },
  });

  if (agents.length === 0) {
    return NextResponse.json(
      { error: "No agents available for scoring" },
      { status: 503 }
    );
  }

  // Build agent personas block for the prompt
  const agentBlock = agents
    .map(
      (a, i) =>
        `Agent ${i + 1}: "${a.name}"\nPersona: ${a.persona || "A professional photography critic."}`
    )
    .join("\n\n");

  const systemPrompt = `You are a multi-agent photo scoring system. You will evaluate a photograph from the perspective of multiple AI agents, each with their own persona and aesthetic preferences.

Rate the photo on a scale of ${RATING_SCALE.min} to ${RATING_SCALE.max} (0.1 precision).

Also determine if the photo contains NSFW content.

Respond ONLY with valid JSON matching this exact schema:
{
  "agent_scores": [
    { "agent_name": "<exact agent name>", "score": <float 1.0-5.0>, "critique": "<2-3 sentences>" }
  ],
  "overall_critique": "<1-2 sentence summary>",
  "nsfw": <boolean>
}

Here are the agents:

${agentBlock}`;

  try {
    // Read image as base64 — imageUrl is a data URL or a remote URL
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

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            imageContent,
            { type: "text", text: "Score this photograph from each agent's perspective." },
          ],
        },
      ],
      system: systemPrompt,
    });

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return NextResponse.json(
        { error: "No text response from AI" },
        { status: 502 }
      );
    }

    // Parse JSON — strip markdown fences if present
    let jsonStr = textBlock.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed: ScoreResponse = JSON.parse(jsonStr);

    // Compute energy cost in joules
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const computeJoules =
      inputTokens * JOULES_PER_INPUT_TOKEN +
      outputTokens * JOULES_PER_OUTPUT_TOKEN;
    const computeKJ = computeJoules / 1000;

    // Match agent scores to DB agents and save
    const agentScores: AgentScore[] = [];
    for (const as_ of parsed.agent_scores) {
      const agent = agents.find(
        (a) => a.name.toLowerCase() === as_.agent_name.toLowerCase()
      );
      if (!agent) continue;

      const score = Math.max(
        RATING_SCALE.min,
        Math.min(RATING_SCALE.max, Math.round(as_.score * 10) / 10)
      );

      agentScores.push({
        agentId: agent.id,
        agentName: agent.name,
        score,
        critique: as_.critique,
      });
    }

    // Average AI score across agents
    const aiScore =
      agentScores.length > 0
        ? Math.round(
            (agentScores.reduce((sum, a) => sum + a.score, 0) /
              agentScores.length) *
              10
          ) / 10
        : null;

    // Per-agent compute share
    const perAgentJoules =
      agentScores.length > 0 ? computeJoules / agentScores.length : 0;

    // Save agent ratings
    for (const as_ of agentScores) {
      await prisma.agentRating.create({
        data: {
          photoId,
          agentId: as_.agentId,
          score: as_.score,
          critique: as_.critique,
          computeJoules: perAgentJoules,
        },
      });
    }

    // Determine if published (meets threshold)
    const published = aiScore !== null && aiScore >= PUBLISH_THRESHOLD;

    // Update photo with AI score, critique, compute cost, NSFW flag
    await prisma.photo.update({
      where: { id: photoId },
      data: {
        aiScore,
        critique: parsed.overall_critique,
        computeKJ,
        nsfw: parsed.nsfw,
      },
    });

    // Deduct scoring cost from user
    await prisma.user.update({
      where: { id: session.user.id },
      data: { coins: { decrement: PHOTO_SCORE_KJ } },
    });

    await prisma.coinTransaction.create({
      data: {
        userId: session.user.id,
        amount: -PHOTO_SCORE_KJ,
        description: `Photo AI scoring (${PHOTO_SCORE_KJ} kJ)`,
      },
    });

    // Credit 5 kJ for uploading
    const uploadReward = 5;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { coins: { increment: uploadReward } },
    });

    await prisma.coinTransaction.create({
      data: {
        userId: session.user.id,
        amount: uploadReward,
        description: "Upload reward (5 kJ)",
      },
    });

    return NextResponse.json({
      photoId,
      aiScore,
      critique: parsed.overall_critique,
      nsfw: parsed.nsfw,
      published,
      agentScores: agentScores.map((a) => ({
        agentName: a.agentName,
        score: a.score,
        critique: a.critique,
      })),
      computeKJ: Math.round(computeKJ * 1000) / 1000,
      computeJoules: Math.round(computeJoules * 100) / 100,
      tokens: { input: inputTokens, output: outputTokens },
    });
  } catch (e) {
    console.error("Score API error:", e);
    const message = e instanceof Error ? e.message : "Scoring failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
