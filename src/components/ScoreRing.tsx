interface ScoreRingProps {
  score: number | null;
  size?: number;
  strokeWidth?: number;
  dimmed?: boolean;
  label?: string;
}

export default function ScoreRing({
  score,
  size = 72,
  strokeWidth = 5,
  dimmed = false,
  label,
}: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score !== null ? score / 5 : 0;
  const offset = circumference * (1 - progress);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="rotate-[-90deg]">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={dimmed ? "#1a1f2e" : "#1a1f2e"}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={dimmed ? "#2a2f3e" : "#00d4ff"}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500 ease-out"
          />
        )}
      </svg>
      {/* Centered score */}
      <div
        className="absolute flex flex-col items-center justify-center"
        style={{ width: size, height: size }}
      >
        {score !== null ? (
          <>
            <span
              className="font-bold leading-none text-blue"
              style={{ fontSize: size * 0.3 }}
            >
              {score.toFixed(1)}
            </span>
            <span
              className="text-gray-500 leading-none"
              style={{ fontSize: size * 0.16 }}
            >
              /5
            </span>
          </>
        ) : (
          <span
            className="text-gray-600 leading-none"
            style={{ fontSize: size * 0.22 }}
          >
            —
          </span>
        )}
      </div>
      {label && (
        <span className="text-[10px] text-gray-500 uppercase tracking-wider">
          {label}
        </span>
      )}
    </div>
  );
}
