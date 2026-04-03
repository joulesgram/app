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
      coins: number;
    } & DefaultSession["user"];
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, profile }) {
      if (!user.email) return false;

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
        const referredBy = cookieStore.get("referral_code")?.value ?? null;

        const newUser = await prisma.user.create({
          data: {
            email: user.email,
            username,
            userNumber,
            referralCode,
            referredBy,
            coins: reward,
          },
        });

        await prisma.coinTransaction.create({
          data: {
            userId: newUser.id,
            amount: reward,
            description: `Signup reward (${reward} kJ)`,
          },
        });

        // Walk the referral ancestor chain
        if (referredBy) {
          await processReferralChain(referredBy, newUser.id);
        }
      }

      return true;
    },

    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email },
        });
        if (dbUser) {
          token.userId = dbUser.id;
          token.username = dbUser.username;
          token.userNumber = dbUser.userNumber;
          token.coins = dbUser.coins;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
        session.user.username = token.username as string;
        session.user.userNumber = token.userNumber as number;
        session.user.coins = token.coins as number;
      }
      return session;
    },
  },
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
});

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

      await prisma.user.update({
        where: { id: ancestor.id },
        data: { coins: { increment: reward } },
      });

      await prisma.coinTransaction.create({
        data: {
          userId: ancestor.id,
          amount: reward,
          description: `Referral chain reward (level ${level}, ${reward} kJ)`,
        },
      });
    }

    currentCode = ancestor.referredBy;
    level++;
  }
}
