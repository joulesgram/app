"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    plausible?: (eventName: string, options?: { props?: Record<string, string> }) => void;
    posthog?: { capture: (eventName: string, properties?: Record<string, string>) => void };
    gtag?: (command: "event", eventName: string, params?: Record<string, string>) => void;
  }
}

export default function JoinAnalytics() {
  useEffect(() => {
    const payload = { page: "join" };
    window.plausible?.("join_page_view", { props: payload });
    window.posthog?.capture("join_page_view", payload);
    window.gtag?.("event", "join_page_view", payload);
  }, []);

  return null;
}
