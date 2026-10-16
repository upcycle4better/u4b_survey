export const OMR_TOLERANCE = Object.freeze({
  alignmentPaddingPoints: 6,
  corePaddingPoints: 2.5,
  detectionInsetPoints: 1.25,
  localShiftPoints: 14,
  minimumShiftPixels: 12,
  maximumShiftPixels: 32,
  coarseStepPixels: 2,
  fineRadiusPixels: 3,
  inkThreshold: 180,
  conflictThreshold: 0.09,
  maximumSkewDegrees: 12,
  skewStepDegrees: 0.5,
  skewFineStepDegrees: 0.1,
  skewSampleStepPixels: 4,
  maximumSkewSamples: 12000
});

export function resolveMultiChoice(scored, {
  selectionThreshold,
  adaptiveMargin = 0.0175,
  ambiguityMargin = 0,
  dominantMarkThreshold = 0.55,
  dominantMarkRatio = 0.52
} = {}) {
  const ranked = [...(scored || [])].sort((a, b) => b.score - a.score);
  const ascending = ranked.map(item => item.score).sort((a, b) => a - b);
  const middle = Math.floor(ascending.length / 2);
  const median = !ascending.length
    ? 0
    : ascending.length % 2
      ? ascending[middle]
      : (ascending[middle - 1] + ascending[middle]) / 2;
  const strongest = ranked[0]?.score || 0;
  // Filled/scribbled boxes on 300 dpi Apeos scans are much darker than the
  // residual printed borders left by reference subtraction. Once a dominant
  // mark is present, use a relative floor so those borders cannot become
  // false multi-select answers. Faint ticks keep the original adaptive rule.
  const dominantFloor = strongest >= dominantMarkThreshold
    ? strongest * dominantMarkRatio
    : 0;
  const threshold = Math.max(selectionThreshold, median + adaptiveMargin, dominantFloor);
  const value = ranked.filter(item => item.score >= threshold).map(item => item.value);
  const ambiguous = ranked.some(item => Math.abs(item.score - threshold) < ambiguityMargin);
  return { value, threshold, median, flagged: ambiguous || value.length === 0 };
}

export function multiChoiceConfidence(scored, threshold) {
  const distances = (scored || [])
    .map(item => Math.abs(Number(item.score) - Number(threshold)))
    .filter(Number.isFinite);
  const nearest = distances.length ? Math.min(...distances) : 0;
  return Number(Math.min(0.99, 0.55 + nearest * 2.7).toFixed(2));
}

export function insetCheckboxBox(box, inset = OMR_TOLERANCE.detectionInsetPoints) {
  const [x0, y0, x1, y1] = box;
  const safeInset = Math.max(0, Math.min(inset, (x1 - x0) / 2 - 0.1, (y1 - y0) / 2 - 0.1));
  return [x0 + safeInset, y0 + safeInset, x1 - safeInset, y1 - safeInset];
}

export function localShiftPixels(scanBounds, logicalPage, referenceBoundsByPage) {
  const referenceBounds = referenceBoundsByPage[logicalPage];
  const scaleX = (scanBounds[2] - scanBounds[0]) / Math.max(1, referenceBounds[2] - referenceBounds[0]);
  const scaleY = (scanBounds[3] - scanBounds[1]) / Math.max(1, referenceBounds[3] - referenceBounds[1]);
  const proposed = Math.round(Math.max(scaleX, scaleY) * OMR_TOLERANCE.localShiftPoints);
  return Math.max(OMR_TOLERANCE.minimumShiftPixels, Math.min(OMR_TOLERANCE.maximumShiftPixels, proposed));
}

export function coarseAlignmentOffsets(maxShift, step = OMR_TOLERANCE.coarseStepPixels) {
  const offsets = [];
  for (let y = -maxShift; y <= maxShift; y += step) {
    for (let x = -maxShift; x <= maxShift; x += step) offsets.push([x, y]);
  }
  if (!offsets.some(([x, y]) => x === 0 && y === 0)) offsets.push([0, 0]);
  return offsets;
}

export function fineAlignmentOffsets(bestOffset, maxShift, radius = OMR_TOLERANCE.fineRadiusPixels) {
  const offsets = [];
  for (let y = bestOffset[1] - radius; y <= bestOffset[1] + radius; y += 1) {
    for (let x = bestOffset[0] - radius; x <= bestOffset[0] + radius; x += 1) {
      if (Math.abs(x) <= maxShift && Math.abs(y) <= maxShift) offsets.push([x, y]);
    }
  }
  return offsets;
}

export function combineMarkFeatures({ coreDensity = 0, expandedDensity = 0, strokeCoverage = 0 } = {}) {
  const coreWeighted = coreDensity * 0.62;
  const supportedStroke = (expandedDensity * 0.86) + (coreDensity * 0.22) + (Math.min(1, strokeCoverage) * 0.0035);
  return Math.min(1, Math.max(expandedDensity, coreWeighted, supportedStroke));
}

