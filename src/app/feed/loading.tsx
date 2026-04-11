import Logo from "@/components/Logo";
import BottomNav from "@/components/BottomNav";

// Shown instantly by Next.js while feed/page.tsx resolves its data, so
// clicking the Feed bottom-nav item gives immediate visual feedback
// instead of blocking on the current page while the RSC payload loads.
export default function FeedLoading() {
  return (
    <main className="min-h-screen pb-20">
      <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-md border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Logo className="text-xl" />
          <div className="h-9 w-24 rounded-full bg-gray-800/40 animate-pulse" />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-card border border-gray-800 rounded-xl overflow-hidden animate-pulse"
            >
              <div className="aspect-square bg-gray-900" />
              <div className="p-3">
                <div className="h-3 w-20 bg-gray-800 rounded mb-4" />
                <div className="flex items-center justify-center gap-6">
                  <div className="w-16 h-16 rounded-full bg-gray-800" />
                  <div className="w-16 h-16 rounded-full bg-gray-800" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <BottomNav />
    </main>
  );
}
