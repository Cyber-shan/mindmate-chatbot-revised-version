import { normalize } from "./safety.ts";

/** A broad disclosure cue, not a diagnosis or a replacement for safety rules. */
export function hasPersonalDistress(message: string): boolean {
  const emotions = "(?:sad|lonely|anxious|depressed|stressed|overwhelmed|hopeless|worthless|exhausted|scared|afraid|panicking|grieving|crying|empty|numb|miserable|terrified|distressed|struggling|upset|heartbroken|burnt out|burned out|emotionally (?:drained|exhausted)|in pain|at (?:my |a )?breaking point|not okay|not ok)";
  const modifiers = "(?:(?:very|so|really|quite|a little|a bit|extremely|completely|constantly|still|always|often|increasingly) )*";
  // Remove explicit denials locally; a separate disclosure still remains visible.
  const denial = new RegExp(`\\bi(?:(?:'m| am| feel) (?:not|never)(?: feeling)?| (?:don't|do not|never) feel| no longer (?:feel|am)) ${modifiers}${emotions}\\b`, "g");
  const text = normalize(message).replace(denial, " ");
  const disclosure = new RegExp(`\\bi(?:'m| am| feel| felt| have been feeling|'ve been feeling| am feeling|'m feeling| keep feeling) ${modifiers}${emotions}\\b`);
  return disclosure.test(text)
    || /\bi feel (?:so |very |really )?alone\b/.test(text)
    || /\bmy (?:anxiety|depression|worries|low mood|stress|grief)\b/.test(text)
    || /\bi (?:(?:can't|cannot|am unable to) (?:sleep|concentrate|relax|stop crying)|keep (?:crying|worrying|panicking)|miss (?:my family|home)|struggle with (?:anxiety|depression|my mood)|have (?:been having )?panic attacks?)\b/.test(text)
    || /\b(?:lagi|palagi) (?:akong?|ko) (?:malungkot|kinakabahan|umiiyak)\b/.test(text);
}
