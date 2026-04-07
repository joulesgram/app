import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import Logo from "@/components/Logo";
import BottomNav from "@/components/BottomNav";
import IssuancePolicyLink from "@/components/IssuancePolicyLink";
import UploadForm from "./UploadForm";

export default async function UploadPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <main className="min-h-screen px-4 py-8 pb-24">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center justify-between mb-8">
          <Logo className="text-2xl" />
          <div className="flex items-center gap-3">
            <IssuancePolicyLink />
            <div className="text-right">
              <p className="text-xs text-gray-500">@{session.user.username ?? "user"}</p>
              <p className="text-sm font-mono text-blue">
                {Math.floor((session.user.joulesBalance ?? 0) / 1000).toLocaleString()} kJ
              </p>
            </div>
          </div>
        </div>

        <h1 className="text-2xl font-bold mb-6">Upload Photo</h1>

        <UploadForm />
      </div>
      <BottomNav />
    </main>
  );
}
