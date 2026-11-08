import config from "./rules.json" with { type: "json" };
import { higher, type ChatMessage, type ConversationState, type SafetySignal, type SupportLevel } from "./types.ts";

export const ruleVersion = config.version;
export const ruleReviewStatus = config.review_status;

/** Preserve negation and punctuation; use a separate normalized copy for matching. */
export function normalize(text: string): string {
  return text.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019]/g, "'").toLowerCase()
    .replace(/\bk1ll\b/g, "kill").replace(/\bsu[1i]c[1i]de\b/g, "suicide")
    .replace(/\s+/g, " ").trim();
}

const compiledRules = config.rules.map((rule) => ({
  ...rule, level: rule.level as SupportLevel,
  patterns: rule.patterns.map((pattern) => new RegExp(pattern, "g")),
}));
const academic = /\b(?:assignment|psychology class|research paper|define|definition|what does|what is|lyrics|song|movie|novel|quotation)\b/;
const historical = /\b(?:used to|years? ago|last year|yesterday|last night|in the past|back then|dati|noon)\b/;
const current = /\b(?:now|today|tonight|currently|again|ngayon|mamaya)\b/;
const safeNow = /\b(?:i(?:'m| am) safe (?:now|today)|no longer (?:feel|want|think)|not anymore)\b/;
const thirdParty = /\b(?:my (?:friend|classmate|sister|brother|partner)|he|she|they) (?:said|says|told|wrote|texted|asked|is|wants?|plans?)\b/;

function negated(prefix: string): boolean {
  // Scope negation to the current clause, never to the whole message.
  return /\b(?:not|never|don't|do not|didn't|did not|wouldn't|would not|won't|will not|no intention to|ayaw|hindi)\b[^.!?;,:]{0,32}$/.test(prefix);
}

export function analyzeSafety(message: string): SafetySignal {
  const text = normalize(message);
  const signal: SafetySignal = {
    level: "LOW", matched_rules: [], current_action: false,
    direct_intent: false, first_person_concern: false, temporal_immediacy: current.test(text), contexts: [],
  };
  for (const rule of compiledRules) {
    for (const pattern of rule.patterns) {
      for (const match of text.matchAll(pattern)) {
        const index = match.index;
        let start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("!", index - 1), text.lastIndexOf("?", index - 1), text.lastIndexOf(";", index - 1)) + 1;
        const contrast = [...text.slice(start, index).matchAll(/\b(?:but|however|yet)\b/g)].at(-1);
        if (contrast) start += contrast.index + contrast[0].length;
        const endIndex = text.slice(index + match[0].length).search(/[.!?;]/);
        const end = endIndex < 0 ? text.length : index + match[0].length + endIndex;
        const clause = text.slice(start, end);
        const prefix = text.slice(start, index);
        // Exclude a preceding negation only when the rule does not itself encode it.
        const isNegated = negated(prefix);
        const isPast = historical.test(prefix) || (historical.test(clause) && safeNow.test(clause));
        const isThirdParty = thirdParty.test(prefix);
        // Academic framing only applies inside a quote or when no personal disclosure is present.
        const quoteOpen = (prefix.match(/"/g)?.length ?? 0) % 2 === 1 || /(?:^|[\s,:])'[^']*$/.test(prefix);
        const isAcademic = (academic.test(clause) && quoteOpen) || (academic.test(prefix) && /\b(?:phrase|sentence|example|means?)\b/.test(prefix));
        if (isNegated) { signal.contexts.push("negated"); continue; }
        if (isAcademic) { signal.contexts.push("academic_or_quoted"); continue; }
        let level = rule.level;
        if (isThirdParty) { level = "HIGH_CONCERN"; signal.contexts.push("third_party"); }
        else if (isPast && !current.test(prefix.replace(safeNow, ""))) {
          level = "HIGH_CONCERN"; signal.contexts.push("historical");
        }
        signal.level = higher(signal.level, level);
        if (!isThirdParty && (level === "HIGH_CONCERN" || level === "IMMEDIATE_SAFETY")) signal.first_person_concern = true;
        signal.matched_rules.push(rule.id);
        if (level === "IMMEDIATE_SAFETY") {
          signal.current_action ||= rule.current_action === true;
          signal.direct_intent ||= rule.id === "direct_self_harm_intent";
        }
      }
    }
  }
  if (/\b(?:he|she|they|my (?:friend|sister|brother|classmate))\b.{0,45}\b(?:hurt|kill|harm|hurting|killing|harming) (?:himself|herself|themselves)\b/.test(text) && !academic.test(text)) {
    signal.level = higher(signal.level, "HIGH_CONCERN");
    signal.matched_rules.push("third_party_safety_concern");
    signal.contexts.push("third_party");
  }
  // Explicit third-person vocabulary and non-intent mentions require context, not automatic emergency escalation.
  if (!signal.matched_rules.length && /\b(?:suicid(?:e|al)|self[- ]harm|kill myself|hurt myself|hurting myself|magpakamatay)\b/.test(text)) {
    const educational = academic.test(text) && !/\bi (?:want|am|'m|feel|plan|will|might|have)\b/.test(text);
    const denial = /\bi (?:do not|don't|dont|never|would never|will not|won't) (?:want to |intend to )?(?:hurt|kill|harm) myself\b|\bi(?:'m| am) not suicidal\b/.test(text);
    if (!educational && !denial && !signal.contexts.includes("academic_or_quoted")) {
      signal.level = "HIGH_CONCERN";
      signal.matched_rules.push("ambiguous_safety_language");
      if (thirdParty.test(text)) signal.contexts.push("third_party");
      else signal.first_person_concern = true;
    }
  }
  signal.matched_rules = [...new Set(signal.matched_rules)];
  signal.contexts = [...new Set(signal.contexts)];
  return signal;
}

export function isSafetyQuestion(message: string): boolean {
  return safetyQuestionKind(message) !== null;
}

export function safetyQuestionKind(message: string): "safe" | "danger" | null {
  const text = normalize(message);
  if (/\bare you (?:thinking about|in immediate danger of) (?:hurting|harming|killing) yourself\b/.test(text)) return "danger";
  if (/\b(?:are you (?:feeling )?safe(?: right now| now)?|can you (?:keep|stay|remain) (?:yourself )?safe)\b/.test(text)) return "safe";
  return null;
}

export function unsafeReply(message: string, kind: "safe" | "danger" | null = "safe"): boolean {
  if (kind === "danger") return /^(?:yes|yeah|yep|oo|maybe|not sure|i don't know|i'm not sure|i am not sure)\b/.test(normalize(message)) || /\bi(?:'m| am) not safe\b/.test(normalize(message));
  return /^(?:no|nope|not really|not sure|unsure|i don't know|i do not know|i'm not sure|i am not sure|maybe|hindi|di ako sigurado)(?:[.!?, ]|$)/.test(normalize(message))
    || /\b(?:i(?:'m| am) not safe|i (?:can't|cannot) (?:stay|keep myself) safe|i (?:don't|do not) feel safe)\b/.test(normalize(message));
}

export function safeReply(message: string, kind: "safe" | "danger" | null = "safe"): boolean {
  const affirmative = kind === "danger" ? /^(?:no|nope|hindi)\b/ : /^(?:yes|yeah|yep|i(?:'m| am) safe|safe|oo)\b/;
  return affirmative.test(normalize(message)) && !unsafeReply(message, kind);
}

export function conversationState(history: ChatMessage[]): ConversationState {
  const state: ConversationState = {
    highest_level: "LOW", safety_question_active: false, safety_question_kind: null,
    prior_high_concern: false, prior_immediate_concern: false,
  };
  for (const message of history) {
    if (message.role === "assistant") {
      // A later unrelated assistant message does not erase an unanswered safety question.
      const kind = safetyQuestionKind(message.content);
      if (kind) { state.safety_question_active = true; state.safety_question_kind = kind; }
      continue;
    }
    let level = analyzeSafety(message.content).level;
    if (state.safety_question_active && unsafeReply(message.content, state.safety_question_kind)) level = "IMMEDIATE_SAFETY";
    state.highest_level = higher(state.highest_level, level);
    state.prior_high_concern ||= level === "HIGH_CONCERN" || level === "IMMEDIATE_SAFETY";
    state.prior_immediate_concern ||= level === "IMMEDIATE_SAFETY";
    // Keep ambiguous replies in the safety workflow; affirmative safety replies resolve the question only.
    if (safeReply(message.content, state.safety_question_kind) && level !== "IMMEDIATE_SAFETY" && level !== "HIGH_CONCERN") {
      state.safety_question_active = false;
      state.safety_question_kind = null;
    }
  }
  return state;
}
