import test from "node:test";
import assert from "node:assert/strict";

import {
  calibratePageTone,
  learnedThreshold,
  loadCalibration,
  multiThresholdVote,
  normalizeTone,
  recordCalibration
} from "../public/scan-calibration.js";

test("page tone calibration normalizes scanner contrast", () => {
  const width = 100;
  const height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(235);
  for (let index = 0; index < data.length; index += 4) data[index + 3] = 255;
  for (let pixel = 0; pixel < 300; pixel += 1) {
    const index = pixel * 4;
    data[index] = data[index + 1] = data[index + 2] = 35;
  }
  const tone = calibratePageTone({ width, height, data }, 1);
  assert.ok(tone.black <= 120);
  assert.ok(tone.white >= 205);
  assert.ok(normalizeTone(235, tone) > 245);
});

test("multi-threshold voting is robust around one threshold", () => {
  const samples = [...Array(80).fill(80), ...Array(20).fill(240)];
  const vote = multiThresholdVote(samples);
  assert.ok(vote.score > 0.75);
  assert.ok(vote.agreement > 0.9);
});

test("manual corrections learn a local checkbox threshold", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let profile = loadCalibration(storage);
  for (let index = 0; index < 4; index += 1) {
    profile = recordCalibration(profile, "Q1", { A: 0.14 + index * 0.002, B: 0.035, C: 0.04 }, "A", storage);
  }
  assert.ok(learnedThreshold(profile, "Q1", 0.04) > 0.04);
  assert.ok(learnedThreshold(profile, "Q1", 0.04) < 0.14);
});
