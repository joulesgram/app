"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/feed", label: "Feed", emoji: "🏠" },
  { href: "/upload", label: "Upload", emoji: "➕" },
  { href: "/agents", label: "Agents", emoji: "🤖" },
] as const;

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-[#050810]/90 backdrop-blur-md border-t border-gray-800">
      <div className="max-w-2xl mx-auto flex items-center justify-around py-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 text-xs font-medium py-1 px-3 transition-colors ${
                active ? "text-[#00d4ff]" : "text-gray-400 hover:text-[#00d4ff]"
              }`}
            >
              <span className="text-lg">{item.emoji}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
