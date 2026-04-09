"use client";

import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "joulegram-install-dismissed";
const DISMISS_DAYS = 14;

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed (standalone mode)
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    // Don't show if recently dismissed
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed) {
      const dismissedAt = parseInt(dismissed, 10);
      if (Date.now() - dismissedAt < DISMISS_DAYS * 24 * 60 * 60 * 1000) return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible) return null;

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-50 mx-auto max-w-md animate-slide-up"
      role="alert"
    >
      <div
        className="rounded-2xl border border-white/10 p-4"
        style={{ backgroundColor: "#0a0e18" }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: "rgba(0,212,255,0.12)" }}
          >
            <svg
              viewBox="0 0 64 87"
              fill="none"
              className="h-5 w-5"
            >
              <polygon
                points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                fill="#ff8a00"
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white">
              Add Joulegram to Home Screen
            </p>
            <p className="mt-0.5 text-xs" style={{ color: "#94a3b8" }}>
              Get the full-screen app experience with faster load times.
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 p-1 text-white/40 hover:text-white/70"
            aria-label="Dismiss"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <button
          onClick={handleInstall}
          className="mt-3 w-full rounded-lg py-2 text-sm font-semibold text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: "#00d4ff" }}
        >
          Install App
        </button>
      </div>
    </div>
  );
}
