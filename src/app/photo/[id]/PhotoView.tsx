"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ScoreRing from "@/components/ScoreRing";
import JouleSlider from "@/components/JouleSlider";
import AgentBadge from "@/components/AgentBadge";
import { submitRating } from "./actions";
import { RATING_KJ } from "@/lib/constants";

interface AgentRatingData {
  score: number;
  critique: string | null;
  agent: {
    name: string;
    verified: boolean;
    color: string | null;
  };
}

interface PhotoViewProps {
  photoId: string;
  imageUrl: string;
  username: string;
  aiScore: number | null;
  critique: string | null;
  humanAvg: number | null;
  agentRatings: AgentRatingData[];
  isOwner: boolean;
  existingRating: number | null;
  isLoggedIn: boolean;
  nextPhotoId: string | null;
}

type Phase = "idle" | "submitting" | "revealing" | "done";

export default function PhotoView({
  photoId,
  imageUrl,
  username,
  aiScore,
  critique,
  humanAvg: initialHumanAvg,
  agentRatings,
  isOwner,
  existingRating,
  isLoggedIn,
  nextPhotoId,
}: PhotoViewProps) {
  const router = useRouter();
  const alreadyRevealed = existingRating !== null || isOwner;

  const [sliderValue, setSliderValue] = useState(3.0);
  const [userScore, setUserScore] = useState<number | null>(existingRating);
  const [humanAvg, setHumanAvg] = useState(initialHumanAvg);
  const [phase, setPhase] = useState<Phase>(alreadyRevealed ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [shouldFocusNext, setShouldFocusNext] = useState(false);
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  const showScores = phase === "done";
  const showRatingForm = !alreadyRevealed && userScore === null && phase !== "revealing";

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
      // Transition to done after a short reveal animation. Stay on this
      // photo so the user can read the AI agent ratings; they advance
      // manually via the "Next photo →" button below.
      setTimeout(() => {
        setPhase("done");
        setShouldFocusNext(true);
      }, 1200);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to submit rating";
      setError(msg);
      setPhase("idle");
    }
  }, [photoId, sliderValue, isLoggedIn]);

  // After a fresh reveal, move keyboard focus to the "Next photo" button
  // so Enter advances without tabbing. Only triggered by a completed
  // submission — never on initial mount for already-rated photos.
  useEffect(() => {
    if (shouldFocusNext && nextButtonRef.current) {
      nextButtonRef.current.focus();
      setShouldFocusNext(false);
    }
  }, [shouldFocusNext]);

  return (
    <div className="w-full max-w-lg mx-auto">
      {/* Photo */}
      <div className="relative aspect-square bg-gray-900 rounded-xl overflow-hidden">
        <img
          src={imageUrl}
          alt={`Photo by ${username}`}
          className="w-full h-full object-cover"
        />
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

      {/* === RATING FORM: only if not owner, not yet rated === */}
      {showRatingForm && (
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
          <p className="text-center text-xs text-gray-500">
            Rating costs {RATING_KJ} kJ.
          </p>

          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
        </div>
      )}

      {/* === SCORES REVEALED === */}
      {showScores && (
        <div className="mt-6 space-y-5">
          {/* Your rating (if you rated) */}
          {userScore !== null && (
            <div className="bg-card border border-gray-800 rounded-xl p-5 text-center">
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
              <p className="text-xs text-gray-500 mt-2">
                You spent {RATING_KJ} kJ to reveal scores.
              </p>
            </div>
          )}

          {userScore !== null && nextPhotoId && (
            <button
              ref={nextButtonRef}
              onClick={() => router.push(`/photo/${nextPhotoId}`)}
              className="w-full py-3 rounded-xl border border-gray-700 text-gray-300 text-sm
                         hover:border-blue hover:text-blue transition-colors
                         focus:outline-none focus:border-blue focus:text-blue"
            >
              Next photo →
            </button>
          )}

          {/* AI vs Human rings */}
          <div className="bg-card border border-gray-800 rounded-xl p-6">
            <div className="flex items-center justify-center gap-10">
              <div className="relative">
                <ScoreRing score={aiScore} size={96} strokeWidth={6} label="AI" />
              </div>
              <div className="relative">
                <ScoreRing score={humanAvg} size={96} strokeWidth={6} label="Human" />
              </div>
            </div>
          </div>

          {/* Agent breakdown */}
          {agentRatings.length > 0 && (
            <div className="bg-card border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                Agent breakdown
              </p>
              <div className="space-y-3">
                {agentRatings.map((ar, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <AgentBadge
                      name={ar.agent.name}
                      verified={ar.agent.verified}
                      color={ar.agent.color}
                    />
                    <span className="text-sm font-mono text-blue tabular-nums">
                      {ar.score.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Critique */}
          {critique && (
            <div className="bg-card border border-gray-800 rounded-xl p-5">
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
