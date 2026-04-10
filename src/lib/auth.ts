import { createHash } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import { cookies } from "next/headers";
import { Decimal } from "decimal.js";
import { prisma } from "@/lib/prisma";
import { getSignupReward, chainReward } from "@/lib/joules";
import { REFERRAL_BASE_KJ } from "@/lib/constants";
import { TREASURY_USER_ID } from "@/lib/integrity";
import { grantDailyLoginBonus, isPreScaleModeEnabled } from "@/lib/pre-scale";
import type { User as PrismaUser } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      username: string;
      userNumber: number;
      joulesBalance: number; // number for session serialization; source of truth is Decimal in DB
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      checks: ["none"]
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      if (!user.email) return false;
      const userEmail = user.email;

      try {
        const existing = await prisma.user.findUnique({
          where: { email: userEmail },
        });

        if (!existing) {
          const username =
            (profile as { login?: string })?.login ??
            user.email.split("@")[0];

          const userCount = await prisma.user.count();
          const userNumber = userCount + 1;
          const referralCode = `${username}${userNumber}`;
          const reward = getSignupReward(userNumber);

          // Read referral cookie set by middleware from ?ref= query param
          const cookieStore = await cookies();
          const rawReferredBy = cookieStore.get("referral_code")?.value ?? null;

          let inviter: PrismaUser | null = null;
          if (rawReferredBy) {
            inviter = await prisma.user.findUnique({
              where: { referralCode: rawReferredBy },
            });

            if (!inviter) {
              logInvalidReferralAttempt(rawReferredBy, "inviter_not_found", user.email);
            } else if (inviter.email === user.email) {
              logInvalidReferralAttempt(rawReferredBy, "self_referral_email", user.email);
              inviter = null;
            }
          }

          const referredBy = inviter?.referralCode ?? null;

          // Reward is in kJ from getSignupReward; convert to joules for storage
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

            // Debit treasury, credit new user
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

          // Walk the referral ancestor chain
          if (inviter && inviter.id !== newUser.id) {
            await processReferralChain(inviter.referralCode, newUser.id);
          } else if (inviter && inviter.id === newUser.id) {
            logInvalidReferralAttempt(inviter.referralCode, "self_referral_id", newUser.email);
          }
        }
      } catch (e) {
        console.error("Auth signIn DB error:", e);
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user?.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
          });
          if (dbUser) {
            token.userId = dbUser.id;
            token.username = dbUser.username;
            token.userNumber = dbUser.userNumber;
            token.joulesBalance = new Decimal(dbUser.joulesBalance.toString()).toNumber();
          }
        } catch (e) {
          console.error("Auth jwt DB error:", e);
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
        session.user.username = token.username as string;
        session.user.userNumber = token.userNumber as number;

        // Grant daily login bonus if Pre-Scale Mode is active
        try {
          const preScaleActive = await isPreScaleModeEnabled(prisma);
          if (preScaleActive) {
            await grantDailyLoginBonus(prisma, token.userId as string);
          }
        } catch (e) {
          console.error("Daily login bonus error:", e);
        }

        // Always fetch fresh balance from DB (not the stale JWT value)
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
  session: { strategy: "jwt" },
});

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
    `[auth.referral.invalid] reason=${reason} code=${truncatedCode} hash=${codeHash}${email ? ` email=${email}` : ""}`
  );
}

async function processReferralChain(
  referralCode: string,
  newUserId: string
) {
  let currentCode: string | null = referralCode;
  let level = 1;

  while (currentCode) {
    const ancestor: PrismaUser | null = await prisma.user.findUnique({
      where: { referralCode: currentCode },
    });

    if (!ancestor || ancestor.id === newUserId) break;

    if (ancestor.active) {
      const rewardKj = REFERRAL_BASE_KJ * chainReward(level);
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
