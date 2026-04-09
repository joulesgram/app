"use client";

import { useActionState } from "react";
import { setReferredBy, type ActionResult } from "./actions";

const initial: ActionResult = { success: false };

export default function SetReferredByForm({ userId }: { userId: string }) {
  const [state, formAction, pending] = useActionState(setReferredBy, initial);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="userId" value={userId} />

      <div>
        <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
          Inviter&apos;s referral code
        </label>
        <input
          type="text"
          name="inviterReferralCode"
          required
          placeholder="Paste the inviter's referralCode"
          className="w-full bg-bg border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder:text-gray-600 focus:border-blue focus:outline-none"
        />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2 bg-blue text-bg text-sm font-medium rounded-lg hover:bg-deepblue disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? "Setting..." : "Set referredBy"}
        </button>

        {state.error && (
          <p className="text-sm text-red-400">{state.error}</p>
        )}
        {state.message && (
          <p className="text-sm text-green-400">{state.message}</p>
        )}
      </div>
    </form>
  );
}
