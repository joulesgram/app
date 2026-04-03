import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

const url = (process.env.POSTGRES_PRISMA_URL || process.env.DATABASE_URL || "")
  .replace(/[?&]channel_binding=[^&]*/g, "");

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({ datasourceUrl: url });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
