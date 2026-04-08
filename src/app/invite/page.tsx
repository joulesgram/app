import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import BottomNav from "@/components/BottomNav";
import Logo from "@/components/Logo";
import IssuancePolicyLink from "@/components/IssuancePolicyLink";
import BatteryWidget from "@/components/BatteryWidget";
import { isSparkUIMode } from "@/lib/spark-ui";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import InviteCard from "./InviteCard";

function deriveOrigin(headerList: Headers): string {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL;
  if (envOrigin) return envOrigin;

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";

  if (host) {
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}

export default async function InvitePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { referralCode: true, username: true, joulesBalance: true },
  });

  const origin = deriveOrigin(headers());

  return (
    <main className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Logo className="text-xl" />
          <div className="flex items-center gap-3">
            <IssuancePolicyLink />
            <div className="text-right">
            <p className="text-xs text-gray-500">@{session.user.username ?? "user"}</p>
            {(() => {
              const balanceJ = currentUser ? Number(currentUser.joulesBalance) : (session.user.joulesBalance ?? 0);
              return isSparkUIMode({ joulesBalance: balanceJ }) ? (
                <BatteryWidget joulesBalance={balanceJ} size="sm" />
              ) : (
                <p className="text-sm font-mono text-blue">
                  {Math.floor(balanceJ / 1000).toLocaleString()} kJ
                </p>
              );
            })()}
            </div>
          </div>
        </div>
      </header>

      <section className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Invite friends</h1>
          <p className="mt-1 text-sm text-gray-400">
            Earn together by sharing your referral link.
          </p>
        </div>

        {currentUser?.referralCode ? (
          <InviteCard inviteUrl={`${origin}/?ref=${encodeURIComponent(currentUser.referralCode)}`} />
        ) : (
          <section className="bg-card border border-red-900/40 rounded-xl p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-white">Invite link unavailable</h2>
            <p className="mt-2 text-sm text-gray-300">
              We could not find a referral code on your account yet.
            </p>
            <p className="mt-2 text-sm text-gray-400">
              Try signing out and in again. If this persists, contact support or a developer with your
              username so we can regenerate your code.
            </p>
            <Link
              href="/feed"
              className="mt-4 inline-block text-sm text-blue hover:text-deepblue transition-colors"
            >
              Return to feed &rarr;
            </Link>
          </section>
        )}
      </section>

      <BottomNav />
    </main>
  );
}
