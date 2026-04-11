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
//
// createUser runs the full Joulegram bootstrap in a single advisory-locked
// transaction: it computes a monotonic userNumber, derives a human-readable
// username and referralCode, grants the signup reward, debits the treasury,
// writes both ledger entries, and commits everything atomically. The
// referral ancestor chain is walked after the main transaction (each
// ancestor credit is its own transaction, matching the old behavior).
//
// Why the bootstrap lives here and not in the signIn callback: in the email
// callback flow Auth.js calls the signIn callback BEFORE createUser (see
// @auth/core/lib/actions/callback/index.js handleAuthorized → then
// handleLoginOrRegister). For a brand-new user, `existing` is null both
// times signIn fires, so a bootstrap guarded by `!existing.bootstrapped`
// never runs on a first-time signup — the user ends up with a placeholder
// username and zero joules. Running bootstrap in createUser, where we
// already hold a write lock and know the user does not yet exist, is both
// simpler and correct for first-timers.
//
// Why every column is set explicitly: the init migration declared
// id/username/referralCode with @default(cuid()) and userNumber with
// @default(autoincrement()) in the Prisma schema, but the generated DDL
// left these columns as NOT NULL with no DB-level default and no sequence.
// This was never caught because early users were created via the legacy
// GitHub OAuth flow (custom code, explicit values), not through this
// adapter. Every column we care about is supplied from the application.
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
    const userEmail = user.email;
    const emailVerified = user.emailVerified ?? new Date();
    const name = user.name ?? null;
    const image = user.image ?? null;

    // Read the referral cookie set by middleware from ?ref=. cookies() is
    // request-scoped and works inside the adapter because createUser runs
    // within the Next.js API route handler for /api/auth/callback/resend.
    const cookieStore = await cookies();
    const rawReferredBy = cookieStore.get("referral_code")?.value ?? null;

    // Inviter lookup outside the main tx — preserves the old behavior and
    // keeps the locked section short. The inviter row is stable (no
    // cascade/delete on User in prod), so reading it outside the tx is
    // safe.
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

    const created = await prisma.$transaction(async (tx) => {
      // Serialize user creation with a transaction-scoped advisory lock so
      // two concurrent signups cannot read the same MAX("userNumber") or
      // the same `baseUsername` availability check. Lock is auto-released
      // on commit.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('joulegram.user_create')::bigint)`;

      // MAX+1 is safe because the treasury system user is userNumber=0
      // and every real user has userNumber >= 1.
      const rows = await tx.$queryRaw<Array<{ next_number: number }>>`
        SELECT COALESCE(MAX("userNumber"), 0) + 1 AS next_number FROM "User"
      `;
      const userNumber = Number(rows[0].next_number);

      // Base username is the email local part. If another user already
      // owns it (e.g. two users with "john@a.com" and "john@b.com"), fall
      // back to "john<userNumber>" which is guaranteed unique by the lock.
      const baseUsername = userEmail.split("@")[0];
      const baseTaken = await tx.user.findUnique({
        where: { username: baseUsername },
        select: { id: true },
      });
      const username = baseTaken ? `${baseUsername}${userNumber}` : baseUsername;

      // referralCode always uses the base form + userNumber — userNumber
      // is unique so this is unique by construction, even if base is taken.
      const referralCode = `${baseUsername}${userNumber}`;

      // Reward is in kJ from getSignupReward; convert to joules for storage.
      const reward = getSignupReward(userNumber);
      const rewardJ = new Decimal(reward).times(1000);

      // Insert the User row with all real values and bootstrapped=true in
      // one shot — no placeholder phase, no follow-up UPDATE.
      const row = await tx.user.create({
        data: {
          id: randomUUID(),
          username,
          email: userEmail,
          emailVerified,
          name,
          image,
          userNumber,
          referralCode,
          referredBy,
          joulesBalance: rewardJ,
          bootstrapped: true,
        },
      });

      // Debit treasury and write the paired ledger entries. Every credit
      // to a real user must have a matching treasury debit to preserve
      // integrity rule #3 (SUM(LedgerEntry.amount) = SUM(joulesBalance)).
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
          referenceId: row.id,
          description: `Genesis bonus outflow for user #${userNumber}`,
        },
      });

      await tx.ledgerEntry.create({
        data: {
          userId: row.id,
          entryType: "GENESIS_BONUS",
          amount: rewardJ,
          balanceAfter: row.joulesBalance,
          referenceType: "user",
          referenceId: row.id,
          description: `Signup reward (${reward} kJ)`,
        },
      });

      return row;
    });

    // Walk the referral ancestor chain outside the main tx. Matches the
    // pre-existing behavior: each ancestor credit gets its own transaction.
    if (inviter && inviter.id !== created.id) {
      try {
        await processReferralChain(inviter.referralCode, created.id);
      } catch (e) {
        // Don't block user creation on referral-chain bookkeeping failures.
        console.error("Auth referral chain error:", e);
      }
    }

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
      // All user creation + Joulegram bootstrap (genesis bonus, ledger
      // entries, referral chain) runs atomically inside adapter.createUser.
      // This callback is intentionally a pass-through: it fires before
      // createUser in the email flow, so any bootstrap logic here would
      // miss first-time signups. Just gate on a present email.
      return !!user.email;
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
