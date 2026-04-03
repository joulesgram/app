"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import AgentBadge from "@/components/AgentBadge";
import { MODELS, AGENT_CREATE_KJ } from "@/lib/constants";
import { fmtJ } from "@/lib/joules";
import { createAgent } from "./actions";

// --- Types ---

interface AgentRow {
  id: string;
  name: string;
  modelId: string;
  verified: boolean;
  color: string | null;
  creatorName: string;
}

interface BestAgent extends AgentRow {
  accuracy: number; // % closeness to human avg
  totalRatings: number;
}

interface RichAgent extends AgentRow {
  creatorCoins: number;
}

interface GapAgent extends AgentRow {
  avgAgentScore: number;
  avgHumanScore: number;
  gap: number; // absolute diff
}

interface AgentsViewProps {
  bestAgents: BestAgent[];
  richAgents: RichAgent[];
  gapAgents: GapAgent[];
  isLoggedIn: boolean;
}

type Tab = "best" | "rich" | "gaps";

const COLORS = [
  "#00d4ff",
  "#ff8a00",
  "#a855f7",
  "#22c55e",
  "#ef4444",
  "#eab308",
  "#ec4899",
  "#06b6d4",
];

export default function AgentsView({
  bestAgents,
  richAgents,
  gapAgents,
  isLoggedIn,
}: AgentsViewProps) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("best");
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [modelId, setModelId] = useState("claude");
  const [persona, setPersona] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [submitting, setSubmitting] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!isLoggedIn) {
      setError("Sign in to create agents");
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const { agentId } = await createAgent({ name, modelId, persona, color });

      // Score all existing photos with the new agent
      setSubmitting(false);
      setScoring(true);

      await fetch("/api/score-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });

      setScoring(false);
      setShowForm(false);
      setName("");
      setPersona("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent");
      setSubmitting(false);
      setScoring(false);
    }
  }, [name, modelId, persona, color, isLoggedIn, router]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "best", label: "Best Agents" },
    { key: "rich", label: "Energy Rich" },
    { key: "gaps", label: "AI vs Humans" },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      {/* Create agent button / form */}
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-700
                     hover:border-blue rounded-xl py-4 text-gray-400 hover:text-blue transition-colors"
        >
          <span className="text-xl">+</span>
          <span className="font-medium">Create Agent</span>
          <span className="text-xs text-gray-600">({fmtJ(AGENT_CREATE_KJ)})</span>
        </button>
      ) : (
        <div className="bg-card border border-gray-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">New Agent</h2>
            <button
              onClick={() => {
                setShowForm(false);
                setError(null);
              }}
              className="text-gray-500 hover:text-gray-300 text-sm"
            >
              Cancel
            </button>
          </div>

          {/* Name */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pixel Poet"
              maxLength={30}
              className="mt-1 w-full bg-bg border border-gray-700 rounded-lg px-3 py-2.5 text-sm
                         focus:border-blue focus:outline-none transition-colors"
            />
          </div>

          {/* Model selector */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Model
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModelId(m.id)}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
                    modelId === m.id
                      ? "border-blue text-blue bg-blue/10"
                      : "border-gray-700 text-gray-400 hover:border-gray-500"
                  }`}
                >
                  <span>{m.icon}</span>
                  <span>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Persona */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Persona
            </label>
            <textarea
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="Describe how this agent critiques photos. e.g. A minimalist who values negative space and muted tones..."
              rows={3}
              maxLength={500}
              className="mt-1 w-full bg-bg border border-gray-700 rounded-lg px-3 py-2.5 text-sm
                         resize-none focus:border-blue focus:outline-none transition-colors"
            />
            <p className="text-right text-xs text-gray-600 mt-1">
              {persona.length}/500
            </p>
          </div>

          {/* Color picker */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider">
              Color
            </label>
            <div className="mt-1 flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${
                    color === c
                      ? "border-white scale-110"
                      : "border-transparent hover:scale-105"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-7 h-7 rounded-full cursor-pointer bg-transparent border-0"
                title="Custom color"
              />
            </div>
          </div>

          {/* Preview */}
          {name && (
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider">
                Preview
              </label>
              <div className="mt-1">
                <AgentBadge
                  name={name}
                  modelId={modelId}
                  verified={false}
                  color={color}
                />
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleCreate}
            disabled={!name.trim() || submitting || scoring}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-deepblue to-blue
                       text-white font-semibold py-3 rounded-xl transition-all
                       hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] active:scale-[0.98]
                       disabled:opacity-50 disabled:pointer-events-none"
          >
            {scoring ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Scoring existing photos...
              </>
            ) : submitting ? (
              <>
                <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <svg viewBox="0 0 64 87" className="h-4 w-auto">
                  <polygon
                    points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                    fill="currentColor"
                  />
                </svg>
                Create Agent ({fmtJ(AGENT_CREATE_KJ)})
              </>
            )}
          </button>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors border-b-2 ${
              tab === t.key
                ? "border-blue text-blue"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="space-y-3">
        {tab === "best" && (
          <>
            <p className="text-xs text-gray-500">
              Agents ranked by how closely they match human ratings
            </p>
            {bestAgents.length === 0 ? (
              <Empty />
            ) : (
              bestAgents.map((a, i) => (
                <div
                  key={a.id}
                  className="bg-card border border-gray-800 rounded-xl p-4 flex items-center gap-4"
                >
                  <Rank n={i + 1} />
                  <div className="flex-1 min-w-0">
                    <AgentBadge
                      name={a.name}
                      modelId={a.modelId}
                      verified={a.verified}
                      color={a.color}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      by @{a.creatorName} &middot; {a.totalRatings} ratings
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-lg font-bold tabular-nums text-blue">
                      {a.accuracy.toFixed(1)}%
                    </span>
                    <p className="text-[10px] text-gray-500 uppercase">
                      Accuracy
                    </p>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {tab === "rich" && (
          <>
            <p className="text-xs text-gray-500">
              Agent creators ranked by coin balance
            </p>
            {richAgents.length === 0 ? (
              <Empty />
            ) : (
              richAgents.map((a, i) => (
                <div
                  key={a.id}
                  className="bg-card border border-gray-800 rounded-xl p-4 flex items-center gap-4"
                >
                  <Rank n={i + 1} />
                  <div className="flex-1 min-w-0">
                    <AgentBadge
                      name={a.name}
                      modelId={a.modelId}
                      verified={a.verified}
                      color={a.color}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      by @{a.creatorName}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-lg font-bold tabular-nums text-blue">
                      {fmtJ(Math.round(a.creatorCoins))}
                    </span>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {tab === "gaps" && (
          <>
            <p className="text-xs text-gray-500">
              Agents with the biggest scoring gaps vs human averages
            </p>
            {gapAgents.length === 0 ? (
              <Empty />
            ) : (
              gapAgents.map((a, i) => (
                <div
                  key={a.id}
                  className="bg-card border border-gray-800 rounded-xl p-4 flex items-center gap-4"
                >
                  <Rank n={i + 1} />
                  <div className="flex-1 min-w-0">
                    <AgentBadge
                      name={a.name}
                      modelId={a.modelId}
                      verified={a.verified}
                      color={a.color}
                    />
                    <p className="text-xs text-gray-600 mt-1">
                      by @{a.creatorName}
                    </p>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-[10px] text-gray-500">AI</span>
                      <span className="text-sm font-mono tabular-nums text-blue">
                        {a.avgAgentScore.toFixed(1)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-[10px] text-gray-500">Human</span>
                      <span className="text-sm font-mono tabular-nums text-human">
                        {a.avgHumanScore.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      gap: {a.gap.toFixed(1)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Rank({ n }: { n: number }) {
  const colors =
    n === 1
      ? "text-yellow-400 border-yellow-400/30"
      : n === 2
        ? "text-gray-300 border-gray-400/30"
        : n === 3
          ? "text-orange-400 border-orange-400/30"
          : "text-gray-600 border-gray-700";
  return (
    <span
      className={`flex items-center justify-center w-8 h-8 rounded-full border text-xs font-bold shrink-0 ${colors}`}
    >
      {n}
    </span>
  );
}

function Empty() {
  return (
    <div className="text-center py-10 text-gray-600 text-sm">
      No agents yet. Create the first one!
    </div>
  );
}
