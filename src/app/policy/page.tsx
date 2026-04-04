import Link from "next/link";
import {
  AGENT_CREATE_KJ,
  GENESIS_KJ,
  PHOTO_SCORE_KJ,
  RATING_KJ,
  SIGNUP_TIERS,
} from "@/lib/constants";
import { chainReward, fmtJ } from "@/lib/joules";

const REFERRAL_LEVELS = [0, 1, 2, 3, 4, 5] as const;

export default function PolicyPage() {
  return (
    <main className="min-h-screen bg-[#050810] text-white px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-[#00d4ff]">Policy</p>
          <h1 className="text-3xl md:text-5xl font-bold tracking-wider">Joule Issuance Policy</h1>
          <p className="text-gray-400 text-sm md:text-base leading-relaxed">
            This page documents how Joules enter the system so supply growth is understandable,
            auditable, and consistent.
          </p>
        </header>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Spec + README context</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Joulegram is described in the README as an AI-powered photo scoring platform where users
            earn energy and build agents. The product spec direction in-app is an open protocol with
            app, protocol, and agent-runner components.
          </p>
          <ul className="list-disc list-inside text-sm text-gray-400 space-y-1">
            <li><strong>Protocol:</strong> defines issuance and scoring rules.</li>
            <li><strong>App:</strong> provides the consumer UI and onboarding.</li>
            <li><strong>Agent runner:</strong> executes model-based judging at scale.</li>
          </ul>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Founder story and thesis</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            The founder narrative in the landing page is that fintech explained how money moves,
            crypto explained what gives it meaning, and AI points to a next economy measured in joules.
            This policy turns that thesis into explicit, inspectable issuance math.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Genesis allocation</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            User #1 (Founder) receives the genesis allocation: <strong>{fmtJ(GENESIS_KJ)}</strong>.
            This is the initial bootstrap energy balance and anchors all later issuance.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">Signup emission tiers</h2>
          <p className="text-sm text-gray-400">Tier rewards are read directly from <code>SIGNUP_TIERS</code>.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="py-2 pr-3">Tier</th>
                  <th className="py-2 pr-3">User index</th>
                  <th className="py-2">Reward</th>
                </tr>
              </thead>
              <tbody>
                {SIGNUP_TIERS.map((tier, idx) => {
                  const min = idx === 0 ? 1 : SIGNUP_TIERS[idx - 1].max + 1;
                  const range = Number.isFinite(tier.max) ? `${min} - ${tier.max}` : `${min}+`;

                  return (
                    <tr key={tier.label} className="border-b border-gray-900 last:border-0">
                      <td className="py-2 pr-3">{tier.label}</td>
                      <td className="py-2 pr-3 text-gray-400">{range}</td>
                      <td className="py-2 font-mono text-[#00d4ff]">{fmtJ(tier.reward)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">Referral chain reward decay</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Referral rewards decay by depth using <code>chainReward(level)</code>, currently
            <code className="ml-1">max(0, 1 / 2^level)</code>.
          </p>
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            {REFERRAL_LEVELS.map((level) => (
              <li key={level} className="rounded-lg border border-gray-800 bg-[#050810] px-3 py-2">
                <span className="text-gray-400">Level {level}: </span>
                <span className="font-mono text-[#00d4ff]">{chainReward(level).toFixed(4)}x</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">Energy unit definitions</h2>
          <ul className="space-y-2 text-sm">
            <li><span className="text-gray-400">GENESIS_KJ</span>: <span className="font-mono text-[#00d4ff]">{fmtJ(GENESIS_KJ)}</span></li>
            <li><span className="text-gray-400">PHOTO_SCORE_KJ</span>: <span className="font-mono text-[#00d4ff]">{fmtJ(PHOTO_SCORE_KJ)}</span></li>
            <li><span className="text-gray-400">AGENT_CREATE_KJ</span>: <span className="font-mono text-[#00d4ff]">{fmtJ(AGENT_CREATE_KJ)}</span></li>
            <li><span className="text-gray-400">RATING_KJ</span>: <span className="font-mono text-[#00d4ff]">{fmtJ(RATING_KJ)}</span></li>
          </ul>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Why this matters</h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
            <li><strong>Scarcity:</strong> A defined issuance path keeps total supply legible.</li>
            <li><strong>Fairness:</strong> Emissions follow published tiers instead of ad hoc grants.</li>
            <li><strong>Early contribution:</strong> Early users and referrals are rewarded for bootstrapping demand.</li>
            <li><strong>Transparency:</strong> Issuance logic is tied to constants and functions in code.</li>
            <li><strong>Ethereum-like trajectory:</strong> if adoption grows, joules can behave like a shared unit of account for compute work, with clear issuance rules similar to how blockchain economies publish monetary policy.</li>
          </ul>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Joule economy vision</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            The long-term goal is a compute-native economy where value is priced in joules rather than
            abstract points. In that world, creators, raters, and agents settle value in a common energy
            unit. This policy page is the first step: publish the issuance schedule now, then scale into
            a broader protocol economy over time.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-5">
          <h2 className="text-2xl font-semibold">FAQ</h2>
          <div>
            <h3 className="font-medium text-white">Why does User #1 have genesis joules?</h3>
            <p className="mt-1 text-sm text-gray-400">
              User #1 is the founder account and receives the one-time genesis allocation of
              {" "}<strong>{fmtJ(GENESIS_KJ)}</strong> to seed network activity.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-white">How are new joules minted?</h3>
            <p className="mt-1 text-sm text-gray-400">
              Minting comes from explicit issuance paths: signup tier rewards and referral chain rewards.
              Both are deterministic from <code>SIGNUP_TIERS</code> and <code>chainReward(level)</code>.
            </p>
          </div>
          <div>
            <h3 className="font-medium text-white">Can invites inflate supply?</h3>
            <p className="mt-1 text-sm text-gray-400">
              Invites do increase supply, but each hop receives a smaller multiplier because
              chain rewards decay exponentially by level.
            </p>
          </div>
        </section>

        <div className="pb-8">
          <Link href="/feed" className="text-sm text-[#00d4ff] hover:brightness-110">
            ← Back to app
          </Link>
        </div>
      </div>
    </main>
  );
}
