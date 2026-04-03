"use server";

import { signIn } from "@/lib/auth";

export async function signInWithGitHub() {
  await signIn("github");
}
