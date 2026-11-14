import type { ChatMessage, SupportLevel } from "./types.ts";

export type SupportExample = {
  id: string;
  title: string;
  message: string;
  history: ChatMessage[];
  expected: SupportLevel;
};

/** Synthetic regression examples, not a training corpus or evidence of clinical validity. */
export const SUPPORT_EXAMPLES: SupportExample[] = [
  { id: "exam", title: "Exam stress", message: "I'm worried about tomorrow's exam.", history: [], expected: "LOW" },
  { id: "persistent", title: "Persistent sadness", message: "I've been sad every day for weeks.", history: [], expected: "MODERATE" },
  { id: "hopeless", title: "Serious concern", message: "I feel completely hopeless.", history: [], expected: "HIGH_CONCERN" },
  { id: "immediate", title: "Direct safety concern", message: "I want to hurt myself.", history: [], expected: "IMMEDIATE_SAFETY" },
  { id: "informal", title: "Informal wording", message: "i wanna die", history: [], expected: "IMMEDIATE_SAFETY" },
  { id: "split-spelling", title: "Split spelling", message: "i want to kill my self", history: [], expected: "IMMEDIATE_SAFETY" },
  { id: "negation", title: "Negation", message: "I don't want to hurt myself.", history: [], expected: "LOW" },
  { id: "informal-negation", title: "Informal negation", message: "I dont wanna hurt my self.", history: [], expected: "LOW" },
  { id: "academic", title: "Academic context", message: "For our psychology assignment, what does self-harm mean?", history: [], expected: "LOW" },
  { id: "quoted-informal", title: "Quoted wording", message: 'For my assignment, explain the phrase "I wanna die".', history: [], expected: "LOW" },
  { id: "unclear-safety", title: "Unclear safety wording", message: "Lately I keep thinking about hurting my self.", history: [], expected: "HIGH_CONCERN" },
  { id: "near-term", title: "Near-term intent", message: "I'm going to hurt myself tonight.", history: [], expected: "IMMEDIATE_SAFETY" },
  { id: "unsafe-reply", title: "Safety follow-up", message: "Not really", history: [
    { role: "user", content: "I feel completely hopeless." },
    { role: "assistant", content: "Are you safe right now?" },
  ], expected: "IMMEDIATE_SAFETY" },
  { id: "danger-reply", title: "Danger follow-up", message: "Yes", history: [
    { role: "assistant", content: "Are you thinking about hurting yourself?" },
  ], expected: "IMMEDIATE_SAFETY" },
];
