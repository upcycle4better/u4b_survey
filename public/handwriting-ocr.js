let workerInstance = null;
let nextRequestId = 1;
const pendingRequests = new Map();

export function normalizeRecognizedText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function combineRecognizedLines(lines, multiline = false) {
  const cleaned = lines.map(normalizeRecognizedText).filter(Boolean);
  return cleaned.join(multiline ? "\n" : " ");
}

export function normalizeRecognizedField(key, value) {
  const normalized = normalizeRecognizedText(value);
  if (!normalized) return "";
  if (key === "STUDENT_NAME") {
    const cleaned = normalized
      .replace(/[^\p{L}\p{M}' -]+/gu, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/^[-' ]+|[-' ]+$/g, "");
    return Array.from(cleaned).slice(0, 20).join("").trimEnd();
  }
  return normalized;
}

export function recognizedCandidateQuality(key, value) {
  const normalized = normalizeRecognizedField(key, value);
  if (!normalized) return -Infinity;
  const compact = normalized.replace(/\s/g, "");
  const repeatedPenalty = /(.)\1{4,}/u.test(normalized) ? 1.5 : 0;
  if (key === "STUDENT_NAME") {
    const letters = (normalized.match(/\p{L}/gu) || []).length;
    const words = normalized.split(/\s+/).filter(Boolean).length;
    return letters + Math.min(words, 5) * 0.35 - Math.max(0, compact.length - 45) * 0.4 - repeatedPenalty;
  }
  const letters = (normalized.match(/\p{L}/gu) || []).length;
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const punctuationNoise = (normalized.match(/[|_~^`]/g) || []).length;
  return letters + Math.min(words, 18) * 0.2 - punctuationNoise * 1.25 - repeatedPenalty;
}

export function chooseRecognizedCandidate(key, candidates) {
  let best = "";
  let bestScore = -Infinity;
  for (const candidate of candidates || []) {
    const normalized = normalizeRecognizedField(key, candidate);
    const score = recognizedCandidateQuality(key, normalized);
    if (score > bestScore) {
      best = normalized;
      bestScore = score;
    }
  }
  return best;
}

function rejectPending(error) {
  for (const request of pendingRequests.values()) request.reject(error);
  pendingRequests.clear();
}

function createWorker() {
  const worker = new Worker("/handwriting-worker.js", { type: "module" });
  worker.addEventListener("message", event => {
    const message = event.data || {};
    const request = pendingRequests.get(message.requestId);
    if (!request) return;
    if (message.type === "progress") {
      request.onProgress?.(message.detail || {});
      return;
    }
    pendingRequests.delete(message.requestId);
    if (message.type === "result") request.resolve(message.fields || []);
    else request.reject(new Error(message.error || "Local handwriting recognition failed."));
  });
  worker.addEventListener("error", event => {
    rejectPending(new Error(event.message || "The local handwriting worker could not start."));
    worker.terminate();
    workerInstance = null;
  });
  return worker;
}

export function recognizeHandwritingLocally(fields, { onProgress, timeoutMs = 180000 } = {}) {
  if (!Array.isArray(fields) || !fields.length) return Promise.resolve([]);
  if (typeof Worker === "undefined") return Promise.reject(new Error("This browser does not support local handwriting recognition."));
  if (!workerInstance) workerInstance = createWorker();
  const requestId = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout?.(() => {
      if (!pendingRequests.has(requestId)) return;
      pendingRequests.delete(requestId);
      reject(new Error("Local handwriting recognition timed out. Checkbox extraction is complete; review handwritten fields manually."));
      workerInstance?.terminate();
      workerInstance = null;
    }, timeoutMs);
    pendingRequests.set(requestId, {
      resolve(value) {
        if (timeout) globalThis.clearTimeout?.(timeout);
        resolve(value);
      },
      reject(error) {
        if (timeout) globalThis.clearTimeout?.(timeout);
        reject(error);
      },
      onProgress
    });
    workerInstance.postMessage({ type: "recognize", requestId, fields });
  });
}
