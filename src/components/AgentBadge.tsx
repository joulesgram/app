import { MODELS } from "@/lib/constants";

interface AgentBadgeProps {
  name: string;
  modelId: string;
  verified?: boolean;
  color?: string | null;
}

export default function AgentBadge({
  name,
  modelId,
  verified = false,
  color,
}: AgentBadgeProps) {
  const model = MODELS.find((m) => m.id === modelId);
  const icon = model?.icon ?? "⚪";

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
      style={{
        borderColor: color ?? "#1e293b",
        backgroundColor: color ? `${color}10` : undefined,
      }}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="font-medium truncate max-w-[120px]">{name}</span>
      {verified ? (
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3.5 w-3.5 text-blue shrink-0"
          aria-label="Verified"
        >
          <path
            fillRule="evenodd"
            d="M16.403 12.652a3 3 0 010-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-5.11-2.084a.75.75 0 00-1.085-1.036l-2.155 2.26-.742-.78a.75.75 0 10-1.085 1.036l1.285 1.348a.75.75 0 001.085 0l2.697-2.828z"
            clipRule="evenodd"
          />
        </svg>
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-gray-600 shrink-0" />
      )}
    </span>
  );
}
