import { createHash } from "node:crypto";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireLocalHttpUrl, waitUntil } from "./local-startup.mjs";

const scriptPath = fileURLToPath(import.meta.url);

async function exists(filename) {
  try { await access(filename); return true; } catch { return false; }
}

export async function findClassifierPython(algorithmRoot) {
  for (const relative of [path.join(".venv", "Scripts", "python.exe"), path.join(".venv", "bin", "python")]) {
    const candidate = path.join(algorithmRoot, relative);
    if (await exists(candidate)) return candidate;
  }
  throw new Error("The algorithm Python environment is missing. Create mindmate-algorithm/.venv and install its requirements.txt before running the prototype.");
}

/** Training inputs, including dependency requirements, determine artifact reuse. */
export async function classifierFingerprint(algorithmRoot) {
  const digest = createHash("sha256");
  const sources = ["prototype.py", "train.py", "requirements.txt"];
  for (const entry of (await readdir(path.join(algorithmRoot, "distress"))).sort()) {
    if (entry.endsWith(".py")) sources.push(path.join("distress", entry));
  }
  for (const relative of sources) {
    digest.update(relative);
    digest.update(await readFile(path.join(algorithmRoot, relative)));
  }
  // An environment rebuild or installed dependency upgrade also invalidates reuse.
  const config = path.join(algorithmRoot, ".venv", "pyvenv.cfg");
  if (await exists(config)) digest.update(await readFile(config));
  const libraryRoot = path.join(algorithmRoot, ".venv", process.platform === "win32" ? "Lib" : "lib");
  const packageRoots = process.platform === "win32" ? [path.join(libraryRoot, "site-packages")]
    : (await readdir(libraryRoot).catch(() => [])).filter((entry) => entry.startsWith("python")).sort().map((entry) => path.join(libraryRoot, entry, "site-packages"));
  for (const packageRoot of packageRoots) {
    const dependencies = (await readdir(packageRoot).catch(() => [])).filter((entry) => /^(?:scikit_learn|numpy|joblib)-.+\.dist-info$/.test(entry)).sort();
    for (const entry of dependencies) {
      digest.update(entry);
      digest.update(await readFile(path.join(packageRoot, entry, "METADATA")));
    }
  }
  return digest.digest("hex");
}

function prototypeMetadata(data) {
  return data?.model_mode === "prototype" && data.synthetic_data === true && data.language === "en"
    && data.release_approved === false && data.prototype_usable === true
    && typeof data.model_version === "string" && data.model_version.length > 0;
}

export function assertPrototypeHealth(health, modelVersion) {
  if (health?.ready !== true || !prototypeMetadata(health) || health.model_version !== modelVersion) {
    throw new Error("The classifier address is occupied by an incompatible or stale service. Stop that service or choose another local DISTRESS_CLASSIFIER_URL, then run the prototype again.");
  }
}

export async function preparePrototypeModel({ root, run, log = () => {} }) {
  const algorithmRoot = path.resolve(root, "..", "mindmate-algorithm");
  const python = await findClassifierPython(algorithmRoot);
  const output = path.join(algorithmRoot, "artifacts", "prototype");
  const artifact = path.join(output, "classifier.joblib");
  const evaluationPath = path.join(output, "evaluation.json");
  const markerPath = path.join(output, ".startup.json");
  const fingerprint = await classifierFingerprint(algorithmRoot);
  let marker;
  let evaluation;
  try { marker = JSON.parse(await readFile(markerPath, "utf8")); } catch { /* First run or old artifacts. */ }
  try { evaluation = JSON.parse(await readFile(evaluationPath, "utf8")); } catch { /* Train below. */ }
  if (!await exists(artifact) || marker?.fingerprint !== fingerprint || !prototypeMetadata(evaluation) || marker?.model_version !== evaluation.model_version) {
    log("Training the English synthetic prototype classifier...");
    await run(python, [path.join(algorithmRoot, "prototype.py"), "--output", output], { inherit: true, timeoutMs: 180_000 });
    evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
    if (!await exists(artifact) || !prototypeMetadata(evaluation)) throw new Error("Prototype training did not produce a valid English synthetic classifier artifact.");
    await writeFile(markerPath, JSON.stringify({ fingerprint, model_version: evaluation.model_version }) + "\n");
  } else log("Reusing the trained English synthetic prototype classifier.");
  return { algorithmRoot, python, artifact, modelVersion: evaluation.model_version };
}

export async function preparePrototypeClassifier({ root, env, run, signal, log = () => {}, fetchHealth, wait = waitUntil }) {
  const url = requireLocalHttpUrl(env.DISTRESS_CLASSIFIER_URL ?? "http://127.0.0.1:8001", "Classifier");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The prototype classifier launcher requires a 127.0.0.1 or localhost HTTP origin in DISTRESS_CLASSIFIER_URL.");
  }
  env.DISTRESS_CLASSIFIER_URL = url.origin;
  env.DISTRESS_CLASSIFIER_MODE = "prototype";
  const model = await preparePrototypeModel({ root, run, log });
  const readHealth = fetchHealth ?? (async () => {
    let response;
    try {
      response = await fetch(new URL("/health", url), {
        signal: AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]), cache: "no-store",
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof TypeError || error?.name === "TimeoutError") return null;
      throw error;
    }
    try { return response.ok ? await response.json() : {}; } catch { return {}; }
  });
  const ready = async () => {
    const health = await readHealth();
    if (health === null) return false;
    assertPrototypeHealth(health, model.modelVersion);
    return true;
  };
  if (await ready()) log("The matching synthetic prototype classifier is already ready.");
  else {
    log("Starting the local synthetic prototype classifier...");
    await run(model.python, [path.join(model.algorithmRoot, "serve.py"), "--model", model.artifact, "--host", "127.0.0.1", "--port", url.port || "80"], {
      background: true, serviceName: "prototype classifier", env,
    });
    await wait(ready, { description: "Prototype classifier", signal, timeoutMs: 30_000, intervalMs: 250 });
    log("The synthetic prototype classifier is ready; clinical release approval remains false.");
  }
  return model;
}

// A separate training command makes the algorithm usable without Docker or Ollama.
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const root = path.resolve(path.dirname(scriptPath), "..");
  const run = (executable, args) => new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, windowsHide: true, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Algorithm training stopped (${code ?? signal}).`)));
  });
  try {
    const model = await preparePrototypeModel({ root, run, log: (message) => console.log(`[MindMate] ${message}`) });
    console.log(`[MindMate] Prototype artifact: ${model.artifact}`);
  } catch (error) {
    console.error(`[MindMate] ${error instanceof Error ? error.message : "Prototype training failed."}`);
    process.exitCode = 1;
  }
}
