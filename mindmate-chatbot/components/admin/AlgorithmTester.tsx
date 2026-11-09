"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Check, CheckCircle2, FlaskConical, LoaderCircle, Play, Plus, RotateCcw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { SUPPORT_EXAMPLES, type SupportExample } from "@/lib/support/examples";
import { LEVELS, type ChatMessage, type SupportDecision, type SupportLevel } from "@/lib/support/types";
import type { AlgorithmTestResult } from "@/lib/support/testing";
import { useAlgorithmOverview } from "./AlgorithmProvider";
import AlgorithmStatus from "./AlgorithmStatus";

const LEVEL_STYLE: Record<SupportLevel, { label: string; color: string; background: string; description: string }> = {
  LOW: { label: "Low", color: "var(--priority-low)", background: "var(--priority-low-surface)", description: "Ordinary emotional concerns" },
  MODERATE: { label: "Moderate", color: "var(--priority-moderate)", background: "var(--priority-moderate-surface)", description: "Additional support may help" },
  HIGH_CONCERN: { label: "High concern", color: "var(--priority-high)", background: "var(--priority-high-surface)", description: "Safety check and human support" },
  IMMEDIATE_SAFETY: { label: "Immediate safety", color: "var(--priority-immediate)", background: "var(--priority-immediate-surface)", description: "Dedicated safety response" },
};
const SOURCE_LABEL: Record<SupportDecision["source"], string> = {
  rules_only: "Safety rules and context", ml: "ML classifier", hybrid: "Rules + ML classifier",
  safety_override: "Safety rule override", conversation_context: "Conversation context", uncertain_model: "Uncertain model prediction",
};
const SAFE_QUESTION = "Are you safe right now?";
const DANGER_QUESTION = "Are you thinking about hurting yourself?";
const TEST_EXAMPLES: SupportExample[] = [...SUPPORT_EXAMPLES,
  { id: "quoted-passage", title: "Quoted passage", message: 'For my assignment, explain "I feel hopeless. I want to die".', history: [], expected: "LOW" },
  { id: "past-disclosure", title: "Past disclosure", message: 'Last month I said "I want to hurt myself", but I am safe now.', history: [], expected: "HIGH_CONCERN" },
  { id: "involuntary-thought", title: "Involuntary thoughts", message: "I can't stop thinking about hurting myself.", history: [], expected: "HIGH_CONCERN" },
  { id: "uncertain-safety", title: "Uncertain safety answer", message: "Yes, but I am not sure I can stay safe.", history: [{ role: "assistant", content: SAFE_QUESTION }], expected: "IMMEDIATE_SAFETY" },
  { id: "safe-answer", title: "Explicit safe answer", message: "I am with my sister and I am safe right now.", history: [{ role: "user", content: "I feel completely hopeless." }, { role: "assistant", content: SAFE_QUESTION }], expected: "MODERATE" },
];
type ExampleResult = { example: SupportExample; result: AlgorithmTestResult };

function PriorityBadge({ level }: { level: SupportLevel }) {
  const style = LEVEL_STYLE[level];
  return <span className="inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold" style={{ color: style.color, background: style.background }}>{style.label}</span>;
}

async function analyze(message: string, history: ChatMessage[], signal: AbortSignal): Promise<AlgorithmTestResult> {
  const response = await fetch("/api/admin/algorithm", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }), signal,
  });
  const data = await response.json() as AlgorithmTestResult & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "The algorithm test could not finish.");
  if (!data?.decision || !LEVELS.includes(data.decision.level)) throw new Error("The algorithm returned an incomplete result. Please try again.");
  return data;
}

