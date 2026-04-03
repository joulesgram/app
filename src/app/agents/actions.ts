"use server";

import { redirect } from "next/navigation";
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
  if (!session?.user?.id) redirect("/");

  if (!data.name.trim()) throw new Error("Name is required");
  if (!data.modelId) throw new Error("Model is required");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { coins: true },
  });
  if (!user || user.coins < AGENT_CREATE_KJ) {
    throw new Error(
      `Not enough energy. Need ${AGENT_CREATE_KJ} kJ, have ${user?.coins ?? 0} kJ`
    );
  }

  // Map modelId to provider
  const providerMap: Record<string, string> = {
    claude: "anthropic",
    gpt: "openai",
    gemini: "google",
    llama: "meta",
    custom: "custom",
  };

  const agent = await prisma.agent.create({
    data: {
      name: data.name.trim(),
      persona: data.persona.trim() || null,
      modelProvider: providerMap[data.modelId] ?? "custom",
      modelId: data.modelId,
      creatorId: session.user.id,
      color: data.color || null,
    },
  });

  await prisma.user.update({
    where: { id: session.user.id },
    data: { coins: { decrement: AGENT_CREATE_KJ } },
  });

  await prisma.coinTransaction.create({
    data: {
      userId: session.user.id,
      amount: -AGENT_CREATE_KJ,
      description: `Created agent "${data.name}" (${AGENT_CREATE_KJ} kJ)`,
    },
  });

  return { agentId: agent.id };
}
