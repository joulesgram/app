import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

export type LeaderboardEntry = {
  id: string;
  username: string;
  userNumber: number;
  joulesBalance: number;
  createdAt: Date;
  rank: number;
};

type LeaderboardRow = {
  id: string;
  username: string;
  userNumber: number;
  joulesBalance: number;
  createdAt: Date;
  rank: bigint | number;
};

/**
 * Fetch leaderboard rows ordered by:
 *   1) joulesBalance DESC
 *   2) userNumber ASC
 *   3) createdAt ASC
 *
 * Returns top `limit` plus the current user row (if present) in one query.
 */
export async function getLeaderboard(
  limit: number,
  currentUserId?: string
): Promise<LeaderboardEntry[]> {
  const rows = await prisma.$queryRaw<LeaderboardRow[]>(Prisma.sql`
    WITH ranked_users AS (
      SELECT
        u.id,
        u.username,
        u."userNumber",
        u."joulesBalance",
        u."createdAt",
        ROW_NUMBER() OVER (
          ORDER BY u."joulesBalance" DESC, u."userNumber" ASC, u."createdAt" ASC
        ) AS rank
      FROM "User" u
    )
    SELECT
      id,
      username,
      "userNumber",
      "joulesBalance",
      "createdAt",
      rank
    FROM ranked_users
    WHERE rank <= ${limit}
      ${currentUserId ? Prisma.sql`OR id = ${currentUserId}` : Prisma.empty}
    ORDER BY rank ASC
  `);

  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    userNumber: row.userNumber,
    joulesBalance: Number(row.joulesBalance),
    createdAt: row.createdAt,
    rank: Number(row.rank),
  }));
}