export default function AlgorithmTester() {
  const { recordTest } = useAlgorithmOverview();
  const [message, setMessage] = useState(SUPPORT_EXAMPLES[0].message);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [selected, setSelected] = useState<SupportExample | null>(SUPPORT_EXAMPLES[0]);
  const [result, setResult] = useState<AlgorithmTestResult | null>(null);
  const [expected, setExpected] = useState<SupportLevel | null>(null);
  const [suite, setSuite] = useState<ExampleResult[]>([]);
  const [busy, setBusy] = useState<"single" | "suite" | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);

  const choose = (example: SupportExample) => {
    setMessage(example.message); setHistory(example.history); setSelected(example); setResult(null); setExpected(null); setError("");
  };
  const reset = () => {
    controllerRef.current?.abort(); controllerRef.current = null;
    setMessage(""); setHistory([]); setSelected(null); setResult(null); setExpected(null); setSuite([]); setBusy(null); setError("");
  };
  const run = async (allExamples = false) => {
    if (busy || (!allExamples && !message.trim())) return;
    if (!allExamples && history.some((item) => !item.content.trim())) { setError("Fill in or remove empty previous messages before analyzing."); return; }
    const controller = new AbortController(); controllerRef.current = controller;
    setBusy(allExamples ? "suite" : "single"); setError("");
    try {
      if (allExamples) {
        const results = await Promise.all(TEST_EXAMPLES.map(async (example) => ({ example, result: await analyze(example.message, example.history, controller.signal) })));
        if (!controller.signal.aborted) { setSuite(results); results.forEach((item) => recordTest(item.result)); }
      } else {
        const response = await analyze(message, history, controller.signal);
        if (!controller.signal.aborted) { setResult(response); setExpected(selected?.expected ?? null); recordTest(response); }
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        controller.abort();
        setError(failure instanceof Error ? failure.message : "The test could not finish. Please try again.");
      }
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(null); }
    }
  };
  const passed = suite.filter(({ example, result: item }) => item.decision.level === example.expected).length;
  const decision = result?.decision;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground"><FlaskConical className="size-4" /> MindMate admin</div>
          <h1 className="font-serif text-3xl text-foreground">Algorithm tester</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Try a message and see how the same algorithm used in student chat prioritizes support.</p>
        </div>
        <Link href="/admin/reports" className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 text-xs font-semibold hover:bg-accent">View evaluation reports <ArrowRight className="size-3.5" /></Link>
      </header>

      <AlgorithmStatus />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3">
        <p className="max-w-xl text-xs leading-5 text-muted-foreground">Test messages stay out of student history and review queues. Results prioritize support; they are not diagnoses.</p>
        <button type="button" disabled={Boolean(busy)} onClick={() => void run(true)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-accent disabled:cursor-wait disabled:opacity-60">
          {busy === "suite" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {busy === "suite" ? "Running examples…" : `Run all ${TEST_EXAMPLES.length} examples`}
        </button>
      </div>

      {error && <p role="alert" className="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-destructive">{error}</p>}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <form onSubmit={(event) => { event.preventDefault(); void run(); }} className="rounded-2xl border border-border p-5 md:p-6">
          <div className="mb-5 flex items-center gap-2 text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-foreground text-xs text-primary-foreground">1</span> Enter a test message</div>
          <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="algorithm-message" className="font-medium">Student message</label><span className="text-xs tabular-nums text-muted-foreground">{message.length}/4000</span></div>
          <textarea id="algorithm-message" value={message} maxLength={4000} rows={5} disabled={Boolean(busy)} onChange={(event) => { setMessage(event.target.value); setSelected(null); }} placeholder="Type a test message…" className="block w-full resize-y rounded-xl border border-border bg-card p-3 outline-none focus:border-foreground focus:ring-2 focus:ring-ring disabled:opacity-60" />
          <p className="mb-2 mt-5 text-xs font-semibold text-muted-foreground">Try an example</p>
          <div className="flex flex-wrap gap-2">{TEST_EXAMPLES.map((example) => <button key={example.id} type="button" disabled={Boolean(busy)} aria-pressed={selected?.id === example.id} onClick={() => choose(example)} className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-60 ${selected?.id === example.id ? "border-foreground bg-foreground text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"}`}>{example.title}</button>)}</div>

          <div className="mt-5 rounded-xl border border-border bg-card p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm" htmlFor="algorithm-context">
              <input id="algorithm-context" type="checkbox" checked={history.length > 0} disabled={Boolean(busy)} onChange={(event) => {
                setSelected(null); setHistory(event.target.checked ? [{ role: "user", content: "I feel completely hopeless." }, { role: "assistant", content: SAFE_QUESTION }] : []);
              }} className="size-4 accent-black" /> Include conversation context
            </label>
            {history.length > 0 && <div className="mt-3 space-y-2">
              {history.filter((item) => item.role === "user").map((item, index) => <p key={index} className="text-xs leading-5 text-muted-foreground">Previous student message: “{item.content}”</p>)}
              <label htmlFor="algorithm-question" className="block text-xs text-muted-foreground">Safety-question shortcut</label>
              <select id="algorithm-question" value={history.at(-1)?.role === "assistant" && [SAFE_QUESTION, DANGER_QUESTION].includes(history.at(-1)?.content ?? "") ? history.at(-1)?.content : ""} disabled={Boolean(busy) || (history.at(-1)?.role !== "assistant" && history.length >= 40)} onChange={(event) => { const content = event.target.value; if (!content) return; setSelected(null); setHistory((items) => [...(items.at(-1)?.role === "assistant" ? items.slice(0, -1) : items), { role: "assistant", content }]); }} className="w-full rounded-lg border border-border bg-background p-2 text-xs outline-none focus:ring-2 focus:ring-ring">
                <option value="">Custom conversation context</option><option value={SAFE_QUESTION}>{SAFE_QUESTION}</option><option value={DANGER_QUESTION}>{DANGER_QUESTION}</option>
              </select>
            </div>}
          </div>

          <details className="mt-4 rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-xs font-semibold">Edit previous messages ({history.length}/40)</summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Messages are evaluated in order before the current student message. This test context does not change saved student conversations.</p>
            <div className="mt-3 space-y-3">{history.map((item, index) => <div key={index} className="rounded-lg bg-card p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><label htmlFor={`context-role-${index}`} className="!text-xs">Message {index + 1}</label><button type="button" disabled={Boolean(busy)} aria-label={`Remove previous message ${index + 1}`} onClick={() => { setSelected(null); setHistory((items) => items.filter((_, position) => position !== index)); }} className="rounded-md p-1.5 hover:bg-accent"><Trash2 className="size-3.5" /></button></div>
              <select id={`context-role-${index}`} aria-label={`Role of previous message ${index + 1}`} value={item.role} disabled={Boolean(busy)} onChange={(event) => { const role = event.target.value as ChatMessage["role"]; setSelected(null); setHistory((items) => items.map((entry, position) => position === index ? { ...entry, role } : entry)); }} className="mb-2 w-full rounded-lg border border-border bg-background p-2 text-xs"><option value="user">Student</option><option value="assistant">MindMate</option></select>
              <textarea aria-label={`Content of previous message ${index + 1}`} rows={2} maxLength={4000} value={item.content} disabled={Boolean(busy)} onChange={(event) => { const content = event.target.value; setSelected(null); setHistory((items) => items.map((entry, position) => position === index ? { ...entry, content } : entry)); }} className="w-full rounded-lg border border-border bg-background p-2 !text-xs outline-none focus:ring-2 focus:ring-ring" />
            </div>)}</div>
            <button type="button" disabled={Boolean(busy) || history.length >= 40} onClick={() => { setSelected(null); setHistory((items) => [...items, { role: items.at(-1)?.role === "user" ? "assistant" : "user", content: "" }]); }} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 !text-xs font-semibold hover:bg-accent disabled:opacity-50"><Plus className="size-3.5" /> Add previous message</button>
          </details>

          <div className="mt-5 flex items-center gap-3">
            <button type="submit" disabled={Boolean(busy) || !message.trim()} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-foreground px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50">
              {busy === "single" ? <LoaderCircle className="size-4 animate-spin" /> : <Activity className="size-4" />}{busy === "single" ? "Analyzing…" : "Analyze message"}
            </button>
            <button type="button" onClick={reset} aria-label="Reset tests" className="rounded-xl border border-border p-3 text-muted-foreground hover:bg-accent"><RotateCcw className="size-4" /></button>
          </div>
        </form>

        <section aria-label="Algorithm result" aria-live="polite" className="min-w-0 rounded-2xl border border-border p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 !text-sm font-semibold"><span className="flex size-6 items-center justify-center rounded-full bg-foreground text-xs text-primary-foreground">2</span> Inspect the decision</h2>{result && <span className="text-xs tabular-nums text-muted-foreground">{result.elapsed_ms} ms</span>}</div>
          {!decision ? <div>
            <div className="mb-6 rounded-xl bg-card px-4 py-6 text-center"><ShieldCheck className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="text-sm font-medium">Your decision will appear here</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Choose an example or write a message, then click Analyze message.</p></div>
            <p className="mb-3 text-xs font-semibold text-muted-foreground">The four support priorities</p>
            <div className="space-y-3">{LEVELS.map((level) => <div key={level} className="flex flex-wrap items-center justify-between gap-2"><PriorityBadge level={level} /><span className="text-xs text-muted-foreground">{LEVEL_STYLE[level].description}</span></div>)}</div>
          </div> : <div className="space-y-5">
            <div className="rounded-xl p-4" style={{ background: LEVEL_STYLE[decision.level].background }}>
              <PriorityBadge level={decision.level} /><h3 data-testid="algorithm-priority" className="mt-2 break-words !text-xl font-semibold" style={{ color: LEVEL_STYLE[decision.level].color }}>{decision.display_label}</h3>
              <p className="mt-1 font-mono text-xs" style={{ color: LEVEL_STYLE[decision.level].color }}>{decision.level}</p>
              {expected && <p className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: LEVEL_STYLE[decision.level].color }}>{expected === decision.level ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{expected === decision.level ? "Matches the example’s expected result" : `Example expected ${expected}`}</p>}
            </div>
            <p className="break-words text-xs leading-5 text-muted-foreground">Tested message: “{result?.evaluated_message}”</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs">
              <div><dt className="text-muted-foreground">Decision source</dt><dd className="mt-1 font-semibold">{SOURCE_LABEL[decision.source]}</dd></div>
              <div><dt className="text-muted-foreground">Top model score</dt><dd data-testid="algorithm-confidence" className="mt-1 font-semibold">{decision.confidence === null ? "Unavailable · rules/context only" : `${(decision.confidence * 100).toFixed(1)}%`}</dd></div>
              <div><dt className="text-muted-foreground">Model mode</dt><dd data-testid="algorithm-model-mode" className="mt-1 font-semibold">{decision.model_mode === "prototype" ? "Synthetic English prototype" : decision.model_mode === "reviewed" ? "Reviewed model" : "Rules and context only"}</dd></div>
              <div><dt className="text-muted-foreground">Human review required</dt><dd className="mt-1 font-semibold">{decision.requires_human_review ? "Yes" : "No"}</dd></div>
              <div><dt className="text-muted-foreground">Safety response required</dt><dd className="mt-1 font-semibold">{decision.safety_response_required ? "Yes" : "No"}</dd></div>
            </dl>
            {decision.model_mode === "prototype" && <p className="rounded-xl border border-warning-border bg-warning-surface p-3 text-xs leading-5 text-warning">This model was trained on synthetic English examples. Its scores demonstrate the algorithm and have not been validated on real student messages.</p>}
            {decision.model && <section aria-label="Model class probabilities" className="rounded-xl border border-border p-3"><h3 className="!text-xs font-semibold">Model class probabilities</h3><p className="mb-3 mt-1 text-[11px] leading-5 text-muted-foreground">Raw scores before safety rules, thresholds and conversation context. The highest score is not a clinical certainty.</p><div className="space-y-3">{LEVELS.map((level) => <div key={level}><div className="mb-1 flex justify-between gap-3 text-xs"><span>{LEVEL_STYLE[level].label}</span><span className="font-mono tabular-nums">{(decision.model![level] * 100).toFixed(1)}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-accent"><div className="h-full rounded-full" style={{ width: `${decision.model![level] * 100}%`, background: LEVEL_STYLE[level].color }} /></div></div>)}</div></section>}
            <div className="border-t border-border pt-4"><h3 className="!text-xs font-semibold">Matched rules</h3><div className="mt-2 flex flex-wrap gap-1.5">{decision.rules.length ? decision.rules.map((rule) => <span key={rule} className="break-all rounded-md bg-card px-2 py-1 font-mono text-[11px]">{rule}</span>) : <p className="text-xs text-muted-foreground">No positive support-priority rule matched.</p>}</div></div>
            <div className="rounded-xl bg-card p-3 text-xs leading-6"><p className="font-semibold">Conversation context</p><p>{result?.history_count ?? 0} previous messages · Highest priority: {decision.state.highest_level}</p><p>Safety question active: {decision.state.safety_question_active ? "Yes" : "No"}</p>{Boolean(result?.safety_signal.contexts.length) && <p>Detected context: {result?.safety_signal.contexts.join(", ").replaceAll("_", " ")}</p>}</div>
            {result?.response_preview ? <div><h3 className="mb-2 !text-xs font-semibold">Chatbot safety-response preview</h3><blockquote className="rounded-xl border border-border p-3 text-xs leading-6 text-muted-foreground">{result.response_preview}</blockquote></div> : <p className="text-xs leading-5 text-muted-foreground">Student chat would continue with a supportive generated reply for this priority.</p>}
            <p className="text-[11px] leading-5 text-muted-foreground">Rule set: {decision.rule_version}. {decision.rule_review_status === "requires_clinician_review" ? "Draft rules; clinician review is pending." : decision.rule_review_status} {decision.model_version ? `Model: ${decision.model_version}.` : "No ML model contributed to this result."}</p>
            <details className="border-t border-border pt-3"><summary className="cursor-pointer text-xs font-semibold">View structured decision JSON</summary><pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-card p-3 text-[11px] leading-5">{JSON.stringify(decision, null, 2)}</pre></details>
          </div>}
        </section>
      </div>

      {suite.length > 0 && <section aria-label="Example test results" className="overflow-hidden rounded-2xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-4"><div><h2 className="!text-sm font-semibold">Built-in example checks</h2><p className="mt-1 text-xs text-muted-foreground">Each row was evaluated by the running algorithm.</p></div><span data-testid="example-summary" className="inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1 text-xs font-semibold">{passed === suite.length ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-warning" />}{passed}/{suite.length} matched</span></div>
        <div className="relative overflow-x-auto"><table className="w-full min-w-[570px] text-left text-xs"><thead className="text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Scenario</th><th className="px-3 py-3 font-medium">Expected</th><th className="px-3 py-3 font-medium">Actual</th><th className="px-3 py-3 font-medium">Check</th><th className="px-4 py-3"><span className="sr-only">Inspect</span></th></tr></thead><tbody className="divide-y divide-border">{suite.map(({ example, result: item }) => <tr key={example.id}><td className="px-5 py-3 font-medium">{example.title}</td><td className="px-3 py-3"><PriorityBadge level={example.expected} /></td><td className="px-3 py-3"><PriorityBadge level={item.decision.level} /></td><td className="px-3 py-3">{example.expected === item.decision.level ? <span className="inline-flex items-center gap-1 text-success"><Check className="size-3.5" /> Pass</span> : <span className="text-warning">Review</span>}</td><td className="px-4 py-3"><button type="button" disabled={Boolean(busy)} aria-label={`Inspect ${example.title}`} onClick={() => { choose(example); setResult(item); setExpected(example.expected); }} className="inline-flex items-center gap-1 font-medium hover:underline">View <ArrowRight className="size-3" /></button></td></tr>)}</tbody></table></div>
        <p className="border-t border-border px-5 py-3 text-[11px] leading-5 text-muted-foreground">Expected labels are rules-only reference outcomes. A contributing model can raise priority; review differing results. These checks do not measure accuracy on real student messages or confirm clinical validity.</p>
      </section>}
      <p className="text-xs leading-5 text-muted-foreground">Preview only: analyzing a message does not contact a counselor or create a human-review request.</p>
    </div>
  );
}
