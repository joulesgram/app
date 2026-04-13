import Link from "next/link";
import {
  AGENT_CREATE_KJ,
  GENESIS_KJ,
  PHOTO_SCORE_KJ,
  RATING_KJ,
  REFERRAL_BASE_KJ,
  SIGNUP_TIERS,
  UPLOAD_REWARD_KJ,
} from "@/lib/constants";
import { chainReward, fmtJ } from "@/lib/joules";

const REFERRAL_LEVELS = [1, 2, 3, 4, 5] as const;
const UPLOAD_NET_KJ = PHOTO_SCORE_KJ - UPLOAD_REWARD_KJ;

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
          <h2 className="text-2xl font-semibold">Genesis allocation</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            User #1 (Founder) receives the genesis allocation: <strong>{fmtJ(GENESIS_KJ)}</strong>.
            This is the initial bootstrap energy balance and anchors all later issuance.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">Mission context (Spec + README + Founder story)</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Joulegram is an <strong>AI-powered photo scoring platform</strong> where people and agents compete,
            but the larger ambition is bigger than photo ratings: to make <strong>joules the unit of value</strong>
            for AI coordination. In the README spirit of “Earn energy. Build agents.”, issuance is not just a
            reward schedule &mdash; it&apos;s the economic layer for a new compute-native network.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">
            The protocol spec direction is simple: every meaningful action has an explicit energy cost,
            issuance is deterministic, and incentives are transparent in code. That creates a credibly neutral
            base layer where contributors can build agents, markets, and reputation on top of measurable energy.
          </p>
          <blockquote className="border-l-2 border-[#ff8a00] pl-4 text-sm italic text-gray-400">
            “Fintech taught me how money moves. Crypto taught me what gives it meaning. AI showed me the next
            economy will be measured in joules.”
          </blockquote>
          <p className="text-sm text-gray-300 leading-relaxed">
            This policy turns that founder thesis into mechanism design: transparent minting, legible scarcity,
            and incentives for early participants who help bootstrap a global joule economy.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">3. Issuance accounting formula</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            Net issuance is tracked with a single accounting identity:
            <code className="ml-1">NetIssuance = Mint + BonusMints - Burns</code>.
            This replaces qualitative framing (for example, “mildly deflationary at genesis”) with a measurable
            target burn/mint band that can be monitored daily.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">4. Mint classes and daily-capped bonus pools</h2>
          <p className="text-sm text-gray-400">
            Tier rewards are read directly from <code>SIGNUP_TIERS</code>.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">
            We classify faucet, referral, genesis, and weekly incentive pools as <code>BonusMints</code>. Each
            bonus pool should run with an explicit daily cap so launch emissions remain predictable and throttleable.
          </p>
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
            Referral rewards start at <code>{REFERRAL_BASE_KJ} kJ</code> for a direct invite and halve
            at each chain level: <code className="ml-1">REFERRAL_BASE_KJ / 2^(level−1)</code>.
          </p>
          <ul className="grid sm:grid-cols-2 gap-2 text-sm">
            {REFERRAL_LEVELS.map((level) => (
              <li key={level} className="rounded-lg border border-gray-800 bg-[#050810] px-3 py-2">
                <span className="text-gray-400">Level {level}: </span>
                <span className="font-mono text-[#00d4ff]">{fmtJ(REFERRAL_BASE_KJ * chainReward(level))}</span>
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

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-semibold">Action outcomes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-800">
                  <th className="py-2 pr-3">Action</th>
                  <th className="py-2 pr-3">Economics</th>
                  <th className="py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-900">
                  <td className="py-2 pr-3">Upload + AI score</td>
                  <td className="py-2 pr-3 text-gray-300">
                    Cost {fmtJ(PHOTO_SCORE_KJ)}, reward +{fmtJ(UPLOAD_REWARD_KJ)}, net -{fmtJ(UPLOAD_NET_KJ)}
                  </td>
                  <td className="py-2 text-gray-400">Outputs returned</td>
                </tr>
                <tr className="border-b border-gray-900">
                  <td className="py-2 pr-3">Rate a photo</td>
                  <td className="py-2 pr-3 text-gray-300">Cost {fmtJ(RATING_KJ)}</td>
                  <td className="py-2 text-gray-400">Reveal behavior</td>
                </tr>
                <tr className="border-b border-gray-900">
                  <td className="py-2 pr-3">Create an agent</td>
                  <td className="py-2 pr-3 text-gray-300">Cost {fmtJ(AGENT_CREATE_KJ)}</td>
                  <td className="py-2 text-gray-400">Required inputs, no direct reward</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Agent backfill scoring</td>
                  <td className="py-2 pr-3 text-gray-300">No additional user action cost</td>
                  <td className="py-2 text-gray-400">Runs after creation and may take time</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-gray-800 bg-[#050810] p-4 space-y-2">
            <h3 className="font-medium text-white">5.4 Burn-side policy objective</h3>
            <p className="text-sm text-gray-300 leading-relaxed">
              Instead of describing launch state as “mildly deflationary at genesis,” policy should target a
              burn/mint band and adjust bonus emission velocity to stay inside that band as usage ramps.
            </p>
          </div>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">Why this matters</h2>
          <ul className="list-disc list-inside space-y-1 text-sm text-gray-300">
            <li><strong>Scarcity:</strong> A defined issuance path keeps total supply legible.</li>
            <li><strong>Fairness:</strong> Emissions follow published tiers instead of ad hoc grants.</li>
            <li><strong>Early contribution:</strong> Early users and referrals are rewarded for bootstrapping demand.</li>
            <li><strong>Transparency:</strong> Issuance logic is tied to constants and functions in code.</li>
            <li><strong>Long-term compounding:</strong> A measurable energy unit can become digital infrastructure, not just an app point system.</li>
          </ul>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-3">
          <h2 className="text-2xl font-semibold">The crux: towards a Joule economy</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            If the internet needed native money and got Bitcoin, and programmable value and got Ethereum,
            AI-native coordination may need a native unit tied to real-world compute. Joules are that candidate.
          </p>
          <p className="text-sm text-gray-300 leading-relaxed">
            By contributing now &mdash; rating, creating agents, and inviting aligned builders &mdash; you&apos;re not only
            earning issuance. You&apos;re helping shape early norms, distribution, and utility for a system that could
            evolve from product economy to protocol economy.
          </p>
          <p className="text-sm text-[#00d4ff] leading-relaxed font-medium">
            Join early. Contribute honestly. Help build the Ethereum of the Joule era.
          </p>
        </section>

        <section className="bg-[#0a0f1a] border border-gray-800 rounded-2xl p-6 space-y-5">
          <h2 className="text-2xl font-semibold">10. Launch KPI + auto-throttle controls</h2>
          <div className="rounded-xl border border-gray-800 bg-[#050810] p-4 space-y-2">
            <p className="text-sm text-gray-300 leading-relaxed">
              Launch KPI target:
              <code className="ml-1">Burns / (Mint + BonusMints)</code> should remain inside a configured range
              (for example, 0.60&ndash;0.90 over a rolling 7-day window).
            </p>
            <p className="text-sm text-gray-300 leading-relaxed">
              If the KPI falls below the lower bound, auto-throttle faucet/referral payouts by reducing per-user
              payouts and/or tightening daily caps. If the KPI rises above the upper bound, cautiously relax caps
              within predefined max limits.
            </p>
          </div>

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
