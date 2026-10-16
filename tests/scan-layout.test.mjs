import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PAGE_REGISTRATION_LINES,
  SCAN_PAGE,
  applyA4ScanLayout,
  averageOffset
} from "../public/scan-layout.js";

const source = JSON.parse(await readFile(new URL("../public/data/school-visit-v1.json", import.meta.url), "utf8"));

test("A4 scanner layout covers every checkbox without replacing reference coordinates", () => {
  const template = applyA4ScanLayout(structuredClone(source));
  const options = template.questions.flatMap(question => question.options || []);
  assert.equal(options.length, 93);
  assert.ok(options.every(option => option.referenceBox && option.scanBox));
  assert.ok(options.every(option => option.scanBox[0] >= 0 && option.scanBox[2] <= SCAN_PAGE.width));
  assert.ok(options.every(option => option.scanBox[1] >= 0 && option.scanBox[3] <= SCAN_PAGE.height));
  assert.notDeepEqual(options[0].scanBox, options[0].referenceBox);
});

test("scanner layout preserves all requested handwriting crop fields", () => {
  const template = applyA4ScanLayout(structuredClone(source));
  const textQuestions = template.questions.filter(question => question.scanTextBox);
  const mapped = textQuestions.map(question => question.key);
  assert.deepEqual(mapped, ["STUDENT_NAME", "Q11", "F2", "F3"]);
  assert.ok(textQuestions.every(question => question.scanTextCropMode === "calibrated-text-region"));
});

test("handwriting borders include answer lines but exclude adjacent printed fields", () => {
  const template = applyA4ScanLayout(structuredClone(source));
  const byKey = Object.fromEntries(template.questions.map(question => [question.key, question]));
  assert.deepEqual(byKey.STUDENT_NAME.scanTextBox, [167, 117, 532, 139]);
  assert.ok(byKey.STUDENT_NAME.scanTextBox[3] < 145, "name crop reaches the group/date row");
  assert.deepEqual(byKey.Q11.scanTextBox, [55, 348, 532, 465]);
  assert.deepEqual(byKey.Q11.referenceTextBox, [44, 320, 562, 435]);
  assert.deepEqual(byKey.F2.scanTextBox, [58, 292, 532, 423]);
  assert.deepEqual(byKey.F3.scanTextBox, [58, 475, 532, 610]);
  assert.deepEqual(byKey.F3.referenceTextBox, [44, 447, 562, 583]);
});

test("page text alignment uses the median checkbox offset", () => {
  assert.deepEqual(averageOffset([[8, 12], [4, 10], [6, 14]]), [6, 12]);
  assert.deepEqual(averageOffset([]), [0, 0]);
});

test("feedback page registration uses ruled lines across the page height", () => {
  const lines = PAGE_REGISTRATION_LINES[5];
  assert.equal(lines.length, 6);
  assert.ok(lines.every(line => line[0] < 70 && line[2] > 520));
  assert.ok(lines.at(-1)[1] - lines[0][1] > 240);
});
