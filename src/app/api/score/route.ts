import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  PUBLISH_THRESHOLD,
  RATING_SCALE,
  VALID_CATEGORIES,
  UPLOAD_REWARD_KJ,
  JOULES_PER_TOKEN,
} from "@/lib/constants";

const { Decimal } = Prisma;

const anthropic = new Anthropic();

const MODEL_ID = "claude-sonnet-4-20250514";

interface AgentScore {
  agentId: string;
  agentName: string;
  score: Prisma.Decimal;
  critique: string;
}

interface ScoreResponse {
  agent_scores: {
    agent_name: string;
    score: number;
    critique: string;
  }[];
  overall_critique: string;
  category: string;
  score?: number; // direct score when no agents exist
  nsfw: boolean;
}

function clampScore(raw: number): Prisma.Decimal {
  const clamped = Math.max(
    RATING_SCALE.min,
    Math.min(RATING_SCALE.max, Math.round(raw * 10) / 10)
  );
  return new Decimal(clamped);
}

export async function POST(req: NextRequest) {
  let photoId: string | undefined;
  let scoringClaimed = false;

  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not set");
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 500 });
    }

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    photoId = (body as { photoId: string }).photoId;

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

    // -----------------------------------------------------------------------
    // Atomic CAS: PENDING → SCORING (idempotency guard)
    // -----------------------------------------------------------------------
    const cas = await prisma.photo.updateMany({
      where: { id: photoId, scoreStatus: "PENDING" },
      data: { scoreStatus: "SCORING" },
    });
    if (cas.count === 0) {
      return NextResponse.json({ error: "Already scored or in progress" }, { status: 409 });
    }
    scoringClaimed = true;

    // Fetch all active agents
    const agents = await prisma.agent.findMany({
      where: { active: true },
      select: { id: true, name: true, persona: true },
    });

    // Build prompt — works with or without agents
    let systemPrompt: string;
    if (agents.length > 0) {
      const agentBlock = agents
        .map(
          (a: { id: string; name: string; persona: string | null }, i: number) =>
            `Agent ${i + 1}: "${a.name}"\nPersona: ${a.persona || "A professional photography critic."}`
        )
        .join("\n\n");

      systemPrompt = `You are a multi-agent photo scoring system. You will evaluate a photograph from the perspective of multiple AI agents, each with their own persona and aesthetic preferences.

Rate the photo on a scale of ${RATING_SCALE.min} to ${RATING_SCALE.max} (0.1 precision).

Also detect the photo category and determine if the photo contains NSFW content.

Respond ONLY with valid JSON matching this exact schema:
{
  "agent_scores": [
    { "agent_name": "<exact agent name>", "score": <float 1.0-5.0>, "critique": "<one sentence>" }
  ],
  "overall_critique": "<one sentence summary>",
  "category": "<one of: landscape, food, portrait, architecture, street, nature, abstract, night>",
  "nsfw": <boolean>
}

Here are the agents:

${agentBlock}`;
    } else {
      systemPrompt = `You are a professional photography critic and scoring system.

Rate the photo on a scale of ${RATING_SCALE.min} to ${RATING_SCALE.max} (0.1 precision).

Also detect the photo category and determine if the photo contains NSFW content.

Respond ONLY with valid JSON matching this exact schema:
{
  "agent_scores": [],
  "overall_critique": "<one sentence summary>",
  "category": "<one of: landscape, food, portrait, architecture, street, nature, abstract, night>",
  "score": <float 1.0-5.0>,
  "nsfw": <boolean>
}`;
    }

    // Build image content block
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

    console.log(`[Score] Calling Anthropic API for photo ${photoId}, agents: ${agents.length}, image type: ${photo.imageUrl.startsWith("data:") ? "base64" : "url"}`);

    // -----------------------------------------------------------------------
    // Anthropic API call — OUTSIDE the transaction
    // -----------------------------------------------------------------------
    const response = await anthropic.messages.create({
      model: MODEL_ID,
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            imageContent,
            { type: "text", text: "Score this photograph from each agent's perspective. Detect the category automatically." },
          ],
        },
      ],
      system: systemPrompt,
    });

    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    console.log(`[Score] Anthropic response received. Tokens: ${inputTokens} in, ${outputTokens} out`);

    // Extract text from response
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      // FAILED path — no usable response
      await prisma.photo.update({
        where: { id: photoId },
        data: { scoreStatus: "FAILED" },
      });
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

    let parsed: ScoreResponse;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse AI response:", jsonStr);
      await prisma.photo.update({
        where: { id: photoId },
        data: { scoreStatus: "FAILED" },
      });
      return NextResponse.json(
        { error: "Failed to parse AI response" },
        { status: 502 }
      );
    }

    console.log(`[Score] Parsed response: aiScore=${parsed.score ?? "N/A"}, category=${parsed.category}, agents=${parsed.agent_scores?.length ?? 0}, nsfw=${parsed.nsfw}`);

    // -----------------------------------------------------------------------
    // Compute energy cost: (inputTokens + outputTokens) * JOULES_PER_TOKEN
    // Result is in joules; divide by 1000 for kJ.
    // -----------------------------------------------------------------------
    const totalTokens = inputTokens + outputTokens;
    const computeJoules = new Decimal(totalTokens).mul(JOULES_PER_TOKEN);
    const computeKj = computeJoules.div(1000);

    // Match agent scores to DB agents
    const agentScores: AgentScore[] = [];
    if (parsed.agent_scores && parsed.agent_scores.length > 0) {
      for (const as_ of parsed.agent_scores) {
        const agent = agents.find(
          (a: { id: string; name: string; persona: string | null }) =>
            a.name.toLowerCase() === as_.agent_name.toLowerCase()
        );
        if (!agent) continue;

        agentScores.push({
          agentId: agent.id,
          agentName: agent.name,
          score: clampScore(as_.score),
          critique: as_.critique,
        });
      }
    }

    // Average AI score across agents, or use direct score if no agents
    let aiScore: Prisma.Decimal | null;
    if (agentScores.length > 0) {
      const sum = agentScores.reduce(
        (s: Prisma.Decimal, a: AgentScore) => s.add(a.score),
        new Decimal(0)
      );
      const raw = sum.div(agentScores.length).toNumber();
      aiScore = new Decimal(Math.round(raw * 10) / 10);
    } else if (parsed.score != null) {
      aiScore = clampScore(parsed.score);
    } else {
      aiScore = null;
    }

    // Validate and store category
    const detectedCategory = VALID_CATEGORIES.includes(
      parsed.category?.toLowerCase() as typeof VALID_CATEGORIES[number]
    )
      ? parsed.category.toLowerCase()
      : null;

    // Determine publish eligibility
    const published = aiScore !== null && aiScore.gte(PUBLISH_THRESHOLD);

    // Per-agent compute share
    const perAgentJoules =
      agentScores.length > 0
        ? computeJoules.div(agentScores.length)
        : new Decimal(0);

    const uploadReward = new Decimal(UPLOAD_REWARD_KJ);
    const ratingWindowClosesAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const publicFeedEligible = aiScore !== null && aiScore.gte(PUBLISH_THRESHOLD);
    const userId = session.user.id;

    // -----------------------------------------------------------------------
    // Single transaction: all DB writes
    // -----------------------------------------------------------------------
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Create ComputeReceipt
        const receipt = await tx.computeReceipt.create({
          data: {
            modelProvider: "anthropic",
            modelId: MODEL_ID,
            inputTokens,
            outputTokens,
            computeKj,
          },
        });

        // 2. Create AgentRatings linked to receipt
        for (const as_ of agentScores) {
          await tx.agentRating.create({
            data: {
              photoId: photoId!,
              agentId: as_.agentId,
              score: as_.score,
              critique: as_.critique,
              computeJoules: perAgentJoules,
              computeReceiptId: receipt.id,
            },
          });
        }

        // 3. Update photo → SCORED
        await tx.photo.update({
          where: { id: photoId },
          data: {
            aiScore,
            critique: parsed.overall_critique,
            computeKj,
            scoreStatus: "SCORED",
            nsfw: parsed.nsfw,
            category: detectedCategory,
            ratingWindowClosesAt,
            publicFeedEligible,
          },
        });

        // 4. Deduct dynamic compute cost from user
        const afterDeduct = await tx.user.update({
          where: { id: userId },
          data: { joulesBalance: { decrement: computeKj } },
        });

        await tx.ledgerEntry.create({
          data: {
            userId,
            entryType: "COMPUTE_FEE",
            amount: computeKj.neg(),
            balanceAfter: afterDeduct.joulesBalance,
            referenceType: "photo",
            referenceId: photoId!,
            description: `Photo AI scoring (${computeKj.toFixed(4)} kJ, ${totalTokens} tokens)`,
          },
        });

        // 5. Credit upload reward
        const afterReward = await tx.user.update({
          where: { id: userId },
          data: {
            joulesBalance: { increment: uploadReward },
            cumulativeJoulesEarned: { increment: uploadReward },
          },
        });

        await tx.ledgerEntry.create({
          data: {
            userId,
            entryType: "UPLOAD_REWARD",
            amount: uploadReward,
            balanceAfter: afterReward.joulesBalance,
            referenceType: "photo",
            referenceId: photoId!,
            description: `Upload reward (${UPLOAD_REWARD_KJ} kJ)`,
          },
        });
      });
    } catch (txErr) {
      // -----------------------------------------------------------------------
      // FAILED path: transaction rolled back — mark photo as FAILED
      // -----------------------------------------------------------------------
      console.error("Score transaction failed:", txErr);
      await prisma.photo.update({
        where: { id: photoId },
        data: { scoreStatus: "FAILED" },
      });
      return NextResponse.json({ error: "Scoring failed" }, { status: 500 });
    }

    console.log(`[Score] Saved photo ${photoId}: aiScore=${aiScore}, category=${detectedCategory}, agentRatings=${agentScores.length}`);

    return NextResponse.json({
      photoId,
      aiScore: aiScore?.toNumber() ?? null,
      critique: parsed.overall_critique,
      nsfw: parsed.nsfw,
      published,
      agentScores: agentScores.map((a: AgentScore) => ({
        agentName: a.agentName,
        score: a.score.toNumber(),
        critique: a.critique,
      })),
      computeKj: computeKj.toNumber(),
      computeJoules: computeJoules.toNumber(),
      tokens: { input: inputTokens, output: outputTokens },
    });
  } catch (e) {
    console.error("Score API error:", e);

    // If we claimed SCORING but failed before the transaction, reset to FAILED
    if (photoId && scoringClaimed) {
      try {
        await prisma.photo.update({
          where: { id: photoId },
          data: { scoreStatus: "FAILED" },
        });
      } catch {
        console.error("Failed to mark photo as FAILED during error recovery");
      }
    }

    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
