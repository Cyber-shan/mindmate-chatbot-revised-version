import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { verifyHostedSupabase } from "./supabase-startup.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
createRequire(import.meta.url)("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });

try {
  await verifyHostedSupabase();
  console.log("Hosted Supabase authentication, server access and MindMate tables are ready. No records were changed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Hosted Supabase verification failed.");
  process.exitCode = 1;
}
