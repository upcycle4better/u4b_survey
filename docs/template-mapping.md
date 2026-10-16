# Survey template mapping

The base coordinate map is stored in `public/data/school-visit-v1.json`. Coordinates use the reference PDF's top-left origin in PDF points on a 612 × 792 page. `public/scan-layout.js` supplies the verified production override for the 595.68 × 842.4-point A4 Apeos scan; the processor scales either map to the rendered page automatically.

Each checkbox option contains:

```json
{
  "value": "Agree",
  "box": [306.6, 647.3, 318.6, 659.0]
}
```

The values represent `[left, top, right, bottom]`.

## Page grouping

| Page within student | Content |
| --- | --- |
| 1 | Before: identity, demographics, Q1-Q4 |
| 2 | Before: Q5-Q9 |
| 3 | After: identity, Q10-Q13 |
| 4 | After: Q14-Q19 |
| 5 | Feedback: F1-F3 |
| 6 | Blank reverse page: ignored |

For the current scanner format, the processor groups pages 1-6 as student 1, pages 7-12 as student 2, and so on. It extracts the first five pages and checks that page 6 is blank. Inside each group, it identifies the five populated page types from the printed checkbox layout and reorders them only when the complete assignment is stronger than the fixed order.

## Page-template fingerprints

| Logical page | Expected checkbox questions | Expected boxes |
| --- | --- | ---: |
| Before 1 | Gender, Age, Q1-Q4 | 26 |
| Before 2 | Q5-Q9 | 24 |
| After 1 | Q10, Q12, Q13 | 13 |
| After 2 | Q14-Q19 | 26 |
| Feedback | F1 plus ruled-line anchors | 4 |

Template matching uses printed checkbox borders, not the student's selections. After alignment, the system measures how many expected box borders are present and checks the mean border score. Feedback also requires its ruled-answer-line signature. A page that fails this check is not silently trusted: every tick question on that page is sent to manual review.

When several PDFs are uploaded, the same matching process runs independently for each file. All accepted student records are then appended to one combined dataset, and chart counts are calculated across that full dataset.

## Detection parameters

- `markThreshold`: minimum ink ratio inside the printed box, compared with the blank form, for a multi-select checkbox to be selected.
- `singleMarkThreshold`: lower minimum for the leading option in a single-answer question.
- `ambiguityMargin`: distance from the threshold, or difference between leading single-choice options, that triggers review.

Changing these values affects every question. Tune them only against labelled completed scans and keep the blank template in the test set to measure false positives.

The browser starts from the calibrated Apeos A4 checkbox positions, compensates for page tilt, and searches each page column for the printed checkbox grid. The wider coarse-to-fine search covers direct-scanner shifts while remaining inside the neighbouring answer-row distance. Multi-select questions also estimate a blank-box baseline on each question so scanner noise is less likely to become a false selection.

For strong filled marks, the detector additionally requires each selected option to remain strong relative to the leading mark. This prevents medium printed-border residue from being reported as a second answer while preserving genuine double selections and conflicts for review.

## Verified scanner profile

- Paper: A4, head-to-head, six scanned pages per student.
- Resolution: 300 DPI.
- Colour mode: monochrome/grayscale direct scan.
- Logical order: Before 1, Before 2, After 1, After 2, Feedback, blank reverse page.
- Student name: read from the Before 1 name field, limited to 20 characters, and always confirmed by the operator against the page image before export.
- Handwriting: only Student Name, Q11, F2 and F3 are cropped for recognition; all remain editable during review.

## Adding a new survey version

1. Copy the existing JSON definition.
2. Change `id`, `name` and `version`.
3. Render the new blank PDF.
4. record every checkbox bounding rectangle.
5. Add the new PDF to `reference/`.
6. Add validation tests for coordinates, page count and unique question keys.
7. Test at least ten completed scans before enabling automatic selection.
