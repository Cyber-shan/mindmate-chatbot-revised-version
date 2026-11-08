// Measure the running app without creating or modifying database records.
const url = process.argv[2] ?? "http://127.0.0.1:3000/api/chat";
const start = performance.now();
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    messages: [{ role: "user", content: "I feel overwhelmed with schoolwork. Can you help?" }],
  }),
  signal: AbortSignal.timeout(70_000),
});
if (!response.ok) throw new Error(`Chat returned ${response.status}: ${await response.text()}`);
if (!response.body) throw new Error("Chat returned no response stream.");

const seconds = () => Number(((performance.now() - start) / 1000).toFixed(2));
const decoder = new TextDecoder();
let pending = "";
let firstContent = false;
let completed = false;

const processLine = (line) => {
  if (!line.trim()) return;
  const event = JSON.parse(line);
  if (event.error) throw new Error(event.error);
  if (event.message?.content && !firstContent) {
    firstContent = true;
    console.log(JSON.stringify({ firstTextSeconds: seconds() }));
  }
  if (event.done) {
    completed = true;
    console.log(JSON.stringify({
      model: event.model,
      totalSeconds: seconds(),
      loadSeconds: Number(((event.load_duration ?? 0) / 1e9).toFixed(2)),
      promptTokens: event.prompt_eval_count,
      outputTokens: event.eval_count,
      tokensPerSecond: event.eval_duration
        ? Number((event.eval_count / (event.eval_duration / 1e9)).toFixed(2))
        : undefined,
    }));
  }
};

for await (const chunk of response.body) {
  pending += decoder.decode(chunk, { stream: true });
  let newline;
  while ((newline = pending.indexOf("\n")) !== -1) {
    processLine(pending.slice(0, newline));
    pending = pending.slice(newline + 1);
  }
}
pending += decoder.decode();
processLine(pending);
if (!completed || !firstContent) throw new Error("Chat did not complete a visible response.");
