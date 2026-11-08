import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export function requireLocalHttpUrl(value, service) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${service} URL is missing or invalid. Check .env.local.`); }
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password) {
    throw new Error(`${service} must use a local HTTP URL for this launcher.`);
  }
  return url;
}

export async function waitUntil(check, {
  description, signal, timeoutMs = 120_000, intervalMs = 1000,
  now = () => performance.now(), pause = (ms) => sleep(ms, undefined, { signal }),
} = {}) {
  const started = now();
  while (now() - started < timeoutMs) {
    signal?.throwIfAborted();
    if (await check()) return;
    await pause(intervalMs);
  }
  throw new Error(`${description} did not become ready. Open the application to check its startup status, then retry.`);
}

/** Independent services start together; generation warm-up waits for both to be ready. */
export async function prepareLocalServices({
  supabaseReady, ensureDocker, startSupabase, ollamaReady, startOllama, warmup,
  log = () => {}, signal,
}) {
  await Promise.all([
    (async () => {
      if (await supabaseReady()) { log("Supabase is already ready."); return; }
      await ensureDocker();
      log("Starting Supabase; initial startup can take a few minutes...");
      await startSupabase();
      await waitUntil(supabaseReady, { description: "Supabase", signal, timeoutMs: 30_000 });
      log("Supabase is ready.");
    })(),
    (async () => {
      if (await ollamaReady()) { log("Ollama is already ready."); return; }
      log("Starting Ollama...");
      await startOllama();
      await waitUntil(ollamaReady, { description: "Ollama", signal, timeoutMs: 60_000 });
      log("Ollama is ready.");
    })(),
  ]);
  signal?.throwIfAborted();
  log("Preparing the installed chatbot model...");
  await warmup();
}

/** CLI startup output can include local API keys. Keep them out of error messages. */
export function safeStartupOutput(output) {
  return output.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split(/\r?\n/)
    .filter((line) => line.length < 1500 && !/(?:secret|password|token|authorization|service.role|publishable|anon.?key|postgres(?:ql)?:\/\/)/i.test(line))
    .map((line) => line.replace(/eyJ[A-Za-z0-9_.-]+|sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[REDACTED]"))
    .filter(Boolean).slice(-8).join("\n");
}

/** Quote the literal executable path; encoded PowerShell avoids native-shell quoting surprises. */
export function hiddenWindowsLaunchArgs(executable) {
  const literal = executable.replace(/'/g, "''");
  const command = `Start-Process -FilePath '${literal}' -WindowStyle Hidden`;
  return ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64")];
}

/** Rebuild the demo only when build inputs change. File contents, not timestamps, are compared. */
export async function buildFingerprint(root) {
  const hash = createHash("sha256");
  hash.update(`node:${process.versions.node}\n`);
  async function include(relative) {
    const absolute = path.join(root, relative);
    let entries;
    try { entries = await readdir(absolute, { withFileTypes: true }); }
    catch (error) {
      if (error.code === "ENOTDIR") { hash.update(relative); hash.update(await readFile(absolute)); return; }
      if (error.code === "ENOENT") { hash.update(`missing:${relative}`); return; }
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory() || entry.isFile()) await include(child);
    }
  }
  for (const relative of ["app", "components", "lib", "public", "package.json", "package-lock.json", "tsconfig.json", "next.config.ts", "next.config.js", "next.config.mjs", "postcss.config.mjs", ".env", ".env.local", ".env.production", ".env.production.local"]) await include(relative);
  // Public environment variables are embedded into the browser build. Only a hash is saved.
  for (const key of Object.keys(process.env).filter((key) => key.startsWith("NEXT_PUBLIC_")).sort()) hash.update(`${key}=${process.env[key]}\n`);
  return hash.digest("hex");
}
