import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect("/feed");

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">JOUL⚡GRAM</h1>
          <p className="mt-2 text-sm text-gray-600">
            Enter your email and we'll send you a sign-in link.
          </p>
        </div>
        <form
          action={async (formData) => {
            "use server";
            await signIn("resend", {
              email: formData.get("email") as string,
              redirectTo: "/feed",
            });
          }}
          className="space-y-3"
        >
          <input
            type="email"
            name="email"
            placeholder="you@example.com"
            required
            className="w-full rounded-lg border px-4 py-3"
          />
          <button
            type="submit"
            className="w-full rounded-lg bg-black px-4 py-3 text-white font-medium hover:bg-gray-800"
          >
            Send magic link
          </button>
        </form>
      </div>
    </div>
  );
}
