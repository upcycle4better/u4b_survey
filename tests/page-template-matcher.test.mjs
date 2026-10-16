import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  summarizePageTemplateMatch,
  validatePageTemplateProfiles
} from "../public/page-template-matcher.js";
import { PAGE_TEMPLATE_PROFILES, applyA4ScanLayout } from "../public/scan-layout.js";

const source = JSON.parse(await readFile(new URL("../public/data/school-visit-v1.json", import.meta.url), "utf8"));
const template = applyA4ScanLayout(structuredClone(source));

test("five page fingerprints match the Before, After and Feedback paper sequence", () => {
  assert.deepEqual(validatePageTemplateProfiles(template, PAGE_TEMPLATE_PROFILES), []);
  assert.deepEqual(
    Object.values(PAGE_TEMPLATE_PROFILES).map(profile => [profile.label, profile.optionCount]),
    [["Before 1", 26], ["Before 2", 24], ["After 1", 13], ["After 2", 26], ["Feedback", 4]]
  );
});

test("a strong checkbox border fingerprint is accepted", () => {
  const profile = PAGE_TEMPLATE_PROFILES[1];
  const result = summarizePageTemplateMatch(Array(profile.optionCount).fill(0.44), profile);
  assert.equal(result.matched, true);
  assert.equal(result.matchedAnchors, 26);
  assert.equal(result.anchorCoverage, 1);
});

test("the wrong checkbox count or weak page alignment is rejected", () => {
  const profile = PAGE_TEMPLATE_PROFILES[2];
  assert.equal(summarizePageTemplateMatch(Array(23).fill(0.45), profile).matched, false);
  assert.equal(summarizePageTemplateMatch(Array(24).fill(0.08), profile).matched, false);
});

test("feedback matching also requires the ruled-line signature", () => {
  const profile = PAGE_TEMPLATE_PROFILES[5];
  assert.equal(summarizePageTemplateMatch(Array(4).fill(0.45), profile, { lineScore: 0.18 }).matched, true);
  assert.equal(summarizePageTemplateMatch(Array(4).fill(0.45), profile, { lineScore: 0.03 }).matched, false);
});
