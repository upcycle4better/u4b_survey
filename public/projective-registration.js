export const REGISTRATION = Object.freeze({
  ransacIterations: 180,
  reprojectionThresholdPixels: 5,
  minimumAnchorScore: 0.28,
  minimumInliers: 6,
  maximumAnchorSearchPixels: 150
});

function multiply3(left, right) {
  const output = Array.from({ length: 3 }, () => Array(3).fill(0));
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let index = 0; index < 3; index += 1) output[row][column] += left[row][index] * right[index][column];
    }
  }
  return output;
}

function inverse3(matrix) {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) return null;
  return [
    [(e * i - f * h) / determinant, (c * h - b * i) / determinant, (b * f - c * e) / determinant],
    [(f * g - d * i) / determinant, (a * i - c * g) / determinant, (c * d - a * f) / determinant],
    [(d * h - e * g) / determinant, (b * g - a * h) / determinant, (a * e - b * d) / determinant]
  ];
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-10) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let index = column; index <= size; index += 1) augmented[column][index] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let index = column; index <= size; index += 1) augmented[row][index] -= factor * augmented[column][index];
    }
  }
  return augmented.map(row => row[size]);
}

function normalization(points) {
  const center = points.reduce((result, point) => [result[0] + point[0], result[1] + point[1]], [0, 0])
    .map(value => value / points.length);
  const meanDistance = points.reduce(
    (sum, point) => sum + Math.hypot(point[0] - center[0], point[1] - center[1]),
    0
  ) / points.length;
  const scale = meanDistance > 1e-8 ? Math.SQRT2 / meanDistance : 1;
  const transform = [
    [scale, 0, -scale * center[0]],
    [0, scale, -scale * center[1]],
    [0, 0, 1]
  ];
  const normalized = points.map(([x, y]) => [scale * (x - center[0]), scale * (y - center[1])]);
  return { points: normalized, transform };
}

export function applyHomography(matrix, x, y) {
  if (!matrix) return [x, y];
  const denominator = matrix[2][0] * x + matrix[2][1] * y + matrix[2][2];
  if (Math.abs(denominator) < 1e-9) return [Number.NaN, Number.NaN];
  return [
    (matrix[0][0] * x + matrix[0][1] * y + matrix[0][2]) / denominator,
    (matrix[1][0] * x + matrix[1][1] * y + matrix[1][2]) / denominator
  ];
}

