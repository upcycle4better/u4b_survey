export const HANDWRITING_PREPROCESS = Object.freeze({
  cropPaddingPoints: 8,
  alignmentPaddingPoints: 14,
  alignmentSampleStepPoints: 2,
  lineTargetHeight: 160,
  paragraphTargetHeight: 320,
  minimumLineWidth: 360,
  maximumLineWidth: 1600
});

export function expandTextRegion(box, padding = HANDWRITING_PREPROCESS.cropPaddingPoints, verticalPadding = padding) {
  const [x0, y0, x1, y1] = box;
  return [x0 - padding, y0 - verticalPadding, x1 + padding, y1 + verticalPadding];
}

export function inkBounds(data, width, height, { threshold = 80, padding = 4 } = {}) {
  if (!data || !width || !height) return null;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4] >= threshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return [
    Math.max(0, minX - padding),
    Math.max(0, minY - padding),
    Math.min(width, maxX + padding + 1),
    Math.min(height, maxY + padding + 1)
  ];
}
