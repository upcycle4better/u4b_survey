import test from "node:test";
import assert from "node:assert/strict";

import {
  applyHomography,
  chooseExtractionScale,
  estimatePageBoxFromContent,
  estimateHomography,
  mappedQuadrilateral,
  mapPagePoint,
  ransacHomography
} from "../public/projective-registration.js";

const expected = [
  [1.08, 0.035, 42],
  [-0.018, 1.04, 27],
  [0.00008, -0.00004, 1]
];

function correspondence(x, y, noiseX = 0, noiseY = 0) {
  const target = applyHomography(expected, x, y);
  return { source: [x, y], target: [target[0] + noiseX, target[1] + noiseY] };
}

test("homography estimation recovers a perspective mapping", () => {
  const points = [
    correspondence(50, 80), correspondence(520, 80), correspondence(520, 760), correspondence(50, 760),
    correspondence(280, 420), correspondence(90, 600), correspondence(470, 250)
  ];
  const matrix = estimateHomography(points);
  const mapped = applyHomography(matrix, 330, 510);
  const target = applyHomography(expected, 330, 510);
  assert.ok(Math.hypot(mapped[0] - target[0], mapped[1] - target[1]) < 0.01);
});

test("RANSAC rejects false checkbox anchors", () => {
  const points = [
    correspondence(50, 80, 0.5, -0.3), correspondence(520, 80, -0.4, 0.2),
    correspondence(520, 760, 0.2, 0.4), correspondence(50, 760, -0.3, -0.4),
    correspondence(280, 420, 0.1, 0.1), correspondence(90, 600, 0.3, -0.2),
    correspondence(470, 250, -0.2, 0.3),
    { source: [260, 200], target: [50, 700] },
    { source: [400, 650], target: [800, 80] }
  ];
  const result = ransacHomography(points, { iterations: 240, threshold: 3 });
  assert.ok(result);
  assert.ok(result.inliers.length >= 7);
  assert.ok(result.meanError < 1);
});

test("registered page corners and adaptive DPI are stable", () => {
  const quad = mappedQuadrilateral(expected, 595.68, 842.4);
  assert.equal(quad.length, 4);
  assert.ok(quad.every(point => point.every(Number.isFinite)));
  assert.equal(chooseExtractionScale(8), 300 / 72);
  assert.equal(chooseExtractionScale(4), 3.25);
  assert.equal(chooseExtractionScale(2), 2.5);
});

test("content bounds recover a cropped and shifted page mapping", () => {
  const expectedContent = [40, 30, 560, 760];
  const pageWidth = 600;
  const pageHeight = 800;
  const scaleX = 1.7;
  const scaleY = 1.55;
  const left = -36;
  const top = 24;
  const observed = [
    left + expectedContent[0] * scaleX,
    top + expectedContent[1] * scaleY,
    left + expectedContent[2] * scaleX,
    top + expectedContent[3] * scaleY
  ];
  const box = estimatePageBoxFromContent(observed, expectedContent, pageWidth, pageHeight, 1000, 1300);
  assert.deepEqual(box.map(value => Math.round(value)), [left, top, left + pageWidth * scaleX, top + pageHeight * scaleY]);
  assert.deepEqual(mapPagePoint(300, 400, pageWidth, pageHeight, 1000, 1300, box).map(value => Math.round(value)), [474, 644]);
});
