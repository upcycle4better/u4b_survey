import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

import { buildSurveyWorkbook, columnName, escapeXml } from "../public/xlsx-export.js";

test("Excel column names work across single and multiple letters", () => {
  assert.equal(columnName(1), "A");
  assert.equal(columnName(26), "Z");
  assert.equal(columnName(27), "AA");
  assert.equal(columnName(39), "AM");
});

test("Excel XML text is escaped safely", () => {
  assert.equal(escapeXml(`A&B <C> "D" 'E'`), "A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;");
});

test("a complete workbook contains 16 charts and uses the full response range", async () => {
  if (!globalThis.JSZip) {
    vm.runInThisContext(await readFile(new URL("../public/vendor/jszip.min.js", import.meta.url), "utf8"));
  }
  const template = JSON.parse(await readFile(new URL("../public/data/school-visit-v1.json", import.meta.url), "utf8"));
  const emptyAnswers = Object.fromEntries(template.questions.map(question => [
    question.key,
    { value: question.type === "multi" ? [] : "" }
  ]));
  const surveys = Array.from({ length: 650 }, (_, index) => ({
    id: `survey-${index + 1}`,
    surveyIndex: index + 1,
    status: "reviewed",
    sourceFile: index % 2 ? "scan-b.pdf" : "scan-a.pdf",
    answers: emptyAnswers
  }));
  const workbook = await buildSurveyWorkbook({ template, surveys, batch: { school: "Test", visitDate: "2026-08-24" } });
  const zip = await globalThis.JSZip.loadAsync(await workbook.arrayBuffer());
  const files = Object.keys(zip.files);
  assert.equal(files.filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name)).length, 16);
  const chartData = await zip.file("xl/worksheets/sheet2.xml").async("string");
  const responses = await zip.file("xl/worksheets/sheet1.xml").async("string");
  assert.match(chartData, /\$651/);
  assert.doesNotMatch(chartData, /\$501/);
  assert.match(responses, /scan-a\.pdf/);
  assert.match(responses, /scan-b\.pdf/);
});
