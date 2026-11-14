import { LEVELS, type ModelPrediction } from "./types.ts";

/** Prototype scores require an explicit local opt-in; failures never disable safety rules. */
export async function predict(message: string, signal?: AbortSignal): Promise<ModelPrediction | null> {
  const url = process.env.DISTRESS_CLASSIFIER_URL;
  if (!url) return null;
  try {
    const mode = process.env.DISTRESS_CLASSIFIER_MODE ?? "reviewed";
    if (mode !== "reviewed" && mode !== "prototype") return null;
    const endpoint = new URL("/predict", url);
    if (mode === "prototype" && (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) || endpoint.username || endpoint.password)) return null;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.DISTRESS_CLASSIFIER_TOKEN ? { Authorization: `Bearer ${process.env.DISTRESS_CLASSIFIER_TOKEN}` } : {}) },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || typeof data !== "object") return null;
    const prototype = data.model_mode === "prototype" && data.synthetic_data === true && data.language === "en" && data.release_approved === false && data.prototype_usable === true;
    const reviewed = data.release_approved === true && data.synthetic_data !== true && (data.model_mode === undefined || data.model_mode === "reviewed");
    if (!(mode === "prototype" ? prototype : reviewed) || typeof data.model_version !== "string" || !data.model_version || !data.scores || !data.thresholds) return null;
    if (!LEVELS.every((key) => typeof data.scores[key] === "number" && Number.isFinite(data.scores[key]) && data.scores[key] >= 0 && data.scores[key] <= 1)) return null;
    if (Math.abs(LEVELS.reduce((sum, key) => sum + data.scores[key], 0) - 1) > 0.001) return null;
    if (!["immediate", "high", "confidence"].every((key) => typeof data.thresholds[key] === "number" && Number.isFinite(data.thresholds[key]) && data.thresholds[key] > 0 && data.thresholds[key] <= 1)) return null;
    return { scores: data.scores, thresholds: data.thresholds, model_version: data.model_version, model_mode: mode };
  } catch { return null; }
}
