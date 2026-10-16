import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { resolveMultiChoice, resolveSingleChoice } from "../public/omr-tolerance.js";

const template = JSON.parse(await readFile(new URL("../public/data/school-visit-v1.json", import.meta.url), "utf8"));
const byKey = Object.fromEntries(template.questions.map(question => [question.key, question]));

// Privacy-safe mark scores measured from the direct 300 dpi Apeos scan
// 24082026154010-0001.pdf after blank-template subtraction. Handwriting and
// personal details are intentionally not stored in this regression fixture.
const cases = [
  ["GENDER", [0, 0.797], "Male"],
  ["AGE", [0.797, 0, 0, 0, 0, 0.385, 0.385], "7-9"],
  ["Q1", [1, 0.218, 0.385, 0], "I know nothing"],
  ["Q2", [0, 0.797, 0], "I care a little"],
  ["Q3", [0, 0, 1, 0.385], "Important"],
  ["Q4", [0.797, 0, 0, 0.385, 0.385, 0], ["Donate it to charity"]],
  ["Q5", [1, 0.259, 0.259, 0, 0.048, 1], ["It does not fit anymore", "Other"]],
  ["Q6", [0.259, 0.259, 1, 0.346, 0, 0.182], "Every few months"],
  ["Q7", [1, 0.182], "Yes"],
  ["Q8", [1, 0.259, 0.230, 0, 0, 0.346], "Weekly"],
  ["Q9", [1, 0.258, 0, 0], "Strongly disagree"],
  ["Q10", [1, 0.167, 0], "It has changed a lot"],
  ["Q12", [1, 0.1, 0, 0, 0.753, 0, 0], ["Happy", "Interested in the topic"]],
  ["Q13", [0, 0, 0.951], "I care a lot"],
  ["Q14", [0, 1, 0.077, 0.256], "A little important"],
  ["Q15", [0.288, 0.259, 1, 0.189, 0.189, 0], ["Give it to friends or family"]],
  ["Q16", [0, 1, 0.258, 0.141, 0.189, 0], "Every month"],
  ["Q17", [1, 0], "Yes"],
  ["Q18", [0.939, 0.258, 0, 0.182], "Strongly disagree"],
  ["Q19", [0.963, 0.259, 0.2, 0.2], "Very unlikely"],
  ["F1", [0, 1, 0.383, 0.038], "Quiz"]
];

test("all 21 tick questions from the supplied 300 dpi template scan resolve exactly", () => {
  for (const [key, scores, expected] of cases) {
    const question = byKey[key];
    assert.ok(question, `${key} is missing from the survey template`);
    assert.equal(question.options.length, scores.length, `${key} fixture does not cover every option`);
    const scored = question.options.map((option, index) => ({ value: option.value, score: scores[index] }));
    if (question.type === "multi") {
      const result = resolveMultiChoice(scored, {
        selectionThreshold: template.markThreshold,
        ambiguityMargin: template.ambiguityMargin
      });
      assert.deepEqual(result.value, expected, `${key} did not match the marked boxes`);
    } else {
      const result = resolveSingleChoice(scored, {
        selectionThreshold: template.singleMarkThreshold,
        conflictThreshold: template.conflictThreshold,
        ambiguityMargin: template.ambiguityMargin
      });
      assert.equal(result.value, expected, `${key} did not match the marked box`);
      assert.deepEqual(result.conflicts, [], `${key} produced a false second selection`);
    }
  }
});
