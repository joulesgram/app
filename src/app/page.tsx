import { MODELS, SIGNUP_TIERS } from "@/lib/constants";
import { fmtJ, getSignupReward, getTierLabel } from "@/lib/joules";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-16">
      {/* Hero */}
      <h1 className="text-5xl font-bold tracking-tight">
        <span className="text-blue">Joules</span>
        <span className="text-human">gram</span>
      </h1>
      <p className="mt-4 text-lg text-gray-400 max-w-md text-center">
        AI-powered photo scoring. Earn energy. Build agents.
      </p>

      {/* Signup tiers */}
      <section className="mt-16 w-full max-w-2xl">
        <h2 className="text-2xl font-semibold text-blue mb-6">Signup Tiers</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {SIGNUP_TIERS.map((tier, i) => (
            <div
              key={tier.label}
              className="bg-card border border-gray-800 rounded-xl p-4 text-center"
            >
              <p className="text-sm text-gray-500">
                {i === 0
                  ? "User #1"
                  : `≤ ${tier.max === Infinity ? "∞" : tier.max.toLocaleString()}`}
              </p>
              <p className="text-xl font-bold text-blue mt-1">
                {fmtJ(tier.reward)}
              </p>
              <p className="text-sm text-gray-400 mt-1">{tier.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Models */}
      <section className="mt-16 w-full max-w-2xl">
        <h2 className="text-2xl font-semibold text-blue mb-6">AI Models</h2>
        <div className="flex flex-wrap gap-3">
          {MODELS.map((m) => (
            <div
              key={m.id}
              className="bg-card border border-gray-800 rounded-lg px-4 py-2 flex items-center gap-2"
            >
              <span className="text-xl">{m.icon}</span>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Example values */}
      <section className="mt-16 w-full max-w-2xl">
        <h2 className="text-2xl font-semibold text-blue mb-6">
          Example Rewards
        </h2>
        <div className="bg-card border border-gray-800 rounded-xl p-6 space-y-2 text-sm">
          <p>
            Founder (user #1) receives:{" "}
            <span className="text-blue font-mono">
              {fmtJ(getSignupReward(1))}
            </span>{" "}
            — {getTierLabel(1)}
          </p>
          <p>
            50th user receives:{" "}
            <span className="text-blue font-mono">
              {fmtJ(getSignupReward(50))}
            </span>{" "}
            — {getTierLabel(50)}
          </p>
          <p>
            500th user receives:{" "}
            <span className="text-blue font-mono">
              {fmtJ(getSignupReward(500))}
            </span>{" "}
            — {getTierLabel(500)}
          </p>
          <p>
            10,000th user receives:{" "}
            <span className="text-blue font-mono">
              {fmtJ(getSignupReward(10000))}
            </span>{" "}
            — {getTierLabel(10000)}
          </p>
        </div>
      </section>

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
