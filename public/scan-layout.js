// Coordinates measured from the direct 300 dpi A4 output produced by the
// Apeos scanner. Values are PDF points; the browser scales them to the
// rendered canvas. The original Letter-form boxes remain available for blank
// reference subtraction.
export const SCAN_PAGE = Object.freeze({ width: 595.68, height: 842.4 });

const pageProfile = (id, label, questionKeys, optionCount, thresholds = {}) => Object.freeze({
  id,
  label,
  questionKeys: Object.freeze(questionKeys),
  optionCount,
  anchorBorderThreshold: 0.28,
  minimumMeanBorder: 0.20,
  minimumAnchorCoverage: 0.42,
  ...thresholds
});

// The fingerprints below match the six-sheet packs supplied by the Apeos
// scanner. Pages 1-5 are matched before any response is trusted; source page
// 6 is a blank reverse page and is never treated as a questionnaire page.
export const PAGE_TEMPLATE_PROFILES = Object.freeze({
  1: pageProfile("before-1", "Before 1", ["GENDER", "AGE", "Q1", "Q2", "Q3", "Q4"], 26),
  2: pageProfile("before-2", "Before 2", ["Q5", "Q6", "Q7", "Q8", "Q9"], 24),
  3: pageProfile("after-1", "After 1", ["Q10", "Q12", "Q13"], 13, {
    minimumMeanBorder: 0.22,
    minimumAnchorCoverage: 0.50
  }),
  4: pageProfile("after-2", "After 2", ["Q14", "Q15", "Q16", "Q17", "Q18", "Q19"], 26, {
    minimumAnchorCoverage: 0.48
  }),
  5: pageProfile("feedback", "Feedback", ["F1"], 4, {
    minimumAnchorCoverage: 0.50,
    minimumLineScore: 0.10
  })
});

// Long ruled response lines provide strong registration anchors on page 5,
// where the four F1 checkboxes are too tightly grouped to correct perspective
// reliably on their own. Coordinates are in the same calibrated A4 point
// system as QUESTION_BOXES and TEXT_BOXES.
export const PAGE_REGISTRATION_LINES = Object.freeze({
  5: Object.freeze([
    [59.5, 339, 530.5, 339],
    [59.5, 373, 530.5, 373],
    [59.5, 407, 530.5, 407],
    [59.5, 523, 530.5, 523],
    [59.5, 557, 530.5, 557],
    [59.5, 591, 530.5, 591]
  ])
});

const box = (left, top, size = 9) => [left, top, left + size, top + size];
const column = (left, rows) => rows.map(top => box(left, top));

const QUESTION_BOXES = Object.freeze({
  GENDER: column(56.5, [202, 224]),
  AGE: [...column(56.5, [267, 289.5, 312, 334.5]), ...column(296, [266, 288.5, 311])],
  Q1: [...column(57.5, [397.5, 420]), ...column(296, [397.5, 420])],
  Q2: [...column(57.5, [473, 496.5]), ...column(296.5, [478])],
  Q3: [...column(58, [559.5, 582.5]), ...column(297, [559, 582])],
  Q4: [...column(57.5, [666.5, 689, 711.5]), ...column(297, [666, 688.5]), box(57.5, 734)],

  Q5: [...column(67, [147.5, 170, 192.5]), ...column(304.5, [147.5, 170]), box(67, 215)],
  Q6: [...column(67, [298.5, 321, 343.5]), ...column(305, [298, 320.5, 342])],
  Q7: column(67, [427, 448.5]),
  Q8: [...column(67.5, [532.5, 555, 577.5]), ...column(305.5, [532, 554.5, 576.5])],
  Q9: [...column(68, [661, 683.5]), ...column(306.5, [660.5, 683])],

  Q10: [...column(57, [254.5, 284.5]), ...column(279, [255.5])],
  Q12: [...column(57.5, [532, 562, 592]), ...column(296, [532, 562, 592]), box(57.5, 622.5)],
  Q13: [...column(58, [695, 725]), ...column(280, [695.5])],

  Q14: [...column(69, [135, 164.5]), ...column(289, [135, 164.5])],
  Q15: [...column(68, [215.5, 241, 266]), ...column(306, [215, 240]), box(69, 297.5)],
  Q16: [...column(69, [367.5, 390, 412.5]), ...column(323.5, [367.5, 390]), box(69.5, 434)],
  Q17: [box(69.5, 517), box(324.5, 517)],
  Q18: [...column(70, [600.5, 623.5]), ...column(324.5, [601, 622.5])],
  Q19: [...column(70, [706.5, 729]), ...column(325, [706.5, 729])],

  F1: [...column(59.5, [190, 212.5]), ...column(314, [190, 212.5])]
});

const TEXT_BOXES = Object.freeze({
  // Keep the name crop on the name line only. The previous lower edge also
  // captured Group Number/Date handwriting and the previous upper edge could
  // catch long descenders from the School Name line on skewed scans.
  STUDENT_NAME: [167, 117, 532, 139],
  // Paragraph crops cover every ruled answer line. Q11 and F3 also keep a
  // narrow overlap above the first line because students sometimes start
  // writing there; the matching blank-form pixels remove the printed prompt.
  Q11: [55, 348, 532, 465],
  F2: [58, 292, 532, 423],
  F3: [58, 475, 532, 610]
});

const REFERENCE_TEXT_BOXES = Object.freeze({
  // These blank-template crops align the small prompt-overlap band with its A4
  // counterpart. cleanHandwritingCrop masks those printed characters while
  // retaining handwriting that crosses into the same band.
  Q11: [44, 320, 562, 435],
  F3: [44, 447, 562, 583]
});

export function applyA4ScanLayout(template) {
  for (const question of template.questions || []) {
    const scanBoxes = QUESTION_BOXES[question.key];
    if (scanBoxes) {
      if (scanBoxes.length !== question.options.length) {
        throw new Error(`A4 scan layout mismatch for ${question.key}.`);
      }
      question.options.forEach((option, index) => {
        option.referenceBox = [...option.box];
        option.scanBox = [...scanBoxes[index]];
      });
    }
    if (TEXT_BOXES[question.key]) {
      question.referenceTextBox = [...(REFERENCE_TEXT_BOXES[question.key] || question.textBox)];
      question.scanTextBox = [...TEXT_BOXES[question.key]];
      // These boxes are already calibrated to the A4 response borders.
      // Generic symmetric padding would add unrelated content above them.
      question.scanTextCropMode = "calibrated-text-region";
    }
  }
  template.scanPageWidth = SCAN_PAGE.width;
  template.scanPageHeight = SCAN_PAGE.height;
  template.scanProfile = "apeos-a4-v1";
  return template;
}

export function averageOffset(offsets) {
  const valid = (offsets || []).filter(value => Array.isArray(value) && value.length === 2);
  if (!valid.length) return [0, 0];
  const sortedX = valid.map(value => value[0]).sort((a, b) => a - b);
  const sortedY = valid.map(value => value[1]).sort((a, b) => a - b);
  const middle = Math.floor(valid.length / 2);
  return [sortedX[middle], sortedY[middle]];
}
