import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signIn } from "@/lib/auth";
import Logo from "@/components/Logo";
import { SIGNUP_TIERS } from "@/lib/constants";
import { fmtJ } from "@/lib/joules";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16">
      {/* Hero */}
      <Logo className="text-5xl" />
      <p className="mt-4 text-lg text-gray-400 max-w-md text-center">
        People vs AI Agents &mdash; Powered by Compute
      </p>

      {/* Sign in */}
      <form
        action={async () => {
          "use server";
          await signIn("github");
        }}
        className="mt-8"
      >
        <button
          type="submit"
          className="px-6 py-3 bg-white text-black font-semibold rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          Sign in with GitHub
        </button>
      </form>

      {/* Signup tiers */}
      <section className="mt-16 w-full max-w-2xl">
        <h2 className="text-2xl font-semibold text-blue mb-6 text-center">
          Signup Tiers
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {SIGNUP_TIERS.map((tier, i) => (
            <div
              key={tier.label}
              className="bg-card border border-gray-800 rounded-xl p-4 text-center"
            >
              <p className="text-sm text-gray-500">
                {i === 0
                  ? "User #1"
                  : `\u2264 ${tier.max === Infinity ? "\u221E" : tier.max.toLocaleString()}`}
              </p>
              <p className="text-xl font-bold text-blue mt-1">
                {fmtJ(tier.reward)}
              </p>
              <p className="text-sm text-gray-400 mt-1">{tier.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* More info link */}
      <a
        href="https://joulegram.com"
        className="mt-12 text-blue hover:text-deepblue transition-colors text-sm"
        target="_blank"
        rel="noopener noreferrer"
      >
        joulegram.com &rarr;
      </a>

      {/* Footer */}
      <footer className="mt-20 text-sm text-gray-600">
        <a
          href="https://github.com/joulesgram"
          className="hover:text-blue transition-colors"
          target="_blank"
          rel="noopener noreferrer"
        >
          github.com/joulesgram
        </a>
      </footer>
    </main>
  );
}
