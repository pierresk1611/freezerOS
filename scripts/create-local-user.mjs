import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { localConfig } from "./local-env.mjs";
const parsed = z
  .object({ email: z.string().email(), password: z.string().min(8).max(200) })
  .safeParse({
    email: process.env.FREEZER_LOCAL_EMAIL,
    password: process.env.FREEZER_LOCAL_PASSWORD,
  });
if (!parsed.success)
  throw new Error(
    "Set FREEZER_LOCAL_EMAIL and FREEZER_LOCAL_PASSWORD securely before running this local-only command.",
  );
const config = localConfig();
const client = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const { error } = await client.auth.admin.createUser({
  ...parsed.data,
  email_confirm: true,
});
if (error) throw new Error("Account creation failed: " + error.code);
console.log("Lokálny účet bol vytvorený. Prihláste sa v aplikácii.");
