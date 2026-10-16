import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("the upload accepts multiple PDFs and combines them in one survey array", () => {
  assert.match(html, /id="pdf-input"[^>]*\bmultiple\b/);
  assert.match(app, /async function acceptFiles\(fileList\)/);
  assert.match(app, /for \(const source of sources\)/);
  assert.match(app, /state\.surveys\.push\(await extractSurvey/);
  assert.match(app, /The Excel charts use the combined total/);
  assert.match(app, /const files = \[\.\.\.state\.files\]/);
  assert.match(app, /files\.push\(file\)/);
  assert.match(html, /id="selected-file-list"/);
  assert.match(html, /id="add-files-button"/);
  assert.match(html, /Extract all selected PDFs/);
  assert.match(app, /addFilesButton\.addEventListener\("click"/);
});

test("review pages are linked to the PDF that supplied each survey", () => {
  assert.match(app, /state\.pdfs\.get\(currentSurvey\(\)\.sourceFile\)/);
  assert.match(app, /sourceFile: file\.name/);
  assert.doesNotMatch(app, /state\.pdf\b|state\.file\b/);
});
