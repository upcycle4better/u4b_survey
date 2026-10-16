const STORAGE_KEY = "u4b-survey-calibration-v4";

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))];
}

export function calibratePageTone(pixels, stride = 5) {
  const values = [];
  for (let y = 0; y < pixels.height; y += stride) {
    for (let x = 0; x < pixels.width; x += stride) {
      const index = (y * pixels.width + x) * 4;
      values.push(
        pixels.data[index] * 0.2126 + pixels.data[index + 1] * 0.7152 + pixels.data[index + 2] * 0.0722
      );
    }
  }
  values.sort((left, right) => left - right);
  const black = Math.min(120, percentile(values, 0.015));
  const white = Math.max(205, percentile(values, 0.92));
  return { black, white: Math.max(black + 80, white) };
}

export function normalizeTone(value, tone) {
  if (!tone) return value;
  return Math.max(0, Math.min(255, ((value - tone.black) / (tone.white - tone.black)) * 255));
}

export function multiThresholdVote(samples, thresholds = [165, 185, 205]) {
  if (!samples?.length) return { score: 0, densities: thresholds.map(() => 0), agreement: 0 };
  const densities = thresholds.map(threshold => samples.filter(value => value < threshold).length / samples.length);
  const sorted = [...densities].sort((left, right) => left - right);
  const score = sorted[Math.floor(sorted.length / 2)];
  const spread = sorted[sorted.length - 1] - sorted[0];
  return { score, densities, agreement: Math.max(0, 1 - spread * 2) };
}

function safeProfile(profile) {
  return profile && typeof profile === "object" ? profile : { version: 4, questions: {} };
}

export function loadCalibration(storage = globalThis.localStorage) {
  try {
    return safeProfile(JSON.parse(storage?.getItem(STORAGE_KEY) || ""));
  } catch {
    return safeProfile(null);
  }
}

export function clearCalibration(storage = globalThis.localStorage) {
  try { storage?.removeItem(STORAGE_KEY); } catch { /* local calibration is optional */ }
}

export function learnedThreshold(profile, questionKey, fallback) {
  const threshold = Number(profile?.questions?.[questionKey]?.threshold);
  return Number.isFinite(threshold) ? Math.max(0.02, Math.min(0.28, threshold)) : fallback;
}

export function recordCalibration(profile, questionKey, scores, selectedValues, storage = globalThis.localStorage) {
  const next = safeProfile(profile);
  const record = next.questions[questionKey] || { positive: [], negative: [], threshold: null };
  const selected = new Set(Array.isArray(selectedValues) ? selectedValues : selectedValues ? [selectedValues] : []);
  for (const [value, rawScore] of Object.entries(scores || {})) {
    const score = Number(rawScore);
    if (!Number.isFinite(score)) continue;
    const bucket = selected.has(value) ? record.positive : record.negative;
    bucket.push(score);
    if (bucket.length > 60) bucket.splice(0, bucket.length - 60);
  }
  if (record.positive.length >= 3 && record.negative.length >= 5) {
    const positive = [...record.positive].sort((a, b) => a - b);
    const negative = [...record.negative].sort((a, b) => a - b);
    const positiveFloor = percentile(positive, 0.2);
    const negativeCeiling = percentile(negative, 0.8);
    if (positiveFloor > negativeCeiling) record.threshold = (positiveFloor + negativeCeiling) / 2;
  }
  next.questions[questionKey] = record;
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* local calibration is optional */ }
  return next;
}
