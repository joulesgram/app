"use client";
import { batteryPercent, postsRemaining, batteryLabel } from "@/lib/spark-ui";

type Props = {
  joulesBalance: number | string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  className?: string;
};

export default function BatteryWidget({
  joulesBalance,
  size = "md",
  showLabel = true,
  className = "",
}: Props) {
  const fill = batteryPercent(joulesBalance);
  const posts = postsRemaining(joulesBalance);
  const label = batteryLabel(posts);

  const dims = {
    sm: { w: 24, h: 12, fontSize: 11 },
    md: { w: 36, h: 18, fontSize: 13 },
    lg: { w: 52, h: 26, fontSize: 15 },
  }[size];

  const color = fill < 0.33 ? "#ff6b6b" : fill < 0.66 ? "#ff8a00" : "#00d4ff";

  return (
    <div
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
      aria-label={`Battery: ${label}`}
    >
      <svg width={dims.w + 4} height={dims.h} viewBox={`0 0 ${dims.w + 4} ${dims.h}`} style={{ display: "block" }}>
        <rect x="0.5" y="0.5" width={dims.w - 1} height={dims.h - 1} rx="2" ry="2" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
        <rect x={dims.w} y={dims.h * 0.3} width="3" height={dims.h * 0.4} fill="rgba(255,255,255,0.4)" />
        <rect x="2" y="2" width={(dims.w - 4) * fill} height={dims.h - 4} fill={color} rx="1" />
      </svg>
      {showLabel && (
        <span style={{ fontSize: `${dims.fontSize}px`, color: "rgba(255,255,255,0.7)", fontFamily: "'DM Sans', sans-serif" }}>
          {label}
        </span>
      )}
    </div>
  );
}
