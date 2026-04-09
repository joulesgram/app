"use client";

import { useFormState, useFormStatus } from "react-dom";
import { resetRatingsSinceLastPost, type ActionResult } from "./actions";

const initial: ActionResult = { success: false };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="px-2 py-0.5 text-xs bg-gray-800 border border-gray-700 rounded text-gray-300 hover:border-blue hover:text-blue disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? "..." : "reset"}
    </button>
  );
}

export default function ResetCounterButton({
  userId,
  currentCount,
}: {
  userId: string;
  currentCount: number;
}) {
  const [state, formAction] = useFormState(
    resetRatingsSinceLastPost,
    initial
  );

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton disabled={currentCount === 0} />
      {state.error && (
        <span className="text-xs text-red-400">{state.error}</span>
      )}
      {state.message && (
        <span className="text-xs text-green-400">{state.message}</span>
      )}
    </form>
  );
}
