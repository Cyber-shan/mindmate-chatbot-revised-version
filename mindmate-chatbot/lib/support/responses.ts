import type { StudentSupport, SupportDecision } from "./types.ts";

// Philippines is the installation locale, not an inference about an individual student's location.
// Source: local-hotline lookup, 2026-11-08. Reverify before institutional release.
export function supportResources(): StudentSupport["resources"] {
  return process.env.MINDMATE_COUNTRY === "PH" ? [
    { label: "NCMH Crisis Hotline: 1553 (Philippines)", href: "tel:+631553?oai_link_source=model_response_hotline" },
  ] : [];
}

export function safetyReply(decision: SupportDecision): string {
  const resource = supportResources().length ? " If you are in the Philippines, you can call the NCMH Crisis Hotline at 1553." : " Contact a crisis support service in your country.";
  if (decision.subject === "other") {
    return "Thank you for looking out for someone else. Are they in immediate danger or have they already hurt themselves? If so, contact local emergency services or go to the nearest emergency department, and involve a trusted person who can stay with them safely." + resource;
  }
  if (decision.level === "IMMEDIATE_SAFETY") {
    return "I'm glad you told me. Are you safe right now, or have you already hurt yourself or taken something? If you have already acted or might act soon, contact local emergency services or go to the nearest emergency department now. If you can, move away from anything you could use to hurt yourself and ask someone you trust to stay with you." + resource + " This chat cannot contact emergency services for you.";
  }
  return "Thank you for telling me; that sounds very difficult to carry. Are you safe right now? If you can, reach out to someone you trust or your school counselor so you have support with you." + resource;
}

export function studentSupport(decision: SupportDecision, queued: boolean): StudentSupport {
  return {
    safety_response_required: decision.safety_response_required,
    review_status: !decision.requires_human_review ? "not_required" : queued ? "queued" : "unavailable",
    resources: decision.safety_response_required ? supportResources() : [],
  };
}
