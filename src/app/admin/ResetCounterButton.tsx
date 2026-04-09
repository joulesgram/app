"use client";

import { useActionState } from "react";
import { resetRatingsSinceLastPost, type ActionResult } from "./actions";

const initial: ActionResult = { success: false };

export default function ResetCounterButton({
  userId,
  currentCount,
}: {
  userId: string;
  currentCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    resetRatingsSinceLastPost,
    initial
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <button
        type="submit"
        disabled={pending || currentCount === 0}
        className="px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 hover:border-blue hover:text-blue disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? "..." : "reset"}
      </button>
      {state.error && (
        <span className="text-xs text-red-400">{state.error}</span>
      )}
      {state.message && (
        <span className="text-xs text-green-400">{state.message}</span>
      )}
    </form>
  );
}
