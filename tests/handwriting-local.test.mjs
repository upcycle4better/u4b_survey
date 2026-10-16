import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  chooseRecognizedCandidate,
  combineRecognizedLines,
  normalizeRecognizedField,
  normalizeRecognizedText
} from "../public/handwriting-ocr.js";
import { HANDWRITING_PREPROCESS, expandTextRegion, inkBounds } from "../public/handwriting-preprocess.js";

test("local handwriting text is normalised without changing wording", () => {
  assert.equal(normalizeRecognizedText("  Recycle   old clothes  . "), "Recycle old clothes.");
});

test("handwriting lines are joined according to the field type", () => {
  assert.equal(combineRecognizedLines(["Student", "Name"], false), "Student Name");
  assert.equal(combineRecognizedLines(["First line", "Second line"], true), "First line\nSecond line");
});

test("student names use field-specific cleanup while other text remains unchanged", () => {
  assert.equal(normalizeRecognizedField("STUDENT_NAME", "  Chelsea_123  "), "Chelsea");
  assert.ok(normalizeRecognizedField("STUDENT_NAME", "A very long student name here").length <= 20);
  assert.equal(normalizeRecognizedField("F3", "  More workshop time. "), "More workshop time.");
});

test("handwriting crops include padding before local alignment", () => {
  assert.deepEqual(expandTextRegion([164, 70, 562, 99]), [156, 62, 570, 107]);
  assert.deepEqual(expandTextRegion([164, 70, 562, 99], 6, 2), [158, 68, 568, 101]);
  assert.equal(HANDWRITING_PREPROCESS.lineTargetHeight, 160);
});

test("handwriting input is tightly cropped around retained ink", () => {
  const width = 20;
  const height = 10;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 3; y <= 6; y += 1) {
    for (let x = 7; x <= 11; x += 1) data[(y * width + x) * 4] = 0;
  }
  assert.deepEqual(inkBounds(data, width, height, { padding: 2 }), [5, 1, 14, 9]);
  assert.equal(inkBounds(new Uint8ClampedArray(width * height * 4).fill(255), width, height), null);
});

test("the browser worker remains available as a free fallback with no OpenAI endpoint", async () => {
  const [app, worker, environment] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/handwriting-worker.js", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8")
  ]);
  assert.match(app, /recognizeHandwritingLocally/);
  assert.match(app, /findTextRegionOffset/);
  assert.match(app, /scanTextCropMode === "calibrated-text-region"/);
  assert.match(app, /const borderY = 1/);
  assert.match(app, /cleaned\.soft/);
  assert.match(app, /thickenInkCanvas/);
  assert.match(app, /wholeFieldImage/);
  assert.match(app, /Confirm student name/);
  assert.match(app, /nameConfirmed/);
  assert.doesNotMatch(app, /segmentHandwritingRows|findHandwritingBands/);
  assert.match(worker, /lineCandidates/);
  assert.match(worker, /Xenova\/trocr-small-handwritten/);
  assert.match(app, /registerPagePerspective/);
  assert.match(app, /calibratePageTone/);
  assert.match(app, /chooseExtractionScale/);
  assert.doesNotMatch(app, /extractWithRemoteBackend|hydrateRemoteSurveys/);
  assert.doesNotMatch(app, /\/api\/handwriting/);
  assert.doesNotMatch(environment, /HUGGINGFACE|OPENAI_API_KEY|OPENAI_VISION_MODEL|GROQ_API_KEY/);
});

test("the interface uses compact U4B branding without the removed hero", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const removedText of [
    "Scanned paper to verified data",
    "Local OMR + handwriting review",
    "HRD Training Survey · English v1",
    "Turn scanned surveys into a visual training report",
    "New batch",
    "Upload scanned PDF",
    "no paid API key is required"
  ]) {
    assert.ok(!html.includes(removedText), `interface still contains: ${removedText}`);
  }
  assert.match(html, /U4B Survey Intelligence/);
  assert.match(html, /\/assets\/u4b-logo\.png/);
  assert.match(html, /\/favicon\.ico/);
  assert.match(html, /\/assets\/favicon-32x32\.png/);
  assert.match(html, /\/assets\/apple-touch-icon\.png/);
  assert.match(html, /Developed by <strong>Cherfaoui Ayoub<\/strong>/);
  assert.match(html, /class="intake-grid"/);
  assert.match(html, /<option value="6" selected>6 pages \(Before, Before, After, After, Feedback, blank\)<\/option>/);
  assert.match(html, /<option value="5">5 pages<\/option>/);
  assert.doesNotMatch(html, /Local processing|local-badge/);
  const css = await readFile(new URL("../public/app.css", import.meta.url), "utf8");
  assert.match(css, /font-family:\s*"TT Norms Pro"/);
  assert.doesNotMatch(html, /⇧|✓|✅|⚠️/u);
});
