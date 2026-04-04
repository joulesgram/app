"use client";

import { useState } from "react";

type InviteCardProps = {
  inviteUrl: string;
};

export default function InviteCard({ inviteUrl }: InviteCardProps) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setCopyError(null);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopyError("Could not copy automatically. Please copy the link manually.");
    }
  }

  async function handleShare() {
    if (!canShare) return;

    try {
      await navigator.share({
        title: "Join me on Joulesgram",
        text: "Use my invite link to join Joulesgram:",
        url: inviteUrl,
      });
    } catch {
      // User canceled or share unavailable at runtime.
    }
  }

  return (
    <section className="bg-card border border-gray-800 rounded-xl p-4 sm:p-5">
      <h2 className="text-lg font-semibold text-white">Your invite link</h2>
      <p className="mt-1 text-sm text-gray-400">Share this link to invite a friend.</p>

      <div className="mt-4 flex flex-col gap-3">
        <input
          readOnly
          value={inviteUrl}
          aria-label="Invite URL"
          className="w-full rounded-lg border border-gray-700 bg-[#0b1020] px-3 py-2 text-sm text-gray-200"
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-blue px-4 py-2 text-sm font-medium text-white hover:bg-deepblue transition-colors"
          >
            {copied ? "Copied!" : "Copy link"}
          </button>

          {canShare ? (
            <button
              type="button"
              onClick={handleShare}
              className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-gray-200 hover:border-blue hover:text-blue transition-colors"
            >
              Share
            </button>
          ) : null}
        </div>

        {copyError ? <p className="text-sm text-red-400">{copyError}</p> : null}
      </div>
    </section>
  );
}