export function estimateHomography(correspondences) {
  if (!Array.isArray(correspondences) || correspondences.length < 4) return null;
  const source = normalization(correspondences.map(item => item.source));
  const target = normalization(correspondences.map(item => item.target));
  const rows = [];
  const values = [];
  for (let index = 0; index < correspondences.length; index += 1) {
    const [x, y] = source.points[index];
    const [u, v] = target.points[index];
    rows.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    rows.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const normalMatrix = Array.from({ length: 8 }, () => Array(8).fill(0));
  const normalVector = Array(8).fill(0);
  for (let row = 0; row < rows.length; row += 1) {
    for (let left = 0; left < 8; left += 1) {
      normalVector[left] += rows[row][left] * values[row];
      for (let right = 0; right < 8; right += 1) normalMatrix[left][right] += rows[row][left] * rows[row][right];
    }
  }
  const solution = solveLinearSystem(normalMatrix, normalVector);
  if (!solution) return null;
  const normalizedMatrix = [solution.slice(0, 3), solution.slice(3, 6), [solution[6], solution[7], 1]];
  const inverseTarget = inverse3(target.transform);
  if (!inverseTarget) return null;
  const denormalized = multiply3(multiply3(inverseTarget, normalizedMatrix), source.transform);
  const factor = denormalized[2][2];
  if (Math.abs(factor) < 1e-12) return null;
  return denormalized.map(row => row.map(value => value / factor));
}

function convexHull(points) {
  const sorted = [...points].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (sorted.length <= 2) return sorted;
  const cross = (origin, left, right) => (
    (left[0] - origin[0]) * (right[1] - origin[1])
    - (left[1] - origin[1]) * (right[0] - origin[0])
  );
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function quadrilateralArea(points) {
  const hull = convexHull(points);
  let area = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index];
    const next = hull[(index + 1) % hull.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function validSample(sample) {
  const sourceArea = quadrilateralArea(sample.map(item => item.source));
  const targetArea = quadrilateralArea(sample.map(item => item.target));
  return sourceArea > 100 && targetArea > 100;
}

function deterministicSample(length, iteration) {
  let seed = (iteration + 1) * 2654435761 >>> 0;
  const selected = new Set();
  while (selected.size < Math.min(4, length)) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    selected.add(seed % length);
  }
  return [...selected];
}

export function reprojectionError(matrix, correspondence) {
  const projected = applyHomography(matrix, correspondence.source[0], correspondence.source[1]);
  return Math.hypot(projected[0] - correspondence.target[0], projected[1] - correspondence.target[1]);
}

export function ransacHomography(correspondences, options = {}) {
  const usable = (correspondences || []).filter(item => (
    Array.isArray(item.source) && Array.isArray(item.target) && item.source.length === 2 && item.target.length === 2
  ));
  if (usable.length < 4) return null;
  const iterations = options.iterations ?? REGISTRATION.ransacIterations;
  const threshold = options.threshold ?? REGISTRATION.reprojectionThresholdPixels;
  let best = null;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample = deterministicSample(usable.length, iteration).map(index => usable[index]);
    if (!validSample(sample)) continue;
    const matrix = estimateHomography(sample);
    if (!matrix) continue;
    const inliers = usable.filter(item => reprojectionError(matrix, item) <= threshold);
    const error = inliers.reduce((sum, item) => sum + reprojectionError(matrix, item), 0);
    if (!best || inliers.length > best.inliers.length || (inliers.length === best.inliers.length && error < best.error)) {
      best = { matrix, inliers, error };
    }
  }
  if (!best || best.inliers.length < 4) return null;
  const refined = estimateHomography(best.inliers) || best.matrix;
  const errors = best.inliers.map(item => reprojectionError(refined, item));
  return {
    matrix: refined,
    inliers: best.inliers,
    meanError: errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length),
    inlierRatio: best.inliers.length / usable.length
  };
}

export function mappedQuadrilateral(matrix, width, height) {
  return [
    applyHomography(matrix, 0, 0),
    applyHomography(matrix, width, 0),
    applyHomography(matrix, width, height),
    applyHomography(matrix, 0, height)
  ];
}

export function estimatePageBoxFromContent(
  scanBounds,
  expectedContentBounds,
  sourcePageWidth,
  sourcePageHeight,
  imageWidth,
  imageHeight
) {
  if (![scanBounds, expectedContentBounds].every(bounds => Array.isArray(bounds) && bounds.length === 4)) return null;
  const expectedWidth = expectedContentBounds[2] - expectedContentBounds[0];
  const expectedHeight = expectedContentBounds[3] - expectedContentBounds[1];
  const observedWidth = scanBounds[2] - scanBounds[0];
  const observedHeight = scanBounds[3] - scanBounds[1];
  if (Math.min(expectedWidth, expectedHeight, observedWidth, observedHeight, sourcePageWidth, sourcePageHeight) <= 0) return null;
  const scaleX = observedWidth / expectedWidth;
  const scaleY = observedHeight / expectedHeight;
  const left = scanBounds[0] - expectedContentBounds[0] * scaleX;
  const top = scanBounds[1] - expectedContentBounds[1] * scaleY;
  const width = sourcePageWidth * scaleX;
  const height = sourcePageHeight * scaleY;
  const widthRatio = width / Math.max(1, imageWidth);
  const heightRatio = height / Math.max(1, imageHeight);
  if (widthRatio < 0.65 || widthRatio > 1.5 || heightRatio < 0.65 || heightRatio > 1.5) return null;
  return [left, top, left + width, top + height];
}

export function mapPagePoint(x, y, sourcePageWidth, sourcePageHeight, imageWidth, imageHeight, pageBox = null) {
  const box = pageBox || [0, 0, imageWidth, imageHeight];
  return [
    box[0] + (x / sourcePageWidth) * (box[2] - box[0]),
    box[1] + (y / sourcePageHeight) * (box[3] - box[1])
  ];
}

export function chooseExtractionScale(deviceMemory = 4) {
  if (deviceMemory >= 8) return 300 / 72;
  if (deviceMemory >= 4) return 3.25;
  return 2.5;
}
