"use server";

import { Decimal } from "decimal.js";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AGENT_CREATE_KJ } from "@/lib/constants";
import { TREASURY_USER_ID } from "@/lib/integrity";

const agentCostJ = new Decimal(AGENT_CREATE_KJ).times(1000);

export async function createAgent(data: {
  name: string;
  modelId: string;
  persona: string;
  color: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Not authenticated");

  if (!data.name.trim()) throw new Error("Name is required");
  if (!data.modelId) throw new Error("Model is required");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { joulesBalance: true },
  });
  if (!user || new Decimal(user.joulesBalance.toString()).lt(agentCostJ)) {
    const balanceKj = user
      ? new Decimal(user.joulesBalance.toString()).div(1000).toNumber()
      : 0;
    throw new Error(
      `Not enough energy. Need ${AGENT_CREATE_KJ} kJ, have ${balanceKj} kJ`
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

  const agent = await prisma.$transaction(async (tx) => {
    const userId = session.user.id!;
    const created = await tx.agent.create({
      data: {
        name: data.name.trim(),
        persona: data.persona.trim() || null,
        modelProvider: providerMap[data.modelId] ?? "custom",
        modelId: data.modelId,
        creatorId: userId,
        color: data.color || null,
      },
    });

    // Atomic CAS for balance deduction
    const updated = await tx.user.updateMany({
      where: { id: userId, joulesBalance: { gte: agentCostJ } },
      data: { joulesBalance: { decrement: agentCostJ } },
    });
    if (updated.count === 0) throw new Error("Insufficient balance");

    const updatedUser = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { joulesBalance: true },
    });

    await tx.ledgerEntry.create({
      data: {
        userId,
        entryType: "AGENT_REGISTRATION_FEE",
        amount: agentCostJ.negated(),
        balanceAfter: updatedUser.joulesBalance,
        referenceType: "agent",
        referenceId: created.id,
      },
    });
    // Treasury counterparty for agent registration fee (paired credit, Rule 3)
    await tx.user.update({
      where: { id: TREASURY_USER_ID },
      data: { joulesBalance: { increment: agentCostJ } },
    });
    const treasuryAfterAgent = await tx.user.findUniqueOrThrow({
      where: { id: TREASURY_USER_ID },
      select: { joulesBalance: true },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: TREASURY_USER_ID,
        entryType: "AGENT_REGISTRATION_FEE",
        amount: agentCostJ,
        balanceAfter: treasuryAfterAgent.joulesBalance,
        referenceType: "agent",
        referenceId: created.id,
      },
    });
    return created;
  });

  return { agentId: agent.id };
}
