import { PrismaClient } from "@/generated/prisma";

function getCleanUrl() {
  const raw = process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || "";
  return raw.replace(/[?&]channel_binding=[^&]*/g, "");
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    datasourceUrl: getCleanUrl(),
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
