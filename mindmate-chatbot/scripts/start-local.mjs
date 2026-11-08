import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getOllamaConfig } from "../lib/chat-config.ts";
import { buildFingerprint, hiddenWindowsLaunchArgs, prepareLocalServices, requireLocalHttpUrl, safeStartupOutput, waitUntil } from "./local-startup.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const forwarded = process.argv.slice(2).filter((argument) => argument !== "--demo");
const demo = process.argv.includes("--demo");
process.chdir(root);
require("@next/env").loadEnvConfig(root, !demo, { info() {}, error() {} });
const config = getOllamaConfig();
const controller = new AbortController();
const children = new Set();
const executeFile = promisify(execFile);
const windows = process.platform === "win32";
const childEnv = { ...process.env, NODE_ENV: demo ? "production" : "development" };
const log = (message) => console.log(`[MindMate] ${message}`);
let stopping = false;

async function exists(filename) { try { await access(filename); return true; } catch { return false; } }

async function findExecutable(name, candidates = []) {
  const basename = windows ? `${name}.exe` : name;
  const locations = [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory.replace(/^"|"$/g, ""), basename)), ...candidates];
  for (const location of locations) if (await exists(location)) return location;
  return null;
}

const localPrograms = path.join(process.env.LOCALAPPDATA ?? "", "Programs");
const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
const dockerCandidates = [path.join(localPrograms, "DockerDesktop", "resources", "bin", "docker.exe"), path.join(programFiles, "Docker", "Docker", "resources", "bin", "docker.exe")];
const ollamaCandidates = [path.join(localPrograms, "Ollama", "ollama.exe")];

async function terminate(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (windows) {
    await executeFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 5000 }).catch(() => {});
  } else child.kill("SIGTERM");
}

async function cleanup() {
  controller.abort();
  await Promise.all([...children].map(terminate));
}

function run(executable, args, { inherit = false, timeoutMs = 0, background = false, env = childEnv } = {}) {
  controller.signal.throwIfAborted();
  const child = spawn(executable, args, { cwd: root, env, windowsHide: true, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
  children.add(child);
  let output = "";
  child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-64_000); });
  child.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-64_000); });
  const completion = new Promise((resolve, reject) => {
    let timer;
    if (timeoutMs) timer = setTimeout(() => { void terminate(child); reject(new Error(`Startup timed out while running ${path.basename(executable)}.`)); }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); children.delete(child); reject(new Error(`Cannot start ${path.basename(executable)}: ${error.code ?? "unknown error"}.`)); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer); children.delete(child);
      if (stopping) { resolve(); return; }
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} stopped (${code ?? signal}).${inherit ? "" : `\n${safeStartupOutput(output)}`}`));
    });
  });
  if (background) {
    // A background service failure aborts startup or the running app, without an unhandled rejection.
    const failed = (error) => { if (!stopping) { console.error(`[MindMate] ${error.message}`); void stop(1); } };
    completion.then(() => failed(new Error("The local Ollama server stopped unexpectedly.")), failed);
    return Promise.resolve();
  }
  return completion;
}

async function stop(code) {
  if (stopping) return;
  stopping = true;
  await cleanup();
  log("App stopped. Docker and Supabase remain available for the next run.");
  process.exit(code);
}
process.once("SIGINT", () => { void stop(0); });
process.once("SIGTERM", () => { void stop(0); });

async function probe(url, headers = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)]) });
    await response.arrayBuffer();
    return response.ok;
  } catch { return false; }
}

async function main() {
  const supabaseUrl = requireLocalHttpUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, "Supabase");
  const ollamaUrl = requireLocalHttpUrl(config.url, "Ollama");
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!publicKey) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing in .env.local.");
  log(`Starting the local ${demo ? "defense demo" : "development app"}...`);
  const supabaseReady = async () => {
    const results = await Promise.all([
      probe(new URL("/auth/v1/health", supabaseUrl)),
      probe(new URL("/rest/v1/", supabaseUrl), { apikey: publicKey }),
    ]);
    return results.every(Boolean);
  };
  const ollamaReady = () => probe(new URL("/api/version", ollamaUrl));
  await prepareLocalServices({
    supabaseReady, ollamaReady, signal: controller.signal, log,
    ensureDocker: async () => {
      const docker = await findExecutable("docker", windows ? dockerCandidates : []);
      if (!docker) throw new Error("Docker Desktop is not installed or its Docker CLI cannot be found.");
      childEnv.PATH = [path.dirname(docker), childEnv.PATH].filter(Boolean).join(path.delimiter);
      const dockerReady = async () => {
        try { await executeFile(docker, ["info", "--format", "{{.ServerVersion}}"], { windowsHide: true, timeout: 5000 }); return true; }
        catch { return false; }
      };
      if (await dockerReady()) return;
      if (!windows) throw new Error("Start Docker Desktop or your Docker engine, then run this command again.");
      const desktop = await findExecutable("Docker Desktop", [path.join(localPrograms, "DockerDesktop", "Docker Desktop.exe"), path.join(programFiles, "Docker", "Docker", "Docker Desktop.exe")]);
      if (!desktop) throw new Error("Docker Desktop cannot be found. Open Docker Desktop, then retry.");
      log("Starting Docker Desktop and waiting for its engine...");
      await run("powershell.exe", hiddenWindowsLaunchArgs(desktop), { timeoutMs: 15_000 });
      await waitUntil(dockerReady, { description: "Docker Desktop", signal: controller.signal, timeoutMs: 180_000 });
    },
    startSupabase: async () => {
      const cli = path.join(root, "node_modules", "supabase", "dist", "supabase.js");
      if (!await exists(cli)) throw new Error("Supabase CLI is missing. Run npm install in mindmate-chatbot first.");
      await run(process.execPath, [cli, "start"], { timeoutMs: 300_000 });
    },
    startOllama: async () => {
      const ollama = await findExecutable("ollama", windows ? ollamaCandidates : []);
      if (!ollama) throw new Error("Ollama is not installed or cannot be found. Install/open Ollama, then retry.");
      await run(ollama, ["serve"], { background: true, env: { ...childEnv, OLLAMA_HOST: ollamaUrl.origin } });
    },
    warmup: () => run(process.execPath, [path.join(root, "scripts", "warmup-chat.mjs")], { inherit: true, timeoutMs: 130_000 }),
  });
  const next = require.resolve("next/dist/bin/next");
  if (demo) {
    const marker = path.join(root, ".next", "mindmate-build.json");
    const fingerprint = await buildFingerprint(root);
    let previous;
    try { previous = JSON.parse(await readFile(marker, "utf8")); } catch { /* First launch or removed build. */ }
    if (!await exists(path.join(root, ".next", "BUILD_ID")) || previous?.fingerprint !== fingerprint) {
      log("Preparing the optimized app build...");
      await run(process.execPath, [next, "build"], { inherit: true });
      await writeFile(marker, JSON.stringify({ fingerprint }) + "\n");
    } else log("Reusing the existing optimized app build.");
  }
  log("Services and model are ready. Open the address shown below; press Ctrl+C to stop the app.");
  await run(process.execPath, [next, demo ? "start" : "dev", ...forwarded], { inherit: true });
}

try { await main(); await stop(0); }
catch (error) {
  if (!stopping) { console.error(`[MindMate] ${error instanceof Error ? error.message : "Startup failed."}`); await stop(1); }
}
