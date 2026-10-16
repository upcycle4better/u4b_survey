import test from "node:test";
import assert from "node:assert/strict";

import {
  ignoredSourcePageNumber,
  resolveSourcePagesPerSurvey,
  sourcePageNumber
} from "../public/survey-pages.js";

test("six-page scans skip the sixth page of every student", () => {
  assert.equal(resolveSourcePagesPerSurvey(66, 6), 6);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) => sourcePageNumber(1, index + 1, 6)),
    [7, 8, 9, 10, 11]
  );
  assert.equal(ignoredSourcePageNumber(1, 6), 12);
});

test("older five-page scans remain supported", () => {
  assert.equal(resolveSourcePagesPerSurvey(55, 6), 5);
  assert.equal(sourcePageNumber(1, 1, 5), 6);
  assert.equal(ignoredSourcePageNumber(1, 5), null);
});

test("an incomplete batch is rejected", () => {
  assert.equal(resolveSourcePagesPerSurvey(17, 6), null);
  assert.throws(() => sourcePageNumber(0, 6, 6), RangeError);
});

test("a 54-page scan resolves to nine six-page student groups", () => {
  const totalPages = 54;
  const pagesPerSurvey = resolveSourcePagesPerSurvey(totalPages, 6);
  assert.equal(pagesPerSurvey, 6);
  assert.equal(totalPages / pagesPerSurvey, 9);
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => ignoredSourcePageNumber(index, pagesPerSurvey)),
    [6, 12, 18, 24, 30, 36, 42, 48, 54]
  );
});

test("the supplied 168-page scan resolves to 28 student surveys", () => {
  const totalPages = 168;
  const pagesPerSurvey = resolveSourcePagesPerSurvey(totalPages, 6);
  assert.equal(pagesPerSurvey, 6);
  assert.equal(totalPages / pagesPerSurvey, 28);
  assert.equal(ignoredSourcePageNumber(27, pagesPerSurvey), 168);
});
