# Architecture

## Processing flow

1. The user selects one or more scanned student survey batch PDFs.
2. PDF.js loads every selected file and validates that each contains complete five- or six-page student groups.
3. For the current six-page scanner format, the processor groups `Before 1`, `Before 2`, `After 1`, `After 2`, `Feedback`, then ignores the blank sixth page.
4. It matches each non-blank page against a measured checkbox fingerprint and corrects out-of-order pages. A failed fingerprint forces that page's tick questions into review.
5. Direct A4 scanner pages use measured checkbox positions, page-skew compensation and per-column local offsets. The original blank PDF remains the ink-comparison reference.
6. The OMR engine performs local coarse-to-fine alignment for skew tolerance, compares the page with the blank form and reads ink only inside each printed checkbox.
7. Student name and written-answer regions are locally aligned, cleaned against the blank reference and read as complete fields without line segmentation. Soft grayscale and high-contrast variants are read locally by TrOCR, the stronger candidate is selected, and student names are limited to 20 characters. School name, date, group number and `Other` explanations are excluded from recognition.
8. The user reviews and corrects every locally recognised handwritten answer.
9. Extracted and approved answers from all selected PDFs are merged into one browser dataset. Source PDFs are not persisted.
10. The report configuration derives 16 chart datasets from the combined response counts across all files.
11. The browser downloads a local Excel workbook with raw responses, auditable chart data and native Excel charts.

## Report rules

- Blank answers are excluded naturally because only matching responses are counted.
- Multiple-selection answers are counted once per selected option, so totals may exceed student attendance.
- A selected `Other` option is counted as the generic `Other` category; its handwritten explanation is ignored.
- Q8 is filtered to Q7 = Yes.
- Q11 uses keyword-based thematic analysis, and one response can contribute to multiple themes.
- Before/after charts use the same response order and colours.

## Main files

- `public/app.js`: browser workflow and dashboard rendering.
- `public/page-template-matcher.js`: page fingerprint scoring and acceptance rules.
- `public/omr-tolerance.js`: inside-box mark rules and skew-tolerant local alignment settings.
- `public/handwriting-preprocess.js`: complete text-region padding and image sizing settings.
- `public/handwriting-ocr.js`: local worker controller and recognised-text cleanup.
- `public/handwriting-worker.js`: free TrOCR model loading and browser inference.
- `public/report-config.js`: shared definitions and counting logic for all 16 charts.
- `public/xlsx-export.js`: local Excel workbook and native chart generation.
- `public/data/school-visit-v1.json`: stable survey fields and OMR coordinates.
- `public/reference-template.js`: embedded blank form used for local registration.
- `scripts/dev-server.mjs`: local static development server.

## Storage and privacy

Uploaded PDFs and cropped handwriting remain on the device. The browser downloads and caches the model files, then performs inference locally in a Web Worker. Downloaded Excel files are saved by the browser, and the Vercel deployment is stateless.
