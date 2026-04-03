"use client";

import { useState, useCallback } from "react";
import ScoreRing from "@/components/ScoreRing";
import JouleSlider from "@/components/JouleSlider";
import AgentBadge from "@/components/AgentBadge";
import { submitRating } from "./actions";
import { VALID_CATEGORIES } from "@/lib/constants";

interface AgentRatingData {
  score: number;
  critique: string | null;
  agent: {
    name: string;
    modelId: string;
    verified: boolean;
    color: string | null;
  };
}

interface PhotoViewProps {
  photoId: string;
  imageUrl: string;
  username: string;
  category: string | null;
  aiScore: number | null;
  critique: string | null;
  humanAvg: number | null;
  agentRatings: AgentRatingData[];
  isOwner: boolean;
  existingRating: number | null;
  isLoggedIn: boolean;
}

type RevealPhase =
  | "idle"
  | "submitting"
  | "revealing"
  | "your-score"
  | "rings"
  | "agents"
  | "critique"
  | "done";

const PHASE_DELAYS: Record<string, number> = {
  revealing: 600,
  "your-score": 400,
  rings: 400,
  agents: 400,
  critique: 300,
};

export default function PhotoView({
  photoId,
  imageUrl,
  username,
  category,
  aiScore,
  critique,
  humanAvg: initialHumanAvg,
  agentRatings,
  isOwner,
  existingRating,
  isLoggedIn,
}: PhotoViewProps) {
  const [sliderValue, setSliderValue] = useState(3.0);
  const [userScore, setUserScore] = useState<number | null>(existingRating);
  const [humanAvg, setHumanAvg] = useState(initialHumanAvg);
  const [phase, setPhase] = useState<RevealPhase>(
    existingRating !== null || isOwner ? "done" : "idle"
  );
  const [error, setError] = useState<string | null>(null);

  const revealed = phase === "done" || isOwner;
  const rated = userScore !== null;

  const cascadeTo = useCallback((phases: RevealPhase[]) => {
    let total = 0;
    for (const p of phases) {
      total += PHASE_DELAYS[p] ?? 300;
      setTimeout(() => setPhase(p), total);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!isLoggedIn) {
      setError("Sign in to rate");
      return;
    }
    setError(null);
    setPhase("submitting");

    try {
      const result = await submitRating(photoId, sliderValue);
      setUserScore(result.userScore);
      setHumanAvg(result.humanAvg);
      setPhase("revealing");
      cascadeTo(["your-score", "rings", "agents", "critique", "done"]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit");
      setPhase("idle");
    }
  }, [photoId, sliderValue, isLoggedIn, cascadeTo]);

  const phaseReached = (target: RevealPhase): boolean => {
    const order: RevealPhase[] = [
      "idle",
      "submitting",
      "revealing",
      "your-score",
      "rings",
      "agents",
      "critique",
      "done",
    ];
    return order.indexOf(phase) >= order.indexOf(target);
  };

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Photo */}
      <div className="relative aspect-square bg-gray-900 rounded-xl overflow-hidden">
        <img
          src={imageUrl}
          alt={`Photo by ${username}`}
          className="w-full h-full object-cover"
        />
        {category && (VALID_CATEGORIES as readonly string[]).includes(category.toLowerCase()) && (
          <span className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm text-xs text-cyan-400 uppercase tracking-wider px-2.5 py-1 rounded-full">
            {category}
          </span>
        )}
      </div>

      <p className="text-sm text-gray-500 mt-3">@{username}</p>

      {/* === REVEALING ANIMATION === */}
      {phase === "revealing" && (
        <div className="flex items-center justify-center gap-2 py-10 animate-pulse">
          <svg viewBox="0 0 64 87" className="h-6 w-auto animate-spin">
            <polygon
              points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
              fill="#ff8a00"
            />
          </svg>
          <span className="text-xl font-bold text-human">REVEALING...</span>
        </div>
      )}

      {/* === LOCKED STATE: not rated, not owner === */}
      {!rated && !isOwner && phase !== "revealing" && (
        <div className="mt-6 space-y-6">
          {/* Locked scores */}
          <div className="bg-card border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-center gap-2 text-gray-500 mb-4">
              <span className="text-lg">🔒</span>
              <span className="text-sm">Hidden until you rate</span>
            </div>
            <div className="flex items-center justify-center gap-8">
              <div className="relative">
                <ScoreRing score={null} size={80} dimmed label="AI" />
              </div>
              <div className="relative">
                <ScoreRing score={null} size={80} dimmed label="Human" />
              </div>
            </div>
          </div>

          {/* Slider */}
          <div className="bg-card border border-gray-800 rounded-xl p-6">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-4 text-center">
              Your rating
            </p>
            <JouleSlider
              value={sliderValue}
              onChange={setSliderValue}
              disabled={phase === "submitting"}
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={phase === "submitting"}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-deepblue to-blue
                       text-white font-semibold py-3.5 rounded-xl transition-all
                       hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] active:scale-[0.98]
                       disabled:opacity-50 disabled:pointer-events-none"
          >
            <svg viewBox="0 0 64 87" className="h-4 w-auto">
              <polygon
                points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                fill="currentColor"
              />
            </svg>
            {phase === "submitting" ? "Submitting..." : "Submit Rating"}
          </button>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
        </div>
      )}

      {/* === CASCADING REVEAL / FULL VIEW === */}
      {(revealed || phaseReached("your-score")) && (
        <div className="mt-6 space-y-5">
          {/* Your rating */}
          {userScore !== null && (
            <div
              className={`bg-card border border-gray-800 rounded-xl p-5 text-center transition-all duration-500
                ${phaseReached("your-score") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                Your rating
              </p>
              <div className="flex items-center justify-center gap-2">
                <svg viewBox="0 0 64 87" className="h-5 w-auto">
                  <polygon
                    points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                    fill="#ff8a00"
                  />
                </svg>
                <span className="text-3xl font-bold tabular-nums text-blue">
                  {userScore.toFixed(1)}
                </span>
                <span className="text-gray-500">/5</span>
              </div>
            </div>
          )}

          {/* AI vs Human rings */}
          <div
            className={`bg-card border border-gray-800 rounded-xl p-6 transition-all duration-500
              ${phaseReached("rings") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
          >
            <div className="flex items-center justify-center gap-10">
              <div className="relative">
                <ScoreRing
                  score={phaseReached("rings") ? aiScore : null}
                  size={96}
                  strokeWidth={6}
                  label="AI"
                />
              </div>
              <div className="relative">
                <ScoreRing
                  score={phaseReached("rings") ? humanAvg : null}
                  size={96}
                  strokeWidth={6}
                  label="Human"
                />
              </div>
            </div>
          </div>

          {/* Agent breakdown */}
          {agentRatings.length > 0 && (
            <div
              className={`bg-card border border-gray-800 rounded-xl p-5 transition-all duration-500
                ${phaseReached("agents") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                Agent breakdown
              </p>
              <div className="space-y-3">
                {agentRatings.map((ar, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3"
                  >
                    <AgentBadge
                      name={ar.agent.name}
                      modelId={ar.agent.modelId}
                      verified={ar.agent.verified}
                      color={ar.agent.color}
                    />
                    <span className="text-sm font-mono text-blue tabular-nums">
                      {phaseReached("agents") ? ar.score.toFixed(1) : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Critique */}
          {critique && (
            <div
              className={`bg-card border border-gray-800 rounded-xl p-5 transition-all duration-500
                ${phaseReached("critique") ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
            >
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                AI critique
              </p>
              <p className="text-sm text-gray-300 leading-relaxed">
                {critique}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
