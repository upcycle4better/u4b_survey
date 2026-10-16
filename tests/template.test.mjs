import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const template = JSON.parse(await readFile(new URL("../public/data/school-visit-v1.json", import.meta.url), "utf8"));

test("survey template has stable unique question keys", () => {
  const keys = template.questions.map(question => question.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(template.pagesPerSurvey, 5);
  for (const key of ["Q1", "Q9", "Q10", "Q18", "Q19", "F1", "F3"]) {
    assert.ok(keys.includes(key), `missing ${key}`);
  }
});

test("all checkbox coordinates are inside their pages", () => {
  let optionCount = 0;
  for (const question of template.questions) {
    assert.ok(question.page >= 1 && question.page <= template.pagesPerSurvey, `${question.key} has invalid page`);
    for (const option of question.options || []) {
      optionCount += 1;
      const [x0, y0, x1, y1] = option.box;
      assert.ok(x0 >= 0 && y0 >= 0, `${question.key}/${option.value} starts outside page`);
      assert.ok(x1 > x0 && y1 > y0, `${question.key}/${option.value} has invalid rectangle`);
      assert.ok(x1 <= template.pageWidth && y1 <= template.pageHeight, `${question.key}/${option.value} ends outside page`);
    }
  }
  assert.equal(optionCount, 93);
});

test("mark thresholds are calibrated for inside-box sampling", () => {
  assert.equal(template.markThreshold, 0.075);
  assert.equal(template.singleMarkThreshold, 0.04);
  assert.equal(template.conflictThreshold, 0.09);
  assert.equal(template.ambiguityMargin, 0.015);
});

test("questions use supported data types", () => {
  const supported = new Set(["single", "multi", "text", "paragraph"]);
  for (const question of template.questions) assert.ok(supported.has(question.type), `${question.key} has unsupported type`);
});

test("only the requested handwritten fields are recognised", () => {
  const handwritten = template.questions.filter(question => ["text", "paragraph"].includes(question.type));
  assert.deepEqual(
    handwritten.filter(question => question.recognize !== false).map(question => question.key),
    ["STUDENT_NAME", "Q11", "F2", "F3"]
  );
  assert.equal(template.questions.find(question => question.key === "SCHOOL").recognize, false);
  assert.equal(template.questions.find(question => question.key === "SURVEY_DATE").recognize, false);
  assert.equal(template.questions.find(question => question.key === "GROUP_NUMBER").recognize, false);
  assert.equal(template.questions.find(question => question.key === "STUDENT_NAME").title, "Student name");
  assert.ok(!template.questions.some(question => question.key.endsWith("_OTHER")));
  for (const question of handwritten) {
    assert.equal(question.textBox.length, 4, `${question.key} is missing textBox coordinates`);
    const [x0, y0, x1, y1] = question.textBox;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 > x0 && y1 > y0, `${question.key} has an invalid textBox`);
    assert.ok(x1 <= template.pageWidth && y1 <= template.pageHeight, `${question.key} textBox is outside the page`);
  }
});
