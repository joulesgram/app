"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createPhoto } from "./actions";
import { PHOTO_SCORE_KJ, PUBLISH_THRESHOLD } from "@/lib/constants";
import { fmtJ } from "@/lib/joules";

type UploadState = "idle" | "preview" | "uploading" | "scoring" | "done" | "error";

interface ScoreResult {
  photoId: string;
  aiScore: number | null;
  critique: string;
  nsfw: boolean;
  published: boolean;
  agentScores: { agentName: string; score: number; critique: string }[];
  computeKJ: number;
  computeJoules: number;
  tokens: { input: number; output: number };
}

export default function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScoreResult | null>(null);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Please select an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10 MB");
      return;
    }

    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setPreview(url);
      setDataUrl(url);
      setState("preview");
    };
    reader.readAsDataURL(file);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!dataUrl) return;

    setError(null);
    setState("uploading");

    try {
      // 1. Create photo record
      const response = await createPhoto(dataUrl);

      // Guard: server action might return undefined if something goes wrong
      if (!response || !response.photoId) {
        throw new Error("Failed to create photo — please try again");
      }

      const photoId = response.photoId;

      // 2. Call score API
      setState("scoring");
      const res = await fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Scoring failed");
      }

      const scoreResult: ScoreResult = await res.json();
      setResult(scoreResult);
      setState("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
      setState("error");
    }
  }, [dataUrl]);

  const handleReset = useCallback(() => {
    setState("idle");
    setPreview(null);
    setDataUrl(null);
    setError(null);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  return (
    <div className="w-full max-w-lg mx-auto space-y-6">
      {/* Drop zone / file picker */}
      {(state === "idle" || state === "error") && (
        <label className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-gray-700 hover:border-blue rounded-xl p-10 cursor-pointer transition-colors bg-card">
          <svg viewBox="0 0 64 87" className="h-10 w-auto opacity-40">
            <polygon
              points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
              fill="#ff8a00"
            />
          </svg>
          <p className="text-gray-400 text-sm">
            Drop a photo or <span className="text-blue underline">browse</span>
          </p>
          <p className="text-gray-600 text-xs">JPEG, PNG, WebP up to 10 MB</p>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFile}
            className="hidden"
          />
        </label>
      )}

      {/* Preview */}
      {preview && state !== "idle" && (
        <div className="relative aspect-square bg-gray-900 rounded-xl overflow-hidden">
          <img
            src={preview}
            alt="Upload preview"
            className="w-full h-full object-cover"
          />
          {result?.nsfw && (
            <div className="absolute inset-0 bg-red-900/80 flex items-center justify-center">
              <span className="text-white font-bold text-lg">
                NSFW Detected
              </span>
            </div>
          )}
        </div>
      )}

      {/* Submit button */}
      {state === "preview" && (
        <div className="space-y-3">
          <button
            onClick={handleSubmit}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-deepblue to-blue
                       text-white font-semibold py-3.5 rounded-xl transition-all
                       hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] active:scale-[0.98]"
          >
            <svg viewBox="0 0 64 87" className="h-4 w-auto">
              <polygon
                points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                fill="currentColor"
              />
            </svg>
            Upload &amp; Score
          </button>
          <p className="text-center text-xs text-gray-500">
            Costs {fmtJ(PHOTO_SCORE_KJ)} for AI scoring. You earn 5 kJ for
            uploading.
          </p>
        </div>
      )}

      {/* Progress states */}
      {state === "uploading" && (
        <div className="flex items-center justify-center gap-3 py-6">
          <div className="h-5 w-5 border-2 border-blue border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400">Creating photo...</span>
        </div>
      )}

      {state === "scoring" && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="flex items-center gap-2 animate-pulse">
            <svg viewBox="0 0 64 87" className="h-6 w-auto animate-spin">
              <polygon
                points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                fill="#ff8a00"
              />
            </svg>
            <span className="text-xl font-bold text-human">SCORING...</span>
          </div>
          <p className="text-xs text-gray-500">
            AI agents are evaluating your photo
          </p>
        </div>
      )}

      {/* Results */}
      {state === "done" && result && (
        <div className="space-y-4">
          {/* Overall score */}
          <div className="bg-card border border-gray-800 rounded-xl p-5 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              AI Score
            </p>
            <div className="flex items-center justify-center gap-2">
              <svg viewBox="0 0 64 87" className="h-6 w-auto">
                <polygon
                  points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                  fill="#ff8a00"
                />
              </svg>
              <span className="text-4xl font-bold tabular-nums text-blue">
                {result.aiScore?.toFixed(1) ?? "—"}
              </span>
              <span className="text-lg text-gray-500">/5</span>
            </div>
            <div className="mt-2">
              {result.published ? (
                <span className="text-xs text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                  Published
                </span>
              ) : (
                <span className="text-xs text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                  Below threshold ({PUBLISH_THRESHOLD}/5)
                </span>
              )}
            </div>
          </div>

          {/* Critique */}
          <div className="bg-card border border-gray-800 rounded-xl p-5">
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">
              AI Critique
            </p>
            <p className="text-sm text-gray-300 leading-relaxed">
              {result.critique}
            </p>
          </div>

          {/* Agent breakdown */}
          {result.agentScores.length > 0 && (
            <div className="bg-card border border-gray-800 rounded-xl p-5">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">
                Agent Breakdown
              </p>
              <div className="space-y-3">
                {result.agentScores.map((a, i) => (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{a.agentName}</span>
                      <span className="text-sm font-mono tabular-nums text-blue">
                        {a.score.toFixed(1)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{a.critique}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compute cost */}
          <div className="bg-card border border-gray-800 rounded-xl p-4 flex items-center justify-between text-xs text-gray-500">
            <span>
              Compute: {result.computeJoules.toFixed(2)} J ({result.tokens.input}
              + {result.tokens.output} tokens)
            </span>
            <span>{result.computeKJ.toFixed(3)} kJ</span>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => router.push(`/photo/${result.photoId}`)}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-deepblue to-blue text-white font-semibold text-sm
                         hover:shadow-[0_0_24px_rgba(0,212,255,0.3)] transition-all"
            >
              View Photo
            </button>
            <button
              onClick={handleReset}
              className="flex-1 py-3 rounded-xl border border-gray-700 text-gray-400 font-semibold text-sm
                         hover:border-gray-500 transition-colors"
            >
              Upload Another
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-xl p-4">
          <p className="text-red-400 text-sm">{error}</p>
          {state === "error" && (
            <button
              onClick={handleReset}
              className="mt-2 text-xs text-gray-400 underline hover:text-gray-300"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
