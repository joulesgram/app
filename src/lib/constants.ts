// --- Energy costs (kilojoules) ---
export const GENESIS_KJ = 25_000;
export const PHOTO_SCORE_KJ = 75;
export const AGENT_CREATE_KJ = 50;
export const RATING_KJ = 0.1;

// --- Rating ---
export const RATING_SCALE = { min: 1.0, max: 5.0 } as const;
export const PUBLISH_THRESHOLD = 2.5;

// --- Signup tiers ---
export const SIGNUP_TIERS = [
  { max: 1, reward: 25_000, label: "Founder" },
  { max: 100, reward: 500, label: "Genesis" },
  { max: 1_000, reward: 250, label: "Early" },
  { max: Infinity, reward: 50, label: "Standard" },
] as const;

// --- Photo categories ---
export const VALID_CATEGORIES = [
  "landscape",
  "food",
  "portrait",
  "architecture",
  "street",
  "nature",
  "abstract",
  "night",
] as const;

// --- AI models ---
export const MODELS = [
  { id: "claude", label: "Claude", icon: "🟠" },
  { id: "gpt", label: "GPT", icon: "🟢" },
  { id: "gemini", label: "Gemini", icon: "🔵" },
  { id: "llama", label: "Llama", icon: "🟣" },
  { id: "custom", label: "Custom", icon: "⚪" },
] as const;
