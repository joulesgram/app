import ScoreRing from "./ScoreRing";

interface PhotoCardProps {
  imageUrl: string;
  username: string;
  category?: string | null;
  aiScore: number | null;
  humanScore: number | null;
  isOwner?: boolean;
  hasRated?: boolean;
  onRate?: () => void;
}

export default function PhotoCard({
  imageUrl,
  username,
  category,
  aiScore,
  humanScore,
  isOwner = false,
  hasRated = false,
  onRate,
}: PhotoCardProps) {
  const revealed = isOwner || hasRated;

  return (
    <div className="bg-card border border-gray-800 rounded-xl overflow-hidden group">
      {/* Image */}
      <div className="relative aspect-square bg-gray-900">
        <img
          src={imageUrl}
          alt={`Photo by ${username}`}
          className="w-full h-full object-cover"
        />
        {category && (
          <span className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-[11px] text-gray-300 px-2 py-0.5 rounded-full">
            {category}
          </span>
        )}
      </div>

      {/* Footer */}
      <div className="p-3">
        <p className="text-xs text-gray-500 mb-3">@{username}</p>

        {revealed ? (
          /* Scores visible */
          <div className="flex items-center justify-center gap-6">
            <div className="relative">
              <ScoreRing score={aiScore} size={64} label="AI" />
            </div>
            <div className="relative">
              <ScoreRing score={humanScore} size={64} label="Human" />
            </div>
          </div>
        ) : (
          /* Scores hidden — prompt to rate */
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center justify-center gap-6">
              <div className="relative">
                <ScoreRing score={null} size={64} dimmed label="AI" />
              </div>
              <div className="relative">
                <ScoreRing score={null} size={64} dimmed label="Human" />
              </div>
            </div>
            <button
              onClick={onRate}
              className="flex items-center gap-1.5 text-sm text-human hover:text-orange-300 transition-colors"
            >
              <svg viewBox="0 0 64 87" className="h-3.5 w-auto">
                <polygon
                  points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                  fill="currentColor"
                />
              </svg>
              Rate to reveal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
