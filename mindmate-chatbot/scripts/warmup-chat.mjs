import { createRequire } from "node:module";
import { getOllamaConfig, SYSTEM_PROMPT } from "../lib/chat-config.ts";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info() {}, error() {} });
const config = getOllamaConfig();
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.url).hostname)) {
  throw new Error("Demo warm-up is restricted to the configured local Ollama service.");
}
const started = performance.now();
console.log(`Preparing ${config.model} for the demo...`);
try {
  // Exercise prompt processing and one generated token, not just model loading.
  // This neutral fixture is never shown to students or saved in chat history.
  const response = await fetch(new URL("/api/chat", config.url), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model, stream: false, think: false, keep_alive: config.keepAlive,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: "Hello." }],
      options: { num_ctx: config.contextTokens, num_predict: 1 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.done !== true || result.error) throw new Error("Ollama did not finish preparing the model.");
  console.log(JSON.stringify({ ready: true, model: config.model, preparationSeconds: Number(((performance.now() - started) / 1000).toFixed(2)), keepAlive: config.keepAlive }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Warm-up failed.");
  console.error("Check that Ollama is running and the configured model is installed.");
  process.exitCode = 1;
}
