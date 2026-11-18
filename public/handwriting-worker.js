const TRANSFORMERS_MODULE = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const MODEL_ID = "datalab-to/chandra-ocr-2";

let recognizerPromise = null;

function report(requestId, detail) {
  self.postMessage({ type: "progress", requestId, detail });
}

async function getRecognizer(requestId) {
  if (!recognizerPromise) {
    recognizerPromise = (async () => {
      const { env, pipeline } = await import(TRANSFORMERS_MODULE);
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      return pipeline("image-to-text", MODEL_ID, {
        dtype: "q8",
        progress_callback: progress => {
          report(requestId, {
            stage: "model",
            file: progress.file || "handwriting model",
            progress: Number.isFinite(progress.progress) ? progress.progress : null,
            status: progress.status || "loading"
          });
        }
      });
    })().catch(error => {
      recognizerPromise = null;
      throw error;
    });
  }
  return recognizerPromise;
}

function generatedText(output) {
  const first = Array.isArray(output) ? output[0] : output;
  return String(first?.generated_text || "").trim();
}

self.addEventListener("message", async event => {
  const { type, requestId, fields } = event.data || {};
  if (type !== "recognize" || !requestId || !Array.isArray(fields)) return;
  try {
    const recognizer = await getRecognizer(requestId);
    const results = [];
    const totalImages = fields.reduce(
      (sum, field) => sum + (field.lines || []).reduce((lineSum, line) => lineSum + (line.images?.length || 0), 0),
      0
    );
    let completedImages = 0;
    for (const field of fields) {
      const candidates = [];
      for (const line of field.lines || []) {
        const lineCandidates = [];
        for (const image of line.images || []) {
          report(requestId, {
            stage: "recognition",
            key: field.key,
            completed: completedImages,
            total: totalImages
          });
          const maxNewTokens = field.key === "STUDENT_NAME" ? 24 : 96;
          const output = await recognizer(image, { max_new_tokens: maxNewTokens });
          lineCandidates.push(generatedText(output));
          completedImages += 1;
        }
        candidates.push(lineCandidates);
      }
      results.push({ key: field.key, candidates, multiline: Boolean(field.multiline) });
    }
    report(requestId, { stage: "recognition", completed: totalImages, total: totalImages });
    self.postMessage({ type: "result", requestId, fields: results });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: error instanceof Error ? error.message : "Local handwriting recognition failed."
    });
  }
});
