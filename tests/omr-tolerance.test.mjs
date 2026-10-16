import test from "node:test";
import assert from "node:assert/strict";

import {
  OMR_TOLERANCE,
  combineMarkFeatures,
  coarseAlignmentOffsets,
  estimateSkewSlope,
  fineAlignmentOffsets,
  insetCheckboxBox,
  localShiftPixels,
  multiChoiceConfidence,
  resolveMultiChoice,
  resolveSingleChoice
} from "../public/omr-tolerance.js";

test("multi-choice confidence follows the nearest threshold decision", () => {
  const uncertain = multiChoiceConfidence([{ score: 0.076 }, { score: 0.005 }, { score: 0.24 }], 0.075);
  const clear = multiChoiceConfidence([{ score: 0.16 }, { score: 0.01 }, { score: 0.02 }], 0.075);
  assert.ok(uncertain < clear);
  assert.equal(uncertain, 0.55);
});

test("checkbox detection stays strictly inside the printed box", () => {
  const source = [51, 160.6, 63, 172.3];
  const detected = insetCheckboxBox(source);
  assert.ok(detected[0] > source[0] && detected[1] > source[1]);
  assert.ok(detected[2] < source[2] && detected[3] < source[3]);
  assert.equal(OMR_TOLERANCE.detectionInsetPoints, 1.25);
});

test("local alignment search grows with scan scale and remains bounded", () => {
  const references = { 1: [40, 25, 546, 734] };
  assert.equal(localShiftPixels([80, 50, 1092, 1468], 1, references), 28);
  assert.equal(localShiftPixels([0, 0, 2000, 3000], 1, references), OMR_TOLERANCE.maximumShiftPixels);
});

test("marks receive support from ink contained inside the box", () => {
  const supported = combineMarkFeatures({ coreDensity: 0.9, expandedDensity: 0.08, strokeCoverage: 0.8 });
  assert.ok(supported > OMR_TOLERANCE.conflictThreshold);
  assert.equal(combineMarkFeatures({}), 0);
});

test("single-choice conflicts remain blank for manual review", () => {
  const conflict = resolveSingleChoice([
    { value: "Agree", score: 0.89 },
    { value: "Strongly agree", score: 0.67 },
    { value: "Disagree", score: 0.03 }
  ], { selectionThreshold: 0.04, conflictThreshold: 0.09, ambiguityMargin: 0.015 });
  assert.equal(conflict.value, "");
  assert.deepEqual(conflict.conflicts, ["Agree", "Strongly agree"]);
  assert.equal(conflict.flagged, true);
});

test("multi-choice threshold adapts above the blank-box baseline", () => {
  const result = resolveMultiChoice([
    { value: "Recycle", score: 0.109 },
    { value: "Repurpose", score: 0.077 },
    { value: "Donate", score: 0.061 },
    { value: "Other", score: 0.017 }
  ], { selectionThreshold: 0.075, ambiguityMargin: 0.005 });
  assert.deepEqual(result.value, ["Recycle"]);
  assert.ok(result.threshold > 0.077);
});

test("dominant filled boxes reject residual printed borders on 300 dpi scans", () => {
  const result = resolveMultiChoice([
    { value: "Donate it to charity", score: 0.797 },
    { value: "Repurpose it", score: 0.385 },
    { value: "Recycling bin", score: 0.385 },
    { value: "Trash", score: 0 }
  ], { selectionThreshold: 0.075, ambiguityMargin: 0.015 });
  assert.deepEqual(result.value, ["Donate it to charity"]);
  assert.ok(result.threshold > 0.385);
});

test("single-choice selection ignores medium border residue below the leading-mark ratio", () => {
  const result = resolveSingleChoice([
    { value: "7-9", score: 0.797 },
    { value: "22-24", score: 0.385 },
    { value: "25+", score: 0.385 },
    { value: "10-12", score: 0 }
  ], { selectionThreshold: 0.04, conflictThreshold: 0.09, ambiguityMargin: 0.015 });
  assert.equal(result.value, "7-9");
  assert.deepEqual(result.conflicts, []);
});

test("page skew estimator identifies tilted horizontal form lines", () => {
  const width = 360;
  const height = 240;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const slope = Math.tan(0.75 * Math.PI / 180);
  for (const baseY of [55, 105, 155, 205]) {
    for (let x = 20; x < width - 20; x += 1) {
      const centerY = Math.round(baseY + slope * (x - width / 2));
      for (let y = centerY - 2; y <= centerY + 2; y += 1) {
        const index = (y * width + x) * 4;
        data[index] = data[index + 1] = data[index + 2] = 0;
        data[index + 3] = 255;
      }
    }
  }
  const estimated = estimateSkewSlope({ width, height, data }, [10, 20, width - 10, height - 20], {
    sampleStepPixels: 3,
    maximumSamples: 20000
  });
  assert.ok(Math.abs(estimated - slope) < 0.003);
});

test("coarse-to-fine alignment covers zero and nearby single-pixel offsets", () => {
  const coarse = coarseAlignmentOffsets(20);
  assert.ok(coarse.some(([x, y]) => x === 0 && y === 0));
  assert.ok(coarse.some(([x, y]) => x === 20 && y === -20));

  const fine = fineAlignmentOffsets([12, -8], 20);
  assert.ok(fine.some(([x, y]) => x === 11 && y === -7));
  assert.ok(fine.every(([x, y]) => Math.abs(x) <= 20 && Math.abs(y) <= 20));
});


test("page skew estimator handles strongly rotated form lines", () => {
  const width = 420;
  const height = 320;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const angle = 7.8 * Math.PI / 180;
  const slope = Math.tan(angle);
  for (const baseY of [60, 105, 150, 195, 240]) {
    for (let x = 30; x < width - 30; x += 1) {
      const y = Math.round(baseY + slope * (x - width / 2));
      for (let dy = -1; dy <= 1; dy += 1) {
        const index = ((y + dy) * width + x) * 4;
        if (index < 0 || index >= data.length - 3) continue;
        data[index] = data[index + 1] = data[index + 2] = 0;
        data[index + 3] = 255;
      }
    }
  }
  const pixels = { width, height, data };
  const estimated = estimateSkewSlope(pixels, [0, 0, width - 1, height - 1]);
  assert.ok(Math.abs(Math.atan(estimated) * 180 / Math.PI - 7.8) < 0.5);
});
