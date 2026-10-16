export const LOGICAL_SURVEY_PAGES = 5;
export const SUPPORTED_SOURCE_PAGE_COUNTS = Object.freeze([6, 5]);

export function resolveSourcePagesPerSurvey(totalPages, requestedPages = 6) {
  const requested = Number(requestedPages);
  if (SUPPORTED_SOURCE_PAGE_COUNTS.includes(requested) && totalPages >= requested && totalPages % requested === 0) {
    return requested;
  }
  const fallback = SUPPORTED_SOURCE_PAGE_COUNTS.find(pages => totalPages >= pages && totalPages % pages === 0);
  return fallback || null;
}

export function sourcePageNumber(surveyIndex, logicalPage, sourcePagesPerSurvey) {
  if (logicalPage < 1 || logicalPage > LOGICAL_SURVEY_PAGES) throw new RangeError("Logical survey page must be between 1 and 5.");
  return surveyIndex * sourcePagesPerSurvey + logicalPage;
}

export function ignoredSourcePageNumber(surveyIndex, sourcePagesPerSurvey) {
  return sourcePagesPerSurvey > LOGICAL_SURVEY_PAGES
    ? surveyIndex * sourcePagesPerSurvey + LOGICAL_SURVEY_PAGES + 1
    : null;
}
