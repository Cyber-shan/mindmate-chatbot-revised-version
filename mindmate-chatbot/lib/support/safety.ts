import config from "./rules.json" with { type: "json" };
import { higher, type ChatMessage, type ConversationState, type SafetySignal, type SupportLevel } from "./types.ts";

export const ruleVersion = config.version;
export const ruleReviewStatus = config.review_status;

const informalWords: Record<string, string> = {
  wanna: "want to", wana: "want to", gonna: "going to", idk: "i don't know",
  im: "i'm", ive: "i've", dont: "don't", doesnt: "doesn't", cant: "can't", wont: "won't",
  didnt: "didn't", wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't",
  isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't",
  havent: "haven't", hasnt: "hasn't", hadnt: "hadn't",
};
const informalPattern = new RegExp(`\\b(?:${Object.keys(informalWords).join("|")})\\b`, "g");

/** Preserve negation and punctuation; use a separate normalized copy for matching. */
export function normalize(text: string): string {
  return text.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').toLowerCase()
    .replace(/\s+/g, " ").trim()
    .replace(informalPattern, (word) => informalWords[word])
    .replace(/\bwant 2\b/g, "want to")
    // Join reflexive spellings without changing compounds such as "my self esteem".
    .replace(/\b(my|your|him|her)[ -]+self\b(?![ -]+(?:esteem|confidence|care|image|worth|respect|control|expression|portrait|awareness)\b)/g, "$1self")
    .replace(/\bthem[ -]+selves\b/g, "themselves")
    .replace(/\bk1ll\b/g, "kill").replace(/\bsu[1i]c[1i]de\b/g, "suicide")
    .trim();
}

