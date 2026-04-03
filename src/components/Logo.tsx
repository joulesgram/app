export default function Logo({
  className = "",
  size,
  glow,
}: {
  className?: string;
  size?: number;
  glow?: boolean;
}) {
  const style = size ? { fontSize: `${size}px` } : undefined;

  return (
    <span
      className={`inline-flex items-center font-bold tracking-tight select-none ${
        glow ? "drop-shadow-[0_0_24px_rgba(0,212,255,0.5)]" : ""
      } ${className}`}
      style={style}
    >
      <span className="text-blue">JOUL</span>
      <svg
        viewBox="0 0 64 87"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-[0.85em] w-auto mx-[-0.05em] translate-y-[0.02em]"
      >
        <polygon
          points="40,0 14,38 30,38 8,87 55,42 35,42 58,0"
          fill="currentColor"
          className="text-human"
        />
      </svg>
      <span className="text-blue">GRAM</span>
    </span>
  );
}
