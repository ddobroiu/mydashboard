"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export async function login(_prev: string | null, formData: FormData): Promise<string | null> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/dashboard",
    });
    return null;
  } catch (e) {
    if (e instanceof AuthError) return "Email sau parolă greșită.";
    throw e; // redirect-ul NEXT_REDIRECT trebuie lasat sa treaca
  }
}
