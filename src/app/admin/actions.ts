"use server";

import { Decimal } from "decimal.js";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TREASURY_USER_ID } from "@/lib/integrity";
import { runAllIntegrityChecks } from "@/lib/integrity";

export type ActionResult = {
  success: boolean;
  error?: string;
  message?: string;
};

type AdminOperation = "credit_debit" | "reset_counter" | "set_referredby";

const ALLOWED_ENTRY_TYPES = ["OPENING_BALANCE", "FAUCET_GRANT"] as const;
const MAX_AMOUNT_J = 1_000_000;

// ─── Gate helper ───────────────────────────────────────────────────
async function requireFounder(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.userNumber !== 1) {
    throw new Error("Not authorized");
  }
  return session.user.id;
}

// ─── Operation 1: Credit / Debit User ──────────────────────────────
export async function creditDebitUser(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const operatorId = await requireFounder();

  const userId = formData.get("userId")?.toString() ?? "";
  const amountStr = formData.get("amountJ")?.toString() ?? "";
  const entryType = formData.get("entryType")?.toString() ?? "";
  const referenceType = formData.get("referenceType")?.toString() ?? "";
  const referenceId = formData.get("referenceId")?.toString() || null;
  const description = formData.get("description")?.toString() ?? "";

  const payload = {
    userId,
    amountJ: amountStr,
    entryType,
    referenceType,
    referenceId,
    description,
  };

  const operation: AdminOperation = "credit_debit";

  // Create pending audit log entry
  const adminAction = await prisma.adminAction.create({
    data: {
      operatorId,
      operation,
      targetUserId: userId || null,
      payload,
      result: "pending",
    },
  });

  try {
    // ── Validation ──
    if (!userId || !amountStr || !entryType || !referenceType || !description) {
      throw new Error("All fields are required");
    }

    const amountJ = parseInt(amountStr, 10);
    if (isNaN(amountJ) || amountJ === 0) {
      throw new Error("Amount must be a non-zero integer");
    }
    if (Math.abs(amountJ) > MAX_AMOUNT_J) {
      throw new Error(
        "Amount exceeds 1 MJ safety cap. For larger operations, use a SQL transaction directly and document the reasoning."
      );
    }

    if (
      !ALLOWED_ENTRY_TYPES.includes(
        entryType as (typeof ALLOWED_ENTRY_TYPES)[number]
      )
    ) {
      throw new Error(
        `Entry type must be one of: ${ALLOWED_ENTRY_TYPES.join(", ")}`
      );
    }

    if (description.length < 20) {
      throw new Error("Description must be at least 20 characters");
    }

    if (userId === TREASURY_USER_ID) {
      throw new Error("Cannot credit/debit the treasury user directly");
    }

    const userCount = await prisma.user.count({ where: { id: userId } });
    if (userCount === 0) {
      throw new Error("User not found");
    }

    // ── Paired write inside transaction ──
    const amount = new Decimal(amountJ);

    await prisma.$transaction(async (tx) => {
      // 1. Update user balance
      await tx.user.update({
        where: { id: userId },
        data: { joulesBalance: { increment: amount } },
      });

      // 2. Read back user balanceAfter
      const userAfter = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { joulesBalance: true },
      });

      // 3. User-side ledger entry
      await tx.ledgerEntry.create({
        data: {
          userId,
          entryType: entryType as "OPENING_BALANCE" | "FAUCET_GRANT",
          amount,
          balanceAfter: userAfter.joulesBalance,
          referenceType,
          referenceId,
          description,
        },
      });

      // 4. Treasury counterparty balance update (opposite sign)
      await tx.user.update({
        where: { id: TREASURY_USER_ID },
        data: { joulesBalance: { decrement: amount } },
      });

      // 5. Read back treasury balanceAfter
      const treasuryAfter = await tx.user.findUniqueOrThrow({
        where: { id: TREASURY_USER_ID },
        select: { joulesBalance: true },
      });

      // 6. Treasury-side ledger entry
      await tx.ledgerEntry.create({
        data: {
          userId: TREASURY_USER_ID,
          entryType: entryType as "OPENING_BALANCE" | "FAUCET_GRANT",
          amount: amount.negated(),
          balanceAfter: treasuryAfter.joulesBalance,
          referenceType,
          referenceId,
          description: `Treasury counterparty for ${description}`,
        },
      });
    });

    // ── Post-commit integrity checks (all 5 rules) ──
    const results = await runAllIntegrityChecks(prisma);
    const failures = results.filter((r) => !r.passed);
    if (failures.length > 0) {
      const msg = failures.map((f) => `${f.rule}: ${f.details}`).join("; ");
      console.error(
        `[ADMIN] INTEGRITY FAILURE after credit_debit on user ${userId}: ${msg}`
      );
      await prisma.adminAction.update({
        where: { id: adminAction.id },
        data: {
          result: "integrity_failed",
          errorMessage: `INTEGRITY WARNING: ${msg}`,
        },
      });
      revalidatePath("/admin");
      revalidatePath("/admin/users/[id]");
      return {
        success: false,
        error: `Operation committed but integrity checks failed: ${msg}. Audit log marked integrity_failed.`,
      };
    }

    // ── Success ──
    await prisma.adminAction.update({
      where: { id: adminAction.id },
      data: { result: "success" },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/users/[id]");
    return {
      success: true,
      message: `${amountJ > 0 ? "Credited" : "Debited"} ${Math.abs(amountJ)} J (${entryType})`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.adminAction.update({
      where: { id: adminAction.id },
      data: { result: "failed", errorMessage },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/users/[id]");
    return { success: false, error: errorMessage };
  }
}

// ─── Operation 2: Reset ratingsSinceLastPost ───────────────────────
export async function resetRatingsSinceLastPost(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const operatorId = await requireFounder();

  const userId = formData.get("userId")?.toString() ?? "";

  const operation: AdminOperation = "reset_counter";

  const adminAction = await prisma.adminAction.create({
    data: {
      operatorId,
      operation,
      targetUserId: userId || null,
      payload: { userId },
      result: "pending",
    },
  });

  try {
    if (!userId) throw new Error("userId is required");

    const userCount = await prisma.user.count({ where: { id: userId } });
    if (userCount === 0) throw new Error("User not found");

    await prisma.user.update({
      where: { id: userId },
      data: { ratingsSinceLastPost: 0 },
    });

    await prisma.adminAction.update({
      where: { id: adminAction.id },
      data: { result: "success" },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/users/[id]");
    return { success: true, message: "Counter reset to 0" };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.adminAction.update({
      where: { id: adminAction.id },
      data: { result: "failed", errorMessage },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/users/[id]");
    return { success: false, error: errorMessage };
  }
}

// ─── Operation 3: Set referredBy ───────────────────────────────────
export async function setReferredBy(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const operatorId = await requireFounder();

  const userId = formData.get("userId")?.toString() ?? "";
  const inviterReferralCode =
    formData.get("inviterReferralCode")?.toString() ?? "";

  const operation: AdminOperation = "set_referredby";

  const adminAction = await prisma.adminAction.create({
    data: {
      operatorId,
      operation,
      targetUserId: userId || null,
      payload: { userId, inviterReferralCode },
      result: "pending",
    },
  });

  try {
    if (!userId || !inviterReferralCode) {
      throw new Error("userId and inviterReferralCode are required");
    }

    if (userId === TREASURY_USER_ID) {
      throw new Error("Cannot modify treasury user");
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { referredBy: true },
    });
    if (!targetUser) throw new Error("User not found");

    if (targetUser.referredBy !== null) {
      throw new Error(
        "User already has a referredBy set. Overwriting existing relationships is not allowed from the admin panel."
      );
    }

    const inviter = await prisma.user.findUnique({
      where: { referralCode: inviterReferralCode },
      select: { id: true, username: true },
    });
    if (!inviter) {
      throw new Error(
        `No user found with referralCode "${inviterReferralCode}"`
      );
    }

    if (inviter.id === userId) {
      throw new Error("Cannot set a user as their own inviter");
    }

    await prisma.user.update({
      where: { id: userId },
      data: { referredBy: inviterReferralCode },
    });

    await prisma.adminAction.update({
      where: { id: adminAction.id },
      data: { result: "success" },
    });

    revalidatePath("/admin");
    revalidatePath("/admin/users/[id]");
    return {
      success: true,
      message: `Set referredBy to ${inviterReferralCode} (@${inviter.username})`,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await prisma.adminAction.update({
      where: { id: adminAction.id },
      data: { result: "failed", errorMessage },
    });
    revalidatePath("/admin");
    revalidatePath("/admin/users/[id]");
    return { success: false, error: errorMessage };
  }
}
