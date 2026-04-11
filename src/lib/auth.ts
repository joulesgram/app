import { createHash, randomUUID } from "node:crypto";
import NextAuth, { type DefaultSession } from "next-auth";
import Resend from "next-auth/providers/resend";
import type { Adapter } from "next-auth/adapters";
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

// Custom adapter implementing the methods Auth.js v5 email provider requires.
// The adapter creates a placeholder User row on first sign-in with explicit
// placeholder values for every NOT NULL column. The signIn callback below
// then overwrites username/referralCode with real values and runs the
// Joulegram-specific bootstrap (genesis bonus + referral chain), guarded by
// the `bootstrapped` flag so it only runs once per user. userNumber is
// assigned atomically here under an advisory lock and never rewritten.
//
// Why placeholders instead of schema defaults: the init migration declared
// id/username/referralCode with @default(cuid()) and userNumber with
// @default(autoincrement()) in the Prisma schema, but the generated DDL
// left these columns as NOT NULL with no DB-level default and no sequence.
// This was never caught because early users were created via the legacy
// GitHub OAuth flow (custom code, explicit values), not through this
// adapter. The email magic-link flow runs this code path for the first
// time, so we fill in every required field ourselves.
const verificationTokenAdapter: Adapter = {
  async createVerificationToken(token) {
    await prisma.verificationToken.create({ data: token });
    return token;
  },
  async useVerificationToken({ identifier, token }) {
    try {
      return await prisma.verificationToken.delete({
        where: { identifier_token: { identifier, token } },
      });
    } catch {
      return null;
    }
  },
  async getUserByEmail(email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified ?? null,
      name: user.name ?? null,
      image: user.image ?? null,
    };
  },
  async createUser(user) {
    if (!user.email) {
      throw new Error("createUser requires an email");
    }
    const email = user.email;
    const emailVerified = user.emailVerified ?? null;
    const name = user.name ?? null;
    const image = user.image ?? null;

    const created = await prisma.$transaction(async (tx) => {
      // Serialize user creation with a transaction-scoped advisory lock so
      // two concurrent signups cannot read the same MAX("userNumber") and
      // both try to claim the same value. Lock is auto-released on commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('joulegram.user_create')::bigint)`;

      // MAX+1 is safe because the treasury system user is userNumber=0
      // and every real user has userNumber >= 1.
      const rows = await tx.$queryRaw<Array<{ next_number: number }>>`
        SELECT COALESCE(MAX("userNumber"), 0) + 1 AS next_number FROM "User"
      `;
      const nextUserNumber = Number(rows[0].next_number);

      // Placeholder values unique by UUID. signIn overwrites username and
      // referralCode with the human-readable form once it computes them.
      const placeholder = `pending_${randomUUID()}`;

      return tx.user.create({
        data: {
          id: placeholder,
          username: placeholder,
          email,
          emailVerified,
          name,
          image,
          userNumber: nextUserNumber,
          referralCode: placeholder,
        },
      });
    });

    return {
      id: created.id,
      email: created.email,
      emailVerified: created.emailVerified ?? null,
      name: created.name ?? null,
      image: created.image ?? null,
    };
  },
  async updateUser(user) {
    const updated = await prisma.user.update({
      where: { id: user.id! },
      data: {
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        image: user.image,
      },
    });
    return {
      id: updated.id,
      email: updated.email,
      emailVerified: updated.emailVerified ?? null,
      name: updated.name ?? null,
      image: updated.image ?? null,
    };
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: verificationTokenAdapter,
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
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      const userEmail = user.email;

      try {
        const existing = await prisma.user.findUnique({
          where: { email: userEmail },
        });

        // Run Joulegram bootstrap only once, after the adapter has created
        // the placeholder row. Guarded by the `bootstrapped` flag.
        if (existing && !existing.bootstrapped) {
          const username = userEmail.split("@")[0];
          // userNumber was assigned atomically by the adapter's createUser
          // under an advisory lock. Reuse it here instead of recomputing
          // from count(bootstrapped) — count-based recomputation races with
          // parallel signups (two signIns reading the same count and both
          // trying to UPDATE to the same userNumber, violating the unique
          // constraint).
          const userNumber = existing.userNumber;
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
              logInvalidReferralAttempt(rawReferredBy, "inviter_not_found", userEmail);
            } else if (inviter.email === userEmail) {
              logInvalidReferralAttempt(rawReferredBy, "self_referral_email", userEmail);
              inviter = null;
            }
          }

          const referredBy = inviter?.referralCode ?? null;

          // Reward is in kJ from getSignupReward; convert to joules for storage
          const rewardJ = new Decimal(reward).times(1000);

          const newUser = await prisma.$transaction(async (tx) => {
            // Overwrite the adapter-created placeholder username/referralCode
            // with real values. userNumber is intentionally not written —
            // it was assigned in createUser and must remain stable.
            const updated = await tx.user.update({
              where: { id: existing.id },
              data: {
                username,
                referralCode,
                referredBy,
                joulesBalance: rewardJ,
                bootstrapped: true,
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
                referenceId: updated.id,
                description: `Genesis bonus outflow for user #${userNumber}`,
              },
            });

            await tx.ledgerEntry.create({
              data: {
                userId: updated.id,
                entryType: "GENESIS_BONUS",
                amount: rewardJ,
                balanceAfter: updated.joulesBalance,
                referenceType: "user",
                referenceId: updated.id,
                description: `Signup reward (${reward} kJ)`,
              },
            });

            return updated;
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
