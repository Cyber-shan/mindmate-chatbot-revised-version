import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preparePrototypeClassifier } from "./classifier-startup.mjs";
import { POST } from "../app/api/admin/algorithm/route.ts";
import { SUPPORT_EXAMPLES } from "../lib/support/examples.ts";
import { LEVELS } from "../lib/support/types.ts";
import { writeFile } from "node:fs/promises";
import { CONTEXT_CHALLENGES } from "../tests/fixtures/support-context.mjs";
import { ruleVersion } from "../lib/support/safety.ts";

// Exercise the real serialized model, HTTP service, adapter, and app policy.
// This needs neither a student account nor the database or generation service.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const controller = new AbortController();
const owned = new Set();
let serviceFailure;
async function cleanup() {
  controller.abort();
  await Promise.all([...owned].map(async (child) => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
  }));
}
process.once("SIGINT", () => { void cleanup(); process.exitCode = 130; });
process.once("SIGTERM", () => { void cleanup(); process.exitCode = 143; });

async function run(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: root, env: options.env ?? process.env, windowsHide: true,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  owned.add(child);
  let output = "";
  child.stdout?.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
  child.stderr?.on("data", (chunk) => { output = (output + chunk).slice(-4000); });
  const finished = once(child, "exit").then(([code]) => {
    if (code !== 0 && !controller.signal.aborted) throw new Error(`Algorithm process exited (${code}). ${output}`);
  }).finally(() => owned.delete(child));
  if (!options.background) return finished;
  finished.catch((error) => { serviceFailure = error; });
  await once(child, "spawn");
}

try {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  process.env.DISTRESS_CLASSIFIER_URL = `http://127.0.0.1:${port}`;
  process.env.DISTRESS_CLASSIFIER_MODE = "prototype";
  const model = await preparePrototypeClassifier({
    root, env: process.env, run, signal: controller.signal,
    log: (message) => console.log(`[MindMate] ${message}`),
  });
  const cases = [];
  for (const example of SUPPORT_EXAMPLES) {
    if (serviceFailure) throw serviceFailure;
    const response = await POST(new Request("http://localhost/api/admin/algorithm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: example.message, history: example.history }),
      signal: controller.signal,
    }));
    assert.equal(response.status, 200);
    const { decision } = await response.json();
    // Example labels are rule baselines. The hybrid policy may raise priority;
    // this smoke test verifies that a model can never lower that baseline.
    assert.ok(LEVELS.indexOf(decision.level) >= LEVELS.indexOf(example.expected), example.title);
    if (!decision.model) assert.equal(decision.level, example.expected, example.title);
    if (decision.model) {
      assert.equal(decision.model_version, model.modelVersion);
      assert.equal(decision.model_mode, "prototype");
    }
    cases.push({ scenario: example.title, rule_baseline: example.expected, level: decision.level, model_mode: decision.model_mode });
  }
  assert.ok(cases.some((item) => item.model_mode === "prototype"), "The trained model must contribute to a decision");
  const contextCases = [];
  const confusion = LEVELS.map(() => LEVELS.map(() => 0));
  const categories = {};
  for (const [index, example] of CONTEXT_CHALLENGES.entries()) {
    const response = await POST(new Request("http://localhost/api/admin/algorithm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: example.message, history: example.history ?? [] }),
      signal: controller.signal,
    }));
    assert.equal(response.status, 200);
    const { decision } = await response.json();
    const correct = decision.level === example.expected && decision.subject === (example.subject ?? "student");
    const category = categories[example.kind] ??= { total: 0, correct: 0, errors: 0 };
    category.total += 1; category.correct += Number(correct); category.errors += Number(!correct);
    confusion[LEVELS.indexOf(example.expected)][LEVELS.indexOf(decision.level)] += 1;
    contextCases.push({ fixture: index, category: example.kind, expected: example.expected,
      actual: decision.level, subject: decision.subject, correct, source: decision.source, model_mode: decision.model_mode });
  }
  const perClass = Object.fromEntries(LEVELS.map((label, index) => {
    const support = confusion[index].reduce((sum, count) => sum + count, 0);
    const assigned = confusion.reduce((sum, row) => sum + row[index], 0);
    const tp = confusion[index][index];
    return [label, { support, true_positive: tp, false_positive: assigned - tp, false_negative: support - tp,
      precision: assigned ? tp / assigned : null, recall: support ? tp / support : null,
      f1: support + assigned ? 2 * tp / (support + assigned) : null }];
  }));
  const contextReport = { model_version: model.modelVersion, rule_version: ruleVersion,
    evaluation_scope: "Hybrid app policy on fixed English engineering challenge fixtures, separate from the classifier training report. These fixtures are developer-authored and reused for regression testing; perfect fixture results are not a statistical accuracy estimate or clinical validation.",
    sample_count: contextCases.length, error_count: contextCases.filter((item) => !item.correct).length,
    categories, class_order: LEVELS, confusion_matrix: confusion, per_class: perClass,
    uncertainty: { confidence_intervals: null, reason: "Curated regression cases are not a random or independent population sample; no population accuracy interval is claimed." },
    cases: contextCases };
  await writeFile(path.join(model.algorithmRoot, "artifacts/prototype/context-evaluation.json"), JSON.stringify(contextReport, null, 2) + "\n");
  assert.equal(contextReport.error_count, 0, "English context challenges failed; inspect context-evaluation.json");
  delete process.env.DISTRESS_CLASSIFIER_MODE;
  const reviewedOnly = await POST(new Request("http://localhost/api/admin/algorithm", {
    method: "POST", body: JSON.stringify({ message: "I'm worried about tomorrow's exam." }),
  }));
  assert.equal((await reviewedOnly.json()).decision.model_mode, null, "Synthetic scores must remain disabled without the explicit opt-in");
  console.log(JSON.stringify({ passed: cases.length, context_challenges: contextReport.sample_count,
    context_errors: contextReport.error_count, model_version: model.modelVersion, release_approved: false, cases }, null, 2));
} catch (error) {
  console.error(`[MindMate] Algorithm verification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
