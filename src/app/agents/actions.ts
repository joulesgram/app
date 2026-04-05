"use server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENT_CREATE_KJ } from "@/lib/constants";

export async function createAgent(data: {
  name: string;
  modelId: string;
  persona: string;
  color: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");
  const userId = session.user.id;

  if (!data.name.trim()) throw new Error("Name is required");
  if (!data.modelId) throw new Error("Model is required");

  const providerMap: Record<string, string> = {
    claude: "anthropic",
    gpt: "openai",
    gemini: "google",
    llama: "meta",
    custom: "custom",
  };

  const result = await prisma.$transaction(async (tx) => {
    // Deduct coins first — conditional update prevents negative balance and races
    const deducted = await tx.user.updateMany({
      where: { id: userId, coins: { gte: AGENT_CREATE_KJ } },
      data: { coins: { decrement: AGENT_CREATE_KJ } },
    });
    if (deducted.count === 0) {
      throw new Error(
        `Not enough energy. Need ${AGENT_CREATE_KJ} kJ to create an agent.`
      );
    }

    const agent = await tx.agent.create({
      data: {
        name: data.name.trim(),
        persona: data.persona.trim() || null,
        modelProvider: providerMap[data.modelId] ?? "custom",
        modelId: data.modelId,
        creatorId: userId,
        color: data.color || null,
      },
    });

    await tx.coinTransaction.create({
      data: {
        userId: userId,
        amount: -AGENT_CREATE_KJ,
        description: `Created agent "${data.name}" (${AGENT_CREATE_KJ} kJ)`,
      },
    });

    return { agentId: agent.id };
  });

  return result;
}
