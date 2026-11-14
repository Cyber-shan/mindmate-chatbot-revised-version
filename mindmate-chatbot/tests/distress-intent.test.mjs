import assert from "node:assert/strict";
import { test } from "node:test";
import { hasPersonalDistress } from "../lib/support/intent.ts";

test("disclosures remain visible in questions, school topics and separate clauses", () => {
  for (const text of [
    "I am anxious about my assignment", "I'm stressed about my research",
    "Can you explain why I feel sad?", "I don't know why I feel anxious",
    "I don't feel anxious, but I am sad", "I've been feeling very lonely lately",
    "I keep crying after class", "I can't relax even after finishing my work",
    "My anxiety makes it hard to focus", "I feel emotionally drained",
    "I am feeling overwhelmed", "I have panic attacks before presentations",
    "I feel not okay today", "I miss my family since moving away",
  ]) assert.equal(hasPersonalDistress(text), true, text);
});

test("denials, third-party descriptions, physical solitude and educational topics are not personal disclosures", () => {
  for (const text of [
    "I don't feel anxious; help me plan a game night", "I do not feel depressed",
    "I'm not feeling sad", "I am not very anxious", "I never feel depressed",
    "I no longer feel stressed", "I am studying depression for my assignment",
    "Explain anxiety to me", "Define depression for my research",
    "My friend is anxious and I want to help", "I watched a sad movie",
    "I am alone at home doing homework", "I am researching why people feel sad",
    "How do I stop playing games?", "What caused the economic crisis?",
  ]) assert.equal(hasPersonalDistress(text), false, text);
});