const compiledRules = config.rules.map((rule) => ({
  ...rule, level: rule.level as SupportLevel,
  fallback: rule.id === "ambiguous_safety_language",
  current_action: "current_action" in rule && rule.current_action === true,
  patterns: rule.patterns.map((pattern) => new RegExp(pattern, "g")),
}));
const primaryRules = compiledRules.filter((rule) => !rule.fallback);
const fallbackRules = compiledRules.filter((rule) => rule.fallback);
const academic = /\b(?:assignment|psychology class|research paper|define|definition|what does|what is|lyrics|song|movie|novel|quotation)\b/;
const historical = /\b(?:used to|(?:days?|weeks?|months?|years?) ago|last (?:week|month|year|night)|yesterday|in the past|back then|when i was (?:younger|a child|a teenager)|dati|noon)\b/;
const current = /\b(?:now|today|tonight|currently|again|ngayon|mamaya)\b/;
const safeNow = /\b(?:i(?:'m| am) safe (?:now|today)|no longer (?:feel|want|think)|not anymore)\b/;
const thirdParty = /\b(?:my (?:friend|classmate|sister|brother|partner)|he|she|they) (?:said|says|told|wrote|texted|asked|is|wants?|plans?)\b/;

function negated(prefix: string): boolean {
  // Scope negation to the current clause, never to the whole message.
  // Uncertainty about a safety disclosure is not a denial of that disclosure.
  const scope = prefix
    .replace(/\b(?:don't|do not|doesn't|does not|didn't|did not) know\b(?: (?:if|whether))?|\bnot (?:sure|certain)\b(?: (?:if|whether))?/g, "uncertain whether")
    .replace(/\b(?:can't|cannot|couldn't|could not|won't|will not|not able to|unable to) stop\b/g, "unable to stop");
  return /\b(?:not|never|don't|do not|doesn't|does not|didn't|did not|isn't|is not|aren't|are not|wasn't|was not|weren't|were not|wouldn't|would not|won't|will not|no (?:intention|plans?|desire|wish) (?:to|of)|ayaw|hindi)\b[^.!?;,:]{0,32}$/.test(scope);
}

function quoteSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let openingCharacter = "";
  let openingIndex = -1;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== '"' && character !== "'") continue;
    // Apostrophes within contractions are not quotation boundaries.
    if (character === "'" && /[a-z0-9]/.test(text[index - 1] ?? "") && /[a-z0-9]/.test(text[index + 1] ?? "")) continue;
    if (openingCharacter === character) {
      spans.push({ start: openingIndex + 1, end: index });
      openingCharacter = "";
      openingIndex = -1;
    } else if (openingIndex < 0 && (character === '"' || index === 0 || /[\s(:,]/.test(text[index - 1]))) {
      openingCharacter = character;
      openingIndex = index;
    }
  }
  // An unclosed quote is ambiguous and must not suppress a possible disclosure.
  return spans;
}

function matchContext(text: string, index: number, length: number, quotes: { start: number; end: number }[]) {
  const quote = quotes.find((span) => span.start <= index && span.end >= index + length);
  // Attribution belongs to the whole quote, including quotes spanning sentences.
  const anchor = quote ? quote.start - 1 : index;
  const sentenceStart = Math.max(text.lastIndexOf(".", anchor - 1), text.lastIndexOf("!", anchor - 1), text.lastIndexOf("?", anchor - 1), text.lastIndexOf(";", anchor - 1)) + 1;
  let start = sentenceStart;
  // A separate first-person clause starts its own negation and subject scope.
  const contrast = [...text.slice(sentenceStart, index + 1).matchAll(/\b(?:but|however|yet)\b|\band\s+(?=i\b)/g)].at(-1);
  if (contrast) start += contrast.index + contrast[0].length;
  const after = quote ? quote.end + 1 : index + length;
  const endIndex = text.slice(after).search(/[.!?;]/);
  const end = endIndex < 0 ? text.length : after + endIndex;
  const clause = text.slice(start, end);
  const prefix = text.slice(start, index);
  const outerPrefix = quote ? text.slice(sentenceStart, quote.start - 1) : prefix;
  const attributionContrast = [...outerPrefix.matchAll(/\b(?:but|however|yet)\b|\band\s+(?=i\b)/g)].at(-1);
  const attribution = attributionContrast ? outerPrefix.slice(attributionContrast.index + attributionContrast[0].length) : outerPrefix;
  const personalQuote = /\bi (?:said|say|told|tell|wrote|write|texted|keep saying|keep thinking|am thinking|was thinking)\b/.test(attribution)
    || (quote && /\b(?:how i (?:feel|felt)|i (?:mean|meant) (?:it|this)|true for me)\b/.test(text.slice(quote.end + 1, end)));
  return {
    prefix: quote ? attribution : prefix, clause,
    negated: negated(prefix),
    involuntary: /\b(?:can't|cannot|not able to|unable to) stop\b/.test(prefix),
    historical: historical.test(quote ? attribution : prefix) || (historical.test(clause) && safeNow.test(clause)),
    thirdParty: thirdParty.test(prefix) || (quote && thirdParty.test(attribution)),
    academic: (quote && academic.test(attribution) && !personalQuote)
      || (!quote && academic.test(prefix) && /\b(?:phrase|sentence|example|means?)\b/.test(prefix)),
  };
}

export function analyzeSafety(message: string): SafetySignal {
  const text = normalize(message);
  const quotes = quoteSpans(text);
  const signal: SafetySignal = {
    level: "LOW", matched_rules: [], current_action: false,
    direct_intent: false, first_person_concern: false, temporal_immediacy: current.test(text), contexts: [],
  };
  const covered: { start: number; end: number }[] = [];
  const applyRule = (rule: typeof compiledRules[number]) => {
    for (const pattern of rule.patterns) {
      for (const match of text.matchAll(pattern)) {
        const index = match.index;
        if (rule.fallback && covered.some((range) => range.start <= index && range.end >= index + match[0].length)) continue;
        const context = matchContext(text, index, match[0].length, quotes);
        if (context.involuntary) signal.contexts.push("involuntary_thoughts_or_action");
        if (context.negated) { signal.contexts.push("negated"); continue; }
        const explicitOther = rule.id === "third_party_safety_concern";
        const educational = (rule.fallback || explicitOther) && academic.test(context.clause) && !/\bi\b/.test(context.clause);
        if (context.academic || educational) { signal.contexts.push("academic_or_quoted"); continue; }
        if (/cut myself$/.test(match[0]) && /^ a (?:slice|piece) of (?:cake|pie|bread)\b/.test(text.slice(index + match[0].length))) {
          signal.contexts.push("ordinary_expression"); continue;
        }
        let level = rule.level;
        const other = explicitOther || context.thirdParty;
        if (other) { level = "HIGH_CONCERN"; signal.contexts.push("third_party"); }
        else if (context.historical && !current.test(context.prefix.replace(safeNow, ""))) {
          level = "HIGH_CONCERN"; signal.contexts.push("historical");
        }
        signal.level = higher(signal.level, level);
        if (!other && (level === "HIGH_CONCERN" || level === "IMMEDIATE_SAFETY")) signal.first_person_concern = true;
        signal.matched_rules.push(rule.id);
        if (!rule.fallback && (level === "HIGH_CONCERN" || level === "IMMEDIATE_SAFETY")) covered.push({ start: index, end: index + match[0].length });
        if (level === "IMMEDIATE_SAFETY") {
          signal.current_action ||= rule.current_action === true;
          signal.direct_intent ||= rule.id === "direct_self_harm_intent";
        }
      }
    }
  };
  for (const rule of primaryRules) applyRule(rule);
  // Assess unmatched safety phrases locally, even when another clause matched a lower rule.
  for (const rule of fallbackRules) applyRule(rule);
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
  const text = normalize(message);
  if (/\b(?:not sure|uncertain|don't know|do not know)[^.!?;]{0,45}\b(?:stay|keep|remain|be|feel) (?:myself )?safe\b/.test(text)
    || /\bi (?:don't|do not) think i can (?:stay|keep|remain) (?:myself )?safe\b/.test(text)) return true;
  if (kind === "danger") return /^(?:yes|yeah|yep|oo|maybe|not sure|i don't know|i'm not sure|i am not sure)\b/.test(normalize(message)) || /\bi(?:'m| am) not safe\b/.test(normalize(message));
  return /^(?:no|nope|not really|not sure|unsure|i don't know|i do not know|i'm not sure|i am not sure|maybe|hindi|di ako sigurado)(?:[.!?, ]|$)/.test(normalize(message))
    || /\b(?:i(?:'m| am) not safe|i (?:can't|cannot) (?:stay|keep myself) safe|i (?:don't|do not) feel safe)\b/.test(normalize(message));
}

export function safeReply(message: string, kind: "safe" | "danger" | null = "safe"): boolean {
  const affirmative = kind === "danger" ? /^(?:no|nope|hindi)\b/ : /^(?:yes|yeah|yep|i(?:'m| am) safe|safe|oo)\b/;
  const text = normalize(message);
  const explicitSafe = kind !== "danger" && /(?:^|[.!?;,]|\band\b)\s*i(?:'m| am) (?:currently )?safe\b/.test(text);
  return (affirmative.test(text) || explicitSafe) && !unsafeReply(message, kind);
}

export function conversationState(history: ChatMessage[], previous?: ConversationState): ConversationState {
  const state: ConversationState = {
    highest_level: previous?.highest_level ?? "LOW",
    safety_question_active: previous?.safety_question_active ?? false,
    safety_question_kind: previous?.safety_question_active ? previous.safety_question_kind ?? "safe" : null,
    prior_high_concern: previous?.prior_high_concern ?? false,
    prior_immediate_concern: previous?.prior_immediate_concern ?? false,
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
