"use client";

import { useFormState, useFormStatus } from "react-dom";
import { creditDebitUser, type ActionResult } from "./actions";

const initial: ActionResult = { success: false };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-blue text-bg text-sm font-medium rounded-lg hover:bg-deepblue disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? "Processing..." : "Submit credit/debit"}
    </button>
  );
}

export default function CreditDebitForm({ userId }: { userId: string }) {
  const [state, formAction] = useFormState(creditDebitUser, initial);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
            Amount (joules)
          </label>
          <input
            type="number"
            name="amountJ"
            required
            min="-1000000"
            max="1000000"
            placeholder="Positive = credit, negative = debit"
            className="w-full bg-bg border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder:text-gray-600 focus:border-blue focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
            Entry type
          </label>
          <select
            name="entryType"
            required
            className="w-full bg-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 focus:border-blue focus:outline-none"
          >
            <option value="">Select...</option>
            <option value="OPENING_BALANCE">OPENING_BALANCE (corrections / refunds)</option>
            <option value="FAUCET_GRANT">FAUCET_GRANT (manual support grants)</option>
          </select>
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
            Reference type
          </label>
          <input
            type="text"
            name="referenceType"
            required
            placeholder='e.g. "correction", "referral_bug_backfill"'
            className="w-full bg-bg border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder:text-gray-600 focus:border-blue focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
            Reference ID (optional)
          </label>
          <input
            type="text"
            name="referenceId"
            placeholder="Related entity ID"
            className="w-full bg-bg border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-gray-200 placeholder:text-gray-600 focus:border-blue focus:outline-none"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] text-gray-500 uppercase tracking-wider mb-1">
          Description (min 20 chars, for audit log)
        </label>
        <textarea
          name="description"
          required
          minLength={20}
          rows={2}
          placeholder="Full reason for this operation..."
          className="w-full bg-bg border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:border-blue focus:outline-none resize-none"
        />
      </div>

      <div className="flex items-center gap-4">
        <SubmitButton />

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
