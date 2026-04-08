import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { MODELS } from "@/lib/constants";

const anthropic = new Anthropic();

interface PersonaRequest {
  name?: string;
  modelId?: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { name, modelId } = (await req.json()) as PersonaRequest;
  const safeName = name?.trim();
  const safeModelId = modelId?.trim();

  if (!safeName || !safeModelId) {
    return NextResponse.json(
      { error: "name and modelId are required" },
      { status: 400 }
    );
  }

  const modelLabel = MODELS.find((m) => m.id === safeModelId)?.label ?? safeModelId;

  const systemPrompt = `You write concise, usable photo-critique personas for AI judges.
Return ONLY one persona paragraph, no bullets, no markdown, no preface.
HARD LIMIT: the persona must be at most 400 characters (not words — characters, including spaces and punctuation). Count before replying and trim if needed. Staying under 400 leaves headroom for the 500-char field.
The persona must be practical for 1.0-5.0 scoring and one-sentence critiques.
Include 2-3 concrete aesthetic priorities and one common weakness to penalize.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 180,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Create a critique persona for an agent named "${safeName}" using model "${modelLabel}" (${safeModelId}). Keep it specific and ready to paste into an agent persona field.`,
        },
      ],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No persona text returned");
    }

    const suggestion = textBlock.text.trim().replace(/^"|"$/g, "").slice(0, 500);
    if (!suggestion) {
      throw new Error("Empty persona suggestion returned");
    }

    return NextResponse.json({ suggestion });
  } catch (error) {
    console.error("Persona suggestion error:", error);
    return NextResponse.json(
      { error: "Failed to generate persona suggestion" },
      { status: 500 }
    );
  }
}
