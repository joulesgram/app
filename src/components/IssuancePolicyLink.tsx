export const ISSUANCE_POLICY_URL = "https://joulegram-website.vercel.app/policy.html";

export default function IssuancePolicyLink({
  className = "text-xs px-3 py-1.5 border border-gray-700 rounded-full text-gray-300 hover:text-[#00d4ff] hover:border-[#00d4ff] transition-colors",
  children = "Issuance policy",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={ISSUANCE_POLICY_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}
