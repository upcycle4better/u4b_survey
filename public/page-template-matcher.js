function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizePageTemplateMatch(borderScores, profile, { lineScore = null } = {}) {
  const scores = (borderScores || []).map(Number).filter(Number.isFinite);
  const meanBorder = scores.length
    ? scores.reduce((sum, value) => sum + value, 0) / scores.length
    : 0;
  const medianBorder = median(scores);
  const matchedAnchors = scores.filter(value => value >= profile.anchorBorderThreshold).length;
  const anchorCoverage = scores.length ? matchedAnchors / scores.length : 0;
  const hasLineSignature = Number.isFinite(lineScore) && profile.minimumLineScore != null;
  const score = hasLineSignature
    ? meanBorder * 0.52 + medianBorder * 0.20 + anchorCoverage * 0.10 + lineScore * 0.18
    : meanBorder * 0.68 + medianBorder * 0.22 + anchorCoverage * 0.10;
  const optionCountMatches = scores.length === profile.optionCount;
  const matched = optionCountMatches
    && meanBorder >= profile.minimumMeanBorder
    && anchorCoverage >= profile.minimumAnchorCoverage
    && (!hasLineSignature || lineScore >= profile.minimumLineScore);

  return {
    id: profile.id,
    label: profile.label,
    matched,
    score,
    optionCount: scores.length,
    expectedOptionCount: profile.optionCount,
    matchedAnchors,
    anchorCoverage,
    meanBorder,
    medianBorder,
    lineScore: Number.isFinite(lineScore) ? lineScore : null
  };
}

export function validatePageTemplateProfiles(template, profiles) {
  const errors = [];
  for (let page = 1; page <= template.pagesPerSurvey; page += 1) {
    const profile = profiles[page];
    if (!profile) {
      errors.push(`Page ${page} has no matching profile.`);
      continue;
    }
    const questions = template.questions.filter(question => question.page === page && question.options?.length);
    const keys = questions.map(question => question.key);
    const optionCount = questions.reduce((sum, question) => sum + question.options.length, 0);
    if (keys.join("|") !== profile.questionKeys.join("|")) {
      errors.push(`Page ${page} question fingerprint does not match ${profile.id}.`);
    }
    if (optionCount !== profile.optionCount) {
      errors.push(`Page ${page} expected ${profile.optionCount} checkbox positions but found ${optionCount}.`);
    }
  }
  return errors;
}
