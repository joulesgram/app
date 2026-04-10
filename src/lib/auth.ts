import { createHash } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { cookies } from "next/headers";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import { getSignupReward, chainReward } from "@/lib/joules";
import { TREASURY_USER_ID } from "@/lib/integrity";
import { grantDailyLoginBonus, isPreScaleModeEnabled } from "@/lib/pre-scale";
import type { User as PrismaUser } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      username: string;
      userNumber: number;
      joulesBalance: number;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.AUTH_EMAIL_FROM ?? "onboarding@resend.dev",
    }),
  ],
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin/check-email",
  },
  // JWT sessions even with an adapter — matches your existing flow.
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only present on first sign-in after magic link click.
      // Bootstrap the Joulegram profile here (genesis bonus, referral chain).
      if (user?.email) {
        try {
          await bootstrapJoulegramProfile(user.email);

          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
          });
          if (dbUser) {
            token.userId = dbUser.id;
            token.username = dbUser.username;
            token.userNumber = dbUser.userNumber;
            token.joulesBalance = new Decimal(
              dbUser.joulesBalance.toString()
            ).toNumber();
          }
        } catch (e) {
          console.error("Auth jwt bootstrap error:", e);
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
        session.user.username = token.username as string;
        session.user.userNumber = token.userNumber as number;

        try {
          const preScaleActive = await isPreScaleModeEnabled(prisma);
          if (preScaleActive) {
            await grantDailyLoginBonus(prisma, token.userId as string);
          }
        } catch (e) {
          console.error("Daily login bonus error:", e);
        }

        try {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.userId as string },
            select: { joulesBalance: true },
          });
          session.user.joulesBalance = freshUser
            ? new Decimal(freshUser.joulesBalance.toString()).toNumber()
            : (token.joulesBalance as number);
        } catch {
          session.user.joulesBalance = token.joulesBalance as number;
        }
      }
      return session;
    },
  },
});

// ─── Joulegram profile bootstrap ───────────────────────────────────────────
// Creates the Joulegram-specific User row (username, userNumber, genesis
// bonus, referral chain) the first time an email address signs in. No-op
// if the user already exists. Called from the jwt callback.
async function bootstrapJoulegramProfile(userEmail: string) {
  const existing = await prisma.user.findUnique({
    where: { email: userEmail },
  });
  if (existing) return;

  const username = userEmail.split("@")[0];
  const userCount = await prisma.user.count();
  const userNumber = userCount + 1;
  const referralCode = `${username}${userNumber}`;
  const reward = getSignupReward(userNumber);

  const cookieStore = await cookies();
  const rawReferredBy = cookieStore.get("referral_code")?.value ?? null;

  let inviter: PrismaUser | null = null;
  if (rawReferredBy) {
    inviter = await prisma.user.findUnique({
      where: { referralCode: rawReferredBy },
    });

    if (!inviter) {
      logInvalidReferralAttempt(rawReferredBy, "inviter_not_found", userEmail);
    } else if (inviter.email === userEmail) {
      logInvalidReferralAttempt(rawReferredBy, "self_referral_email", userEmail);
      inviter = null;
    }
  }

  const referredBy = inviter?.referralCode ?? null;
  const rewardJ = new Decimal(reward).times(1000);

  const newUser = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: userEmail,
        username,
        userNumber,
        referralCode,
        referredBy,
        joulesBalance: rewardJ,
      },
    });

    await tx.user.update({
      where: { id: TREASURY_USER_ID },
      data: { joulesBalance: { decrement: rewardJ } },
    });

    const treasury = await tx.user.findUniqueOrThrow({
      where: { id: TREASURY_USER_ID },
      select: { joulesBalance: true },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: TREASURY_USER_ID,
        entryType: "GENESIS_BONUS",
        amount: rewardJ.negated(),
        balanceAfter: treasury.joulesBalance,
        referenceType: "user",
        referenceId: created.id,
        description: `Genesis bonus outflow for user #${userNumber}`,
      },
    });

    await tx.ledgerEntry.create({
      data: {
        userId: created.id,
        entryType: "GENESIS_BONUS",
        amount: rewardJ,
        balanceAfter: created.joulesBalance,
        referenceType: "user",
        referenceId: created.id,
        description: `Signup reward (${reward} kJ)`,
      },
    });

    return created;
  });

  if (inviter && inviter.id !== newUser.id) {
    await processReferralChain(inviter.referralCode, newUser.id);
  } else if (inviter && inviter.id === newUser.id) {
    logInvalidReferralAttempt(
      inviter.referralCode,
      "self_referral_id",
      newUser.email
    );
  }
}

function logInvalidReferralAttempt(
  rawReferralCode: string,
  reason: "inviter_not_found" | "self_referral_email" | "self_referral_id",
  email?: string | null
) {
  const truncatedCode =
    rawReferralCode.length > 12
      ? `${rawReferralCode.slice(0, 4)}...${rawReferralCode.slice(-4)}`
      : rawReferralCode;
  const codeHash = createHash("sha256")
    .update(rawReferralCode)
    .digest("hex")
    .slice(0, 12);

  console.warn(
    `[auth.referral.invalid] reason=${reason} code=${truncatedCode} hash=${codeHash}${
      email ? ` email=${email}` : ""
    }`
  );
}

async function processReferralChain(referralCode: string, newUserId: string) {
  let currentCode: string | null = referralCode;
  let level = 1;

  while (currentCode) {
    const ancestor: PrismaUser | null = await prisma.user.findUnique({
      where: { referralCode: currentCode },
    });

    if (!ancestor || ancestor.id === newUserId) break;

    if (ancestor.active) {
      const rewardKj = chainReward(level);
      if (rewardKj <= 0) break;
      const rewardJ = new Decimal(rewardKj).times(1000);

      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: ancestor!.id },
          data: { joulesBalance: { increment: rewardJ } },
        });
        const updatedAncestor = await tx.user.findUniqueOrThrow({
          where: { id: ancestor!.id },
          select: { joulesBalance: true },
        });

        await tx.user.update({
          where: { id: TREASURY_USER_ID },
          data: { joulesBalance: { decrement: rewardJ } },
        });
        const updatedTreasury = await tx.user.findUniqueOrThrow({
          where: { id: TREASURY_USER_ID },
          select: { joulesBalance: true },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: TREASURY_USER_ID,
            entryType: "REFERRAL_BONUS",
            amount: rewardJ.negated(),
            balanceAfter: updatedTreasury.joulesBalance,
            referenceType: "user",
            referenceId: newUserId,
            description: `Referral outflow (level ${level})`,
          },
        });

        await tx.ledgerEntry.create({
          data: {
            userId: ancestor!.id,
            entryType: "REFERRAL_BONUS",
            amount: rewardJ,
            balanceAfter: updatedAncestor.joulesBalance,
            referenceType: "user",
            referenceId: newUserId,
            description: `Referral chain reward (level ${level}, ${rewardKj} kJ)`,
          },
        });
      });
    }

    currentCode = ancestor.referredBy;
    level++;
  }
}
