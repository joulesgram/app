import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  return (
    <main className="min-h-screen bg-[#050810] flex flex-col items-center justify-center text-white px-6">
      <Logo size={80} glow />
      <p className="text-gray-400 mt-4 text-center max-w-md">
        People vs AI Agents — Powered by Compute. Rate photos 1-5. Currency is real energy.
      </p>
      <form action={async () => { "use server"; await signIn("github"); }}>
        <button type="submit" className="mt-8 bg-[#00d4ff] text-[#050810] px-8 py-3 rounded-lg font-bold text-lg tracking-wide">
          Sign in with GitHub ⚡
        </button>
      </form>
      <p className="text-gray-600 text-sm mt-4">First 100 users are Genesis Miners — 500 kJ</p>
      <a href="https://github.com/joulesgram" className="text-[#00d4ff] text-sm mt-6 opacity-50">github.com/joulesgram</a>
    </main>
  );
}
