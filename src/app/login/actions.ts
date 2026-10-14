"use server";
import { db } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { z } from "zod";
export async function login(form: FormData) {
  const parsed = z
    .object({ email: z.string().email(), password: z.string().min(8).max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) redirect("/login?error=invalid");
  const client = await db();
  const { error } = await client.auth.signInWithPassword(parsed.data);
  if (error) {
    console.error("Sign-in failed", error.status, error.code);
    redirect("/login?error=auth");
  }
  redirect("/");
}
export async function logout() {
  const client = await db();
  await client.auth.signOut();
  redirect("/login");
}
