import { LEVELS, type ModelPrediction } from "./types.ts";

/** ML is optional; malformed, unreviewed, unavailable or slow models never disable safety rules. */
export async function predict(message: string, signal?: AbortSignal): Promise<ModelPrediction | null> {
  const url = process.env.DISTRESS_CLASSIFIER_URL;
  if (!url) return null;
  try {
    const response = await fetch(new URL("/predict", url), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.DISTRESS_CLASSIFIER_TOKEN ? { Authorization: `Bearer ${process.env.DISTRESS_CLASSIFIER_TOKEN}` } : {}) },
      body: JSON.stringify({ text: message }),
      signal: AbortSignal.any([AbortSignal.timeout(1500), ...(signal ? [signal] : [])]),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.release_approved !== true || typeof data.model_version !== "string" || !data.model_version || !data.scores || !data.thresholds) return null;
    if (!LEVELS.every((key) => typeof data.scores[key] === "number" && Number.isFinite(data.scores[key]) && data.scores[key] >= 0 && data.scores[key] <= 1)) return null;
    if (Math.abs(LEVELS.reduce((sum, key) => sum + data.scores[key], 0) - 1) > 0.001) return null;
    if (!["immediate", "high", "confidence"].every((key) => typeof data.thresholds[key] === "number" && Number.isFinite(data.thresholds[key]) && data.thresholds[key] > 0 && data.thresholds[key] <= 1)) return null;
    return { scores: data.scores, thresholds: data.thresholds, model_version: data.model_version };
  } catch { return null; }
}
