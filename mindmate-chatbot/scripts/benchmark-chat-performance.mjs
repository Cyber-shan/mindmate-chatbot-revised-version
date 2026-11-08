import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const endpoint = new URL(args.find((arg) => /^https?:/.test(arg)) ?? "http://127.0.0.1:3000/api/chat");
const runs = Number(option("--runs", "3"));
const saved = args.includes("--saved");
const cold = args.includes("--cold");
const prepare = args.includes("--prepare");
const output = option("--output");
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be between 1 and 20.");
const local = (url) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL ?? "qwen3.5:4b";
const prompt = "I feel overwhelmed with schoolwork. Can you help?";
const round = (ms) => Number(ms.toFixed(1));
let admin;
let student;
let fixtureUser;
let accessToken;
let fixtureEmail;

async function prepareSavedFixture() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publicKey || !local(url) || !local(endpoint)) throw new Error("--saved requires a local app and local Supabase configuration.");
  let serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    // Read credentials in memory only. Never print or write the CLI output.
    try {
      const cli = path.join(process.cwd(), "node_modules", "supabase", "dist", "supabase.js");
      const status = JSON.parse(execFileSync(process.execPath, [cli, "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 }));
      serviceKey = status.SERVICE_ROLE_KEY ?? status.SECRET_KEY;
    } catch { throw new Error("Cannot read local Supabase credentials. Start Supabase, or supply SUPABASE_SERVICE_ROLE_KEY for this terminal session."); }
  }
  if (!serviceKey) throw new Error("A local service-role key is required to create and clean up the synthetic benchmark user.");
  const settings = { auth: { persistSession: false, autoRefreshToken: false } };
  admin = createClient(url, serviceKey, settings);
  student = createClient(url, publicKey, settings);
  fixtureEmail = `mindmate-benchmark-${randomUUID()}@example.invalid`;
  const password = randomUUID() + randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email: fixtureEmail, password, email_confirm: true, user_metadata: { mindmate_benchmark: true } });
  if (error || !data.user) throw new Error("Unable to create the temporary local benchmark account.");
  fixtureUser = data.user;
  const { data: login, error: loginError } = await student.auth.signInWithPassword({ email: fixtureEmail, password });
  if (loginError || !login.session) throw new Error("Unable to authenticate the local benchmark account.");
  accessToken = login.session.access_token;
}

async function run(index) {
  const started = performance.now();
  const body = { messages: [{ role: "user", content: prompt }] };
  let saveMs = 0;
  if (saved) {
    const { data: conversation, error } = await student.from("conversations").insert({ user_id: fixtureUser.id, title: "Synthetic performance test" }).select("id").single();
    if (error || !conversation) throw new Error("Unable to create the local benchmark conversation. Apply the chat-history migration first.");
    const { data: message, error: messageError } = await student.from("messages").insert({ conversation_id: conversation.id, role: "user", content: prompt }).select("id").single();
    if (messageError || !message) throw new Error("Unable to save the synthetic benchmark message.");
    body.conversationId = conversation.id;
    body.messageId = message.id;
    saveMs = performance.now() - started;
  }
  const response = await fetch(endpoint, {
    method: "POST", headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(70_000),
  });
  if (!response.ok || !response.body) throw new Error(`Chat returned HTTP ${response.status}.`);
  const headersMs = performance.now() - started;
  const decoder = new TextDecoder();
  let pending = "";
  let firstTextMs;
  let completed = false;
  let reply = "";
  let finalEvent;
  const processLine = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    if (event.message?.content) {
      firstTextMs ??= performance.now() - started;
      reply += event.message.content;
    }
    if (event.done) { completed = true; finalEvent = event; }
  };
  for await (const chunk of response.body) {
    pending += decoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) { processLine(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
  }
  processLine(pending + decoder.decode());
  if (!completed || firstTextMs === undefined || !reply.trim()) throw new Error("Chat did not complete a visible response.");
  const replyMs = performance.now() - started;
  if (saved) {
    const { error } = await student.from("messages").insert({ conversation_id: body.conversationId, role: "assistant", content: reply.slice(0, 4000) });
    if (error) throw new Error("The benchmark reply could not be saved.");
  }
  const result = {
    run: index + 1, coldStart: cold && !prepare && index === 0,
    saveMs: round(saveMs), headersMs: round(headersMs), firstTextMs: round(firstTextMs),
    replyMs: round(replyMs), completeWithSaveMs: round(performance.now() - started),
    model: finalEvent.model ?? model,
    loadMs: round((finalEvent.load_duration ?? 0) / 1e6),
    promptMs: round((finalEvent.prompt_eval_duration ?? 0) / 1e6),
    promptTokens: finalEvent.prompt_eval_count, outputTokens: finalEvent.eval_count,
    tokensPerSecond: finalEvent.eval_duration ? round(finalEvent.eval_count / (finalEvent.eval_duration / 1e9)) : null,
    serverTiming: response.headers.get("server-timing"),
  };
  console.log(JSON.stringify(result));
  return result;
}

try {
  if (saved) await prepareSavedFixture();
  if (cold) {
    if (!local(ollamaUrl)) throw new Error("--cold is restricted to a local Ollama instance.");
    const response = await fetch(new URL("/api/generate", ollamaUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("Unable to prepare the cold-start measurement.");
    await response.arrayBuffer();
  }
  if (prepare) {
    await import("./warmup-chat.mjs");
    if (process.exitCode) throw new Error("Model preparation failed; benchmark stopped.");
  }
  const results = [];
  for (let index = 0; index < runs; index += 1) results.push(await run(index));
  const median = (items) => { const sorted = [...items].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2); };
  const warm = results.filter((result) => !result.coldStart);
  const summary = { mode: saved ? "saved-conversation" : "direct-api", prepared: prepare, model, runs: results, warmMedianFirstTextMs: warm.length ? median(warm.map((result) => result.firstTextMs)) : null, warmMedianReplyMs: warm.length ? median(warm.map((result) => result.replyMs)) : null };
  console.log(JSON.stringify({ summary: { mode: summary.mode, warmMedianFirstTextMs: summary.warmMedianFirstTextMs, warmMedianReplyMs: summary.warmMedianReplyMs } }));
  if (output) await writeFile(output, JSON.stringify(summary, null, 2) + "\n");
} finally {
  // Delete only this newly created fixture user; foreign-key cascades remove its test conversations.
  if (admin && fixtureUser?.id && fixtureUser.email === fixtureEmail && fixtureUser.user_metadata?.mindmate_benchmark === true) {
    const { error } = await admin.auth.admin.deleteUser(fixtureUser.id);
    if (error) throw new Error("Benchmark finished, but the temporary local benchmark account could not be removed.");
    console.log("Temporary benchmark account and conversations removed.");
  }
}
