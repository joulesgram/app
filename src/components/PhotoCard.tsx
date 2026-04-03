import ScoreRing from "./ScoreRing";

interface PhotoCardProps {
  imageUrl: string;
  username: string;
  aiScore: number | null;
  humanScore: number | null;
  isOwner?: boolean;
  hasRated?: boolean;
}

export default function PhotoCard({
  imageUrl,
  username,
  aiScore,
  humanScore,
  isOwner = false,
  hasRated = false,
}: PhotoCardProps) {
  const revealed = isOwner || hasRated;

  return (
    <div className="bg-card border border-gray-800 rounded-xl overflow-hidden">
      {/* Image — overflow-hidden ensures nothing leaks out */}
      <div className="relative aspect-square bg-gray-900 overflow-hidden">
        <img
          src={imageUrl}
          alt={`Photo by ${username}`}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Footer */}
      <div className="p-3">
        <p className="text-xs text-gray-500 mb-3">@{username}</p>

        {revealed ? (
          <div className="flex items-center justify-center gap-6">
            <div className="relative">
              <ScoreRing score={aiScore} size={64} label="AI" />
            </div>
            <div className="relative">
              <ScoreRing score={humanScore} size={64} label="Human" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center justify-center gap-6">
              <div className="relative">
                <ScoreRing score={null} size={64} dimmed label="AI" />
              </div>
              <div className="relative">
                <ScoreRing score={null} size={64} dimmed label="Human" />
              </div>
            </div>
            {/* span, not button — this lives inside a <Link> on the feed page.
                A <button> inside <a> is invalid HTML and breaks click
                propagation on mobile browsers. */}
            <span className="flex items-center gap-1.5 text-sm text-human cursor-pointer">
              <svg viewBox="0 0 64 87" className="h-3.5 w-auto">
                <polygon
                  points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
                  fill="currentColor"
                />
              </svg>
              Rate to reveal
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
