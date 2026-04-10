"use client";

import Link from "next/link";

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string> }) => void;
    posthog?: { capture: (eventName: string, properties?: Record<string, string>) => void };
    gtag?: (command: "event", eventName: string, params?: Record<string, string>) => void;
  }
}

function trackConversion(eventName: string, properties: Record<string, string>) {
  if (typeof window === "undefined") return;

  window.plausible?.(eventName, { props: properties });
  window.posthog?.capture(eventName, properties);
  window.gtag?.("event", eventName, properties);
}

type Props = {
  onSignIn: (formData: FormData) => Promise<void>;
};

export default function JoinCtas({ onSignIn }: Props) {
  return (
    <div className="mt-10 flex flex-col items-center justify-center gap-4">
      <form
        action={onSignIn}
        onSubmit={() => trackConversion("join_signin_initiated", { source: "join_page" })}
        className="w-full max-w-sm space-y-3"
      >
        <input
          type="email"
          name="email"
          placeholder="you@example.com"
          required
          className="w-full rounded-xl border border-gray-700 bg-[#0a0f1a] px-4 py-4 text-white placeholder-gray-500"
        />
        <button
          type="submit"
          onClick={() => trackConversion("join_cta_click", { cta: "signin_email", source: "join_page" })}
          className="w-full px-8 py-4 bg-[#00d4ff] text-[#050810] font-bold rounded-xl text-lg hover:brightness-110 transition"
        >
          Send magic link
        </button>
      </form>

      <Link
        href="/leaderboard"
        onClick={() => trackConversion("join_cta_click", { cta: "leaderboard_first", source: "join_page" })}
        className="px-8 py-4 border border-gray-700 text-white rounded-xl text-lg hover:border-[#00d4ff] hover:text-[#00d4ff] transition"
      >
        See leaderboard first
      </Link>
    </div>
  );
}
