import { createHash } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSignupReward, chainReward } from "@/lib/joules";
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
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      if (!user.email) return false;

      try {
        const existing = await prisma.user.findUnique({
          where: { email: user.email },
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

          const newUser = await prisma.user.create({
            data: {
              email: user.email,
              username,
              userNumber,
              referralCode,
              referredBy,
              joulesBalance: reward,
              cumulativeJoulesEarned: reward,
            },
          });

          await prisma.ledgerEntry.create({
            data: {
              userId: newUser.id,
              entryType: "GENESIS_BONUS",
              amount: reward,
              balanceAfter: reward,
              referenceType: "signup",
              referenceId: newUser.id,
              description: `Signup reward (${reward} kJ)`,
            },
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
            token.joulesBalance = Number(dbUser.joulesBalance);
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

        // Always fetch fresh balance from DB (not the stale JWT value)
        try {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.userId as string },
            select: { joulesBalance: true },
          });
          session.user.joulesBalance = freshUser ? Number(freshUser.joulesBalance) : (token.joulesBalance as number);
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
      const reward = chainReward(level);
      if (reward <= 0) break;

      const updated = await prisma.user.update({
        where: { id: ancestor.id },
        data: {
          joulesBalance: { increment: reward },
          cumulativeJoulesEarned: { increment: reward },
        },
      });

      await prisma.ledgerEntry.create({
        data: {
          userId: ancestor.id,
          entryType: "REFERRAL_BONUS",
          amount: reward,
          balanceAfter: Number(updated.joulesBalance),
          referenceType: "referral_chain",
          referenceId: newUserId,
          description: `Referral chain reward (level ${level}, ${reward} kJ)`,
        },
      });
    }

    currentCode = ancestor.referredBy;
    level++;
  }
}