export function resolveSingleChoice(scored, {
  selectionThreshold,
  conflictThreshold = OMR_TOLERANCE.conflictThreshold,
  ambiguityMargin = 0,
  adaptiveMargin = 0.012,
  conflictRatio = 0.58
} = {}) {
  const ranked = [...(scored || [])].sort((a, b) => b.score - a.score);
  const baselineCandidates = ranked.map(item => item.score).sort((a, b) => a - b);
  const baselineCount = Math.max(1, Math.floor(baselineCandidates.length / 2));
  const baseline = baselineCandidates.slice(0, baselineCount).reduce((sum, value) => sum + value, 0) / baselineCount;
  const threshold = Math.max(selectionThreshold, baseline + adaptiveMargin);
  const first = ranked[0] || null;
  const second = ranked[1] || { score: 0 };
  // A second box is a real conflict only when it is strong relative to the
  // leading mark. The former absolute-only rule incorrectly treated ordinary
  // printed-border residue as another answer on direct 300 dpi scans.
  const relativeConflictFloor = first
    ? Math.max(conflictThreshold, first.score * conflictRatio)
    : conflictThreshold;
  let conflicts = ranked.filter(item => item.score >= relativeConflictFloor).map(item => item.value);
  const margin = first ? first.score - second.score : 0;
  if (conflicts.length < 2 && first?.score >= threshold && second.score >= threshold && margin < ambiguityMargin) {
    conflicts = ranked.filter(item => item.score >= threshold).map(item => item.value);
  }
  if (conflicts.length > 1) {
    return { value: "", conflicts, flagged: true, margin, threshold, baseline };
  }
  const value = first && first.score >= threshold ? first.value : "";
  return { value, conflicts: [], flagged: !value || margin < ambiguityMargin, margin, threshold, baseline };
}

function luminanceAt(pixels, x, y) {
  const safeX = Math.max(0, Math.min(pixels.width - 1, x));
  const safeY = Math.max(0, Math.min(pixels.height - 1, y));
  const index = (safeY * pixels.width + safeX) * 4;
  return (pixels.data[index] * 0.2126) + (pixels.data[index + 1] * 0.7152) + (pixels.data[index + 2] * 0.0722);
}

export function estimateSkewSlope(pixels, bounds, options = {}) {
  if (!pixels?.data || !Array.isArray(bounds) || bounds.length !== 4) return 0;
  const maxDegrees = options.maximumSkewDegrees ?? OMR_TOLERANCE.maximumSkewDegrees;
  const coarseStep = options.skewStepDegrees ?? OMR_TOLERANCE.skewStepDegrees;
  const fineStep = options.skewFineStepDegrees ?? OMR_TOLERANCE.skewFineStepDegrees;
  const sampleStep = options.sampleStepPixels ?? OMR_TOLERANCE.skewSampleStepPixels;
  const maximumSamples = options.maximumSamples ?? OMR_TOLERANCE.maximumSkewSamples;
  const threshold = options.darkThreshold ?? 180;
  const [left, top, right, bottom] = bounds.map(value => Math.round(value));
  const samples = [];
  const verticalStep = Math.max(1, Math.floor(sampleStep / 2));
  for (let y = top; y <= bottom; y += verticalStep) {
    for (let x = left; x <= right; x += sampleStep) {
      if (luminanceAt(pixels, x, y) < threshold) samples.push([x, y]);
    }
  }
  if (samples.length < 60) return 0;
  const stride = Math.max(1, Math.ceil(samples.length / maximumSamples));
  const selected = stride === 1 ? samples : samples.filter((_, index) => index % stride === 0);
  const centerX = (left + right) / 2;

  // Long printed rules and text baselines are much more reliable skew cues than
  // the total number of dark pixels in every projected row. Scoring only the
  // strongest rows prevents dense upright letter strokes from incorrectly
  // winning at 0 degrees on a visibly rotated scan.
  const projectionScore = degrees => {
    const slope = Math.tan((degrees * Math.PI) / 180);
    const rows = new Map();
    for (const [x, y] of selected) {
      const row = Math.round(y - slope * (x - centerX));
      rows.set(row, (rows.get(row) || 0) + 1);
    }
    const strongest = [...rows.values()].sort((a, b) => b - a).slice(0, 48);
    return strongest.reduce((score, count) => score + count * count, 0);
  };

  let bestDegrees = 0;
  let bestScore = -Infinity;
  for (let degrees = -maxDegrees; degrees <= maxDegrees + coarseStep / 2; degrees += coarseStep) {
    const score = projectionScore(degrees);
    if (score > bestScore) {
      bestScore = score;
      bestDegrees = degrees;
    }
  }

  const fineRadius = Math.max(coarseStep, fineStep * 2);
  const fineStart = Math.max(-maxDegrees, bestDegrees - fineRadius);
  const fineEnd = Math.min(maxDegrees, bestDegrees + fineRadius);
  for (let degrees = fineStart; degrees <= fineEnd + fineStep / 2; degrees += fineStep) {
    const score = projectionScore(degrees);
    if (score > bestScore) {
      bestScore = score;
      bestDegrees = degrees;
    }
  }

  const slope = Math.tan((bestDegrees * Math.PI) / 180);
  return Math.abs(bestDegrees) < 0.05 ? 0 : slope;
}
