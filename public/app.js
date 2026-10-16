import * as pdfjsLib from "/vendor/pdf.min.mjs";
import { buildSurveyWorkbook } from "/xlsx-export.js";
import { REPORT_CHARTS, resolveChartData } from "/report-config.js";
import { REFERENCE_PDF_BASE64 } from "/reference-template.js";
import { chooseRecognizedCandidate, combineRecognizedLines, recognizeHandwritingLocally } from "/handwriting-ocr.js";
import { HANDWRITING_PREPROCESS, expandTextRegion, inkBounds } from "/handwriting-preprocess.js";
import {
  LOGICAL_SURVEY_PAGES,
  ignoredSourcePageNumber,
  resolveSourcePagesPerSurvey,
  sourcePageNumber
} from "/survey-pages.js";
import {
  PAGE_REGISTRATION_LINES,
  PAGE_TEMPLATE_PROFILES,
  applyA4ScanLayout,
  averageOffset
} from "/scan-layout.js";
import { summarizePageTemplateMatch, validatePageTemplateProfiles } from "/page-template-matcher.js";
import {
  REGISTRATION,
  applyHomography,
  chooseExtractionScale,
  estimatePageBoxFromContent,
  mapPagePoint,
  mappedQuadrilateral,
  ransacHomography
} from "/projective-registration.js";
import {
  calibratePageTone,
  clearCalibration,
  learnedThreshold,
  loadCalibration,
  multiThresholdVote,
  normalizeTone,
  recordCalibration
} from "/scan-calibration.js";
import {
  OMR_TOLERANCE,
  combineMarkFeatures,
  coarseAlignmentOffsets,
  estimateSkewSlope,
  fineAlignmentOffsets,
  insetCheckboxBox,
  localShiftPixels,
  multiChoiceConfidence,
  resolveMultiChoice,
  resolveSingleChoice
} from "/omr-tolerance.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs";

const state = {
  template: null,
  files: [],
  pdfs: new Map(),
  referencePdf: null,
  referenceCanvases: new Map(),
  surveys: [],
  selectedSurvey: 0,
  selectedPage: 1,
  activeQuestion: null,
  batch: { school: "", visitDate: "" },
  isProcessing: false,
  handwritingUnavailable: false,
  handwritingMessage: "",
  calibrationProfile: { version: 4, questions: {} },
  extractionScale: 3.25
};

const SESSION_STORAGE_KEY = "u4b-survey-session-v3";

const els = {
  fileInput: document.querySelector("#pdf-input"),
  dropZone: document.querySelector("#drop-zone"),
  schoolInput: document.querySelector("#school-input"),
  visitDateInput: document.querySelector("#visit-date-input"),
  pagesPerSurvey: document.querySelector("#pages-per-survey"),
  fileSummary: document.querySelector("#file-summary"),
  fileName: document.querySelector("#file-name"),
  fileDetails: document.querySelector("#file-details"),
  selectedFileList: document.querySelector("#selected-file-list"),
  addFilesButton: document.querySelector("#add-files-button"),
  processButton: document.querySelector("#process-button"),
  progress: document.querySelector("#progress"),
  progressText: document.querySelector("#progress-text"),
  progressValue: document.querySelector("#progress-value"),
  progressBar: document.querySelector("#progress-bar"),
  uploadError: document.querySelector("#upload-error"),
  workspace: document.querySelector("#workspace"),
  surveyList: document.querySelector("#survey-list"),
  reviewKicker: document.querySelector("#review-kicker"),
  pageTabs: document.querySelector("#page-tabs"),
  reviewCanvas: document.querySelector("#review-canvas"),
  answerOverlay: document.querySelector("#answer-overlay"),
  answerForm: document.querySelector("#answer-form"),
  sectionFilter: document.querySelector("#section-filter"),
  reviewStatus: document.querySelector("#review-status"),
  approveButton: document.querySelector("#approve-button"),
  downloadXlsxButton: document.querySelector("#download-xlsx-button"),
  downloadCsvButton: document.querySelector("#download-csv-button"),
  downloadJsonButton: document.querySelector("#download-json-button"),
  chartGrid: document.querySelector("#chart-grid"),
  toast: document.querySelector("#toast"),
  metricSurveys: document.querySelector("#metric-surveys"),
  metricReady: document.querySelector("#metric-ready"),
  metricReview: document.querySelector("#metric-review"),
  clearDataButton: document.querySelector("#clear-data-button"),
  reviewNotice: document.querySelector("#review-notice")
};

const REFERENCE_CONTENT_BOUNDS = {
  1: [41.24, 25.53, 545.89, 734.4],
  2: [37.96, 55.64, 543.27, 679.42],
  3: [33.38, 39.93, 551.13, 723.93],
  4: [32.07, 55.64, 537.38, 725.89],
  5: [41.89, 39.27, 550.47, 570.76]
};

function decodeBase64(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function setError(message = "") {
  els.uploadError.hidden = !message;
  els.uploadError.textContent = message;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { els.toast.hidden = true; }, 3600);
}

function sessionPayload() {
  return {
    version: 3,
    templateId: state.template?.id || "",
    savedAt: new Date().toISOString(),
    batch: state.batch,
    surveys: state.surveys
  };
}

function saveSession() {
  if (!state.template || !state.surveys.length) return;
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionPayload()));
  } catch {
    showToast("The reviewed data could not be saved in this browser. Download a backup file.");
  }
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (!saved || saved.version !== 3 || saved.templateId !== state.template.id || !Array.isArray(saved.surveys)) return false;
    state.batch = { school: saved.batch?.school || "", visitDate: saved.batch?.visitDate || "" };
    state.surveys = saved.surveys;
    for (const survey of state.surveys) {
      const name = survey.answers?.STUDENT_NAME;
      if (name) {
        name.value = Array.from(String(name.value || "")).slice(0, 20).join("");
        name.nameConfirmed = name.nameConfirmed === true;
      }
    }
    state.selectedSurvey = 0;
    state.selectedPage = 1;
    els.schoolInput.value = state.batch.school;
    els.visitDateInput.value = state.batch.visitDate;
    els.workspace.hidden = false;
    renderAll();
    renderReviewPage();
    showToast(`Restored ${state.surveys.length} saved survey${state.surveys.length === 1 ? "" : "s"}. Upload the original PDF file or files again to restore page images.`);
    return true;
  } catch {
    return false;
  }
}

function clearLocalData() {
  let storedSession = null;
  try { storedSession = localStorage.getItem(SESSION_STORAGE_KEY); } catch { /* optional storage */ }
  const hasData = state.surveys.length || storedSession;
  if (hasData && !window.confirm("Clear the saved survey session and learned checkbox calibration from this browser?")) return;
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { /* optional storage */ }
  clearCalibration();
  state.calibrationProfile = { version: 4, questions: {} };
  state.surveys = [];
  state.files = [];
  state.pdfs.clear();
  els.fileInput.value = "";
  els.selectedFileList.replaceChildren();
  els.fileSummary.hidden = true;
  els.workspace.hidden = true;
  els.progress.hidden = true;
  setError();
  showToast("Local survey data and calibration were cleared.");
}

function updateProgress(value, text) {
  const safeValue = Math.max(0, Math.min(100, Math.round(value)));
  els.progress.hidden = false;
  els.progressBar.value = safeValue;
  els.progressBar.textContent = `${safeValue}%`;
  els.progressValue.textContent = `${safeValue}%`;
  els.progressText.textContent = text;
}

async function loadTemplate() {
  const response = await fetch("/data/school-visit-v1.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Survey template could not be loaded.");
  const template = await response.json();
  applyA4ScanLayout(template);
  validateTemplate(template);
  return template;
}

function validateTemplate(template) {
  if (!template?.id || !Array.isArray(template.questions) || template.pagesPerSurvey !== 5) {
    throw new Error("Survey template is invalid.");
  }
  const keys = new Set();
  for (const question of template.questions) {
    if (!question.key || keys.has(question.key)) throw new Error("Survey template contains duplicate question keys.");
    keys.add(question.key);
    if (["single", "multi"].includes(question.type) && !question.options?.length) {
      throw new Error(`Question ${question.key} has no choices.`);
    }
  }
  const profileErrors = validatePageTemplateProfiles(template, PAGE_TEMPLATE_PROFILES);
  if (profileErrors.length) throw new Error(profileErrors.join(" "));
}

function renderSelectedFiles() {
  els.selectedFileList.replaceChildren();
  const totalBytes = state.files.reduce((sum, file) => sum + file.size, 0);
  els.fileName.textContent = state.files.length === 1
    ? state.files[0].name
    : `${state.files.length} PDF files selected`;
  els.fileDetails.textContent = `${formatBytes(totalBytes)} total · all responses will be combined into one report`;
  els.fileSummary.hidden = !state.files.length;
  for (const file of state.files) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = file.name;
    const size = document.createElement("small");
    size.textContent = formatBytes(file.size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => {
      state.files = state.files.filter(candidate => candidate !== file);
      state.pdfs.delete(file.name);
      renderSelectedFiles();
      renderReviewPage();
    });
    label.append(" ", size);
    item.append(label, remove);
    els.selectedFileList.append(item);
  }
}

async function acceptFiles(fileList) {
  setError();
  const incoming = [...(fileList || [])];
  if (!incoming.length) return;
  const invalid = incoming.find(file => file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"));
  if (invalid) {
    setError(`${invalid.name} is not a PDF file.`);
    return;
  }
  const files = [...state.files];
  let added = 0;
  for (const file of incoming) {
    const existing = files.find(candidate => candidate.name === file.name);
    if (existing) {
      const identical = existing.size === file.size && existing.lastModified === file.lastModified;
      if (!identical) {
        setError(`Two different PDFs are named ${file.name}. Rename one file before adding it.`);
        return;
      }
      continue;
    }
    files.push(file);
    added += 1;
  }
  state.files = files;
  state.pdfs.clear();
  els.fileInput.value = "";
  renderSelectedFiles();
  if (!added) showToast("That PDF is already in the upload list.");
  const savedSources = new Set(state.surveys.map(survey => survey.sourceFile).filter(Boolean));
  const selectedNames = new Set(files.map(file => file.name));
  if (state.surveys.length && savedSources.size && [...savedSources].every(name => selectedNames.has(name))) {
    try {
      for (const file of files) {
        if (!savedSources.has(file.name)) continue;
        const data = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data }).promise;
        const sourceSurveys = state.surveys.filter(survey => survey.sourceFile === file.name);
        const requiredPages = Math.max(...sourceSurveys.flatMap(survey => Object.values(survey.pageMap || {})), 0);
        if (pdf.numPages < requiredPages) throw new Error(`${file.name} has fewer pages than the saved survey session.`);
        state.pdfs.set(file.name, pdf);
      }
      await renderReviewPage();
      showToast("The original PDFs were attached to the saved answers. Existing corrections were preserved.");
    } catch (error) {
      state.pdfs.clear();
      setError(error instanceof Error ? error.message : "The saved session could not be linked to this PDF.");
    }
  }
}

function setupUploadEvents() {
  els.fileInput.addEventListener("change", () => acceptFiles(els.fileInput.files));
  els.addFilesButton.addEventListener("click", () => els.fileInput.click());
  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      els.dropZone.classList.add("is-dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, event => {
      event.preventDefault();
      els.dropZone.classList.remove("is-dragging");
    });
  }
  els.dropZone.addEventListener("drop", event => acceptFiles(event.dataTransfer?.files));
}

function canvasPixels(canvas) {
  const image = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  return { data: image.data, width: canvas.width, height: canvas.height };
}

function pixelLuminance(pixels, x, y) {
  const safeX = Math.max(0, Math.min(pixels.width - 1, Math.round(x)));
  const safeY = Math.max(0, Math.min(pixels.height - 1, Math.round(y)));
  const index = (safeY * pixels.width + safeX) * 4;
  return 0.2126 * pixels.data[index] + 0.7152 * pixels.data[index + 1] + 0.0722 * pixels.data[index + 2];
}

function quantile(sortedValues, fraction) {
  if (!sortedValues.length) return 0;
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * fraction))];
}

function detectContentBounds(pixels) {
  const rowCounts = new Uint32Array(pixels.height);
  const columnCounts = new Uint32Array(pixels.width);
  for (let y = 0; y < pixels.height; y += 1) {
    for (let x = 0; x < pixels.width; x += 1) {
      const index = (y * pixels.width + x) * 4;
      const luminance = 0.2126 * pixels.data[index] + 0.7152 * pixels.data[index + 1] + 0.0722 * pixels.data[index + 2];
      if (luminance < 190) {
        rowCounts[y] += 1;
        columnCounts[x] += 1;
      }
    }
  }
  const validRows = [];
  const validColumns = [];
  const rowMinimum = Math.max(10, pixels.width * 0.012);
  const columnMinimum = Math.max(10, pixels.height * 0.006);
  rowCounts.forEach((count, index) => { if (count > rowMinimum) validRows.push(index); });
  columnCounts.forEach((count, index) => { if (count > columnMinimum) validColumns.push(index); });
  if (!validRows.length || !validColumns.length) return [0, 0, pixels.width - 1, pixels.height - 1];
  return [
    quantile(validColumns, 0.02),
    quantile(validRows, 0.02),
    quantile(validColumns, 0.98),
    quantile(validRows, 0.98)
  ];
}

function sampledDarkDensity(pixels, threshold = 205, stride = 4) {
  const marginX = Math.round(pixels.width * 0.03);
  const marginY = Math.round(pixels.height * 0.03);
  let dark = 0;
  let total = 0;
  for (let y = marginY; y < pixels.height - marginY; y += stride) {
    for (let x = marginX; x < pixels.width - marginX; x += stride) {
      if (pixelLuminance(pixels, x, y) < threshold) dark += 1;
      total += 1;
    }
  }
  return total ? dark / total : 0;
}

function registrationBounds(registration) {
  return Array.isArray(registration) ? registration : registration.bounds;
}

function rotateMappedPoint(x, y, centerX, centerY, skewSlope = 0) {
  if (!skewSlope) return [x, y];
  const angle = Math.atan(skewSlope);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const offsetX = x - centerX;
  const offsetY = y - centerY;
  return [
    centerX + offsetX * cosine - offsetY * sine,
    centerY + offsetX * sine + offsetY * cosine
  ];
}

function mapTemplatePoint(x, y, logicalPage, registration) {
  const scanBounds = registrationBounds(registration);
  const referenceBounds = REFERENCE_CONTENT_BOUNDS[logicalPage];
  const mappedX = scanBounds[0] + ((x - referenceBounds[0]) / (referenceBounds[2] - referenceBounds[0])) * (scanBounds[2] - scanBounds[0]);
  const mappedY = scanBounds[1] + ((y - referenceBounds[1]) / (referenceBounds[3] - referenceBounds[1])) * (scanBounds[3] - scanBounds[1]);
  const skewSlope = Array.isArray(registration) ? 0 : registration.skewSlope || 0;
  return rotateMappedPoint(
    mappedX,
    mappedY,
    (scanBounds[0] + scanBounds[2]) / 2,
    (scanBounds[1] + scanBounds[3]) / 2,
    skewSlope
  );
}

function mapScanPoint(x, y, registration) {
  if (registration?.homography) return applyHomography(registration.homography, x, y);
  const width = registration.width || registration.bounds?.[2] + 1 || state.template.scanPageWidth;
  const height = registration.height || registration.bounds?.[3] + 1 || state.template.scanPageHeight;
  const [mappedX, mappedY] = mapPagePoint(
    x,
    y,
    state.template.scanPageWidth,
    state.template.scanPageHeight,
    width,
    height,
    registration.pageBox
  );
  const centerX = registration.pageBox ? (registration.pageBox[0] + registration.pageBox[2]) / 2 : width / 2;
  const centerY = registration.pageBox ? (registration.pageBox[1] + registration.pageBox[3]) / 2 : height / 2;
  return rotateMappedPoint(mappedX, mappedY, centerX, centerY, registration.skewSlope || 0);
}

function pageRegistrationLineScore(pixels, registration, logicalPage, offset = [0, 0]) {
  const lines = PAGE_REGISTRATION_LINES[logicalPage] || [];
  if (!lines.length) return null;
  const scores = [];
  for (const [sourceLeft, sourceTop, sourceRight, sourceBottom] of lines) {
    const [left, top] = mapScanPoint(sourceLeft, sourceTop, registration);
    const [right, bottom] = mapScanPoint(sourceRight, sourceBottom, registration);
    let dark = 0;
    let total = 0;
    for (let step = 0.08; step <= 0.92; step += 0.01) {
      const x = left + (right - left) * step + offset[0];
      const y = top + (bottom - top) * step + offset[1];
      for (let thickness = -1; thickness <= 1; thickness += 1) {
        if (pixelLuminance(pixels, x, y + thickness) < 205) dark += 1;
        total += 1;
      }
    }
    scores.push(total ? dark / total : 0);
  }
  scores.sort((left, right) => left - right);
  return scores.length % 2
    ? scores[Math.floor(scores.length / 2)]
    : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2;
}

function rawPageLayoutScore(pixels, registration, logicalPage, template) {
  const questions = template.questions.filter(question => question.page === logicalPage && question.options?.length);
  const options = questions.flatMap(question => question.options || []);
  const profile = PAGE_TEMPLATE_PROFILES[logicalPage];
  if (!options.length || !profile) return { score: 0, matched: false, anchorCoverage: 0, meanBorder: 0 };
  const sampledOptions = options.filter((_, index) => index % Math.max(1, Math.floor(options.length / 12)) === 0).slice(0, 14);
  let bestOffset = [0, 0];
  let bestBorder = -Infinity;
  for (let offsetY = -24; offsetY <= 24; offsetY += 6) {
    for (let offsetX = -24; offsetX <= 24; offsetX += 6) {
      const score = sampledOptions.reduce(
        (sum, option) => sum + checkboxBorderScore(
          pixels,
          mappedCheckboxRect(option, logicalPage, registration),
          offsetX,
          offsetY
        ),
        0
      ) / sampledOptions.length;
      if (score > bestBorder) {
        bestBorder = score;
        bestOffset = [offsetX, offsetY];
      }
    }
  }
  const borderScores = [];
  for (const option of options) {
    const rect = mappedCheckboxRect(option, logicalPage, registration);
    const offset = bestOffset;
    borderScores.push(checkboxBorderScore(pixels, rect, offset[0], offset[1]));
  }
  const lineScore = pageRegistrationLineScore(pixels, registration, logicalPage, bestOffset);
  return {
    ...summarizePageTemplateMatch(borderScores, profile, { lineScore }),
    bestOffset
  };
}

function expectedScanContentBounds(logicalPage, template) {
  const bounds = REFERENCE_CONTENT_BOUNDS[logicalPage];
  if (!bounds) return null;
  return [
    bounds[0] * template.scanPageWidth / template.pageWidth,
    bounds[1] * template.scanPageHeight / template.pageHeight,
    bounds[2] * template.scanPageWidth / template.pageWidth,
    bounds[3] * template.scanPageHeight / template.pageHeight
  ];
}

function pageLayoutScore(pixels, registration, logicalPage, template) {
  const directRegistration = { ...registration, pageBox: null };
  const directMatch = rawPageLayoutScore(pixels, directRegistration, logicalPage, template);
  const estimatedPageBox = estimatePageBoxFromContent(
    registration.bounds,
    expectedScanContentBounds(logicalPage, template),
    template.scanPageWidth,
    template.scanPageHeight,
    registration.width,
    registration.height
  );
  if (!estimatedPageBox) return { ...directMatch, pageBox: null };
  const adjustedMatch = rawPageLayoutScore(pixels, { ...registration, pageBox: estimatedPageBox }, logicalPage, template);
  return adjustedMatch.score > directMatch.score + 0.01
    ? { ...adjustedMatch, pageBox: estimatedPageBox }
    : { ...directMatch, pageBox: null };
}

function classifyPage(pixels, registration, template) {
  const scores = Array.from({ length: template.pagesPerSurvey }, (_, index) => {
    const page = index + 1;
    return { page, ...pageLayoutScore(pixels, registration, page, template) };
  }).sort((a, b) => b.score - a.score);
  return { page: scores[0].page, score: scores[0].score, margin: scores[0].score - scores[1].score, scores };
}

function mappedCheckboxRect(option, logicalPage, registration) {
  const box = option.scanBox || option.box;
  const mapper = option.scanBox ? mapScanPoint : (x, y, currentRegistration) => mapTemplatePoint(x, y, logicalPage, currentRegistration);
  const corners = [
    mapper(box[0], box[1], registration),
    mapper(box[2], box[1], registration),
    mapper(box[2], box[3], registration),
    mapper(box[0], box[3], registration)
  ];
  const xs = corners.map(point => point[0]).filter(Number.isFinite);
  const ys = corners.map(point => point[1]).filter(Number.isFinite);
  if (xs.length !== 4 || ys.length !== 4) return [0, 0, 0, 0];
  return [Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys))];
}

function checkboxColumn(option, template) {
  const box = option.scanBox || option.box;
  const pageWidth = option.scanBox ? template.scanPageWidth : template.pageWidth;
  return ((box[0] + box[2]) / 2) < pageWidth / 2 ? "left" : "right";
}

function checkboxBorderScore(scanPixels, rect, offsetX, offsetY) {
  const [baseLeft, baseTop, baseRight, baseBottom] = rect;
  const left = baseLeft + offsetX;
  const top = baseTop + offsetY;
  const right = baseRight + offsetX;
  const bottom = baseBottom + offsetY;
  if (left < 2 || top < 2 || right >= scanPixels.width - 2 || bottom >= scanPixels.height - 2) return 0;
  let dark = 0;
  let total = 0;
  for (let thickness = -1; thickness <= 1; thickness += 1) {
    for (let x = left; x <= right; x += 1) {
      dark += pixelLuminance(scanPixels, x, top + thickness) < 190 ? 1 : 0;
      dark += pixelLuminance(scanPixels, x, bottom + thickness) < 190 ? 1 : 0;
      total += 2;
    }
    for (let y = top; y <= bottom; y += 1) {
      dark += pixelLuminance(scanPixels, left + thickness, y) < 190 ? 1 : 0;
      dark += pixelLuminance(scanPixels, right + thickness, y) < 190 ? 1 : 0;
      total += 2;
    }
  }
  return total ? dark / total : 0;
}

function pageCheckboxOffsets(scanPixels, questions, logicalPage, registration, template) {
  const groups = { left: [], right: [] };
  for (const option of questions.flatMap(question => question.options || [])) {
    groups[checkboxColumn(option, template)].push(mappedCheckboxRect(option, logicalPage, registration));
  }
  const result = {};
  const scale = Math.max(
    scanPixels.width / (template.scanPageWidth || scanPixels.width),
    scanPixels.height / (template.scanPageHeight || scanPixels.height)
  );
  const horizontalRange = Math.min(170, Math.max(42, Math.round(scale * 36)));
  const verticalRange = Math.min(150, Math.max(36, Math.round(scale * 30)));
  const linkedRange = Math.min(110, Math.max(28, Math.round(scale * 24)));
  const coarseStep = Math.max(2, Math.round(scale * 1.4));
  for (const column of ["left", "right"]) {
    const rectangles = groups[column];
    if (!rectangles.length) continue;
    const leftOffset = result.left?.[0] || 0;
    const minimumX = column === "right" && result.left ? leftOffset - linkedRange : -horizontalRange;
    const maximumX = column === "right" && result.left ? leftOffset + linkedRange : horizontalRange;
    let best = { score: -Infinity, offset: [0, 0] };
    const evaluate = (offsetX, offsetY, distanceOrigin = [0, 0]) => {
      const border = rectangles.reduce(
        (sum, rect) => sum + checkboxBorderScore(scanPixels, rect, offsetX, offsetY),
        0
      ) / rectangles.length;
      const distance = Math.abs(offsetX - distanceOrigin[0]) + Math.abs(offsetY - distanceOrigin[1]);
      const score = border - distance * 0.001;
      if (score > best.score) best = { score, offset: [offsetX, offsetY] };
    };
    for (let offsetY = -verticalRange; offsetY <= verticalRange; offsetY += coarseStep) {
      for (let offsetX = minimumX; offsetX <= maximumX; offsetX += coarseStep) evaluate(offsetX, offsetY);
    }
    const coarse = best.offset;
    const fineRadius = coarseStep + 2;
    for (let offsetY = coarse[1] - fineRadius; offsetY <= coarse[1] + fineRadius; offsetY += 1) {
      for (let offsetX = coarse[0] - fineRadius; offsetX <= coarse[0] + fineRadius; offsetX += 1) {
        if (offsetX >= minimumX && offsetX <= maximumX && Math.abs(offsetY) <= verticalRange + 3) evaluate(offsetX, offsetY, coarse);
      }
    }
    result[column] = best.offset;
  }
  return result;
}

function checkboxCenter(option) {
  const box = option.scanBox || option.box;
  return [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
}

function findCheckboxAnchors(scanPixels, questions, logicalPage, registration, template, preliminaryOffsets) {
  const anchors = [];
  const scale = Math.max(scanPixels.width / template.scanPageWidth, scanPixels.height / template.scanPageHeight);
  const refinementRadius = Math.min(
    REGISTRATION.maximumAnchorSearchPixels,
    Math.max(20, Math.round(scale * 12))
  );
  for (const option of questions.flatMap(question => question.options || [])) {
    if (!option.scanBox) continue;
    const rect = mappedCheckboxRect(option, logicalPage, registration);
    const column = checkboxColumn(option, template);
    const base = preliminaryOffsets[column] || [0, 0];
    let best = { score: -Infinity, offset: base };
    for (let offsetY = base[1] - refinementRadius; offsetY <= base[1] + refinementRadius; offsetY += 2) {
      for (let offsetX = base[0] - refinementRadius; offsetX <= base[0] + refinementRadius; offsetX += 2) {
        const border = checkboxBorderScore(scanPixels, rect, offsetX, offsetY);
        const distance = Math.hypot(offsetX - base[0], offsetY - base[1]);
        const score = border - distance * 0.0015;
        if (score > best.score) best = { score, offset: [offsetX, offsetY] };
      }
    }
    for (let offsetY = best.offset[1] - 2; offsetY <= best.offset[1] + 2; offsetY += 1) {
      for (let offsetX = best.offset[0] - 2; offsetX <= best.offset[0] + 2; offsetX += 1) {
        const score = checkboxBorderScore(scanPixels, rect, offsetX, offsetY);
        if (score > best.score) best = { score, offset: [offsetX, offsetY] };
      }
    }
    if (best.score < REGISTRATION.minimumAnchorScore) continue;
    const source = checkboxCenter(option);
    anchors.push({
      source,
      target: [
        (rect[0] + rect[2]) / 2 + best.offset[0],
        (rect[1] + rect[3]) / 2 + best.offset[1]
      ],
      score: best.score,
      value: option.value
    });
  }
  return anchors;
}

function lineEndpointAnchor(scanPixels, source, inwardDirection, registration, baseOffset, scale) {
  const mapped = mapScanPoint(source[0], source[1], registration);
  const searchRadius = Math.min(34, Math.max(12, Math.round(scale * 6)));
  const sampleStart = Math.round(scale * 12);
  const sampleLength = Math.round(scale * 56);
  const centerX = Math.round(mapped[0] + baseOffset[0]);
  const expectedY = Math.round(mapped[1] + baseOffset[1]);
  let best = { score: -Infinity, y: expectedY };

  for (let y = expectedY - searchRadius; y <= expectedY + searchRadius; y += 1) {
    let dark = 0;
    let total = 0;
    for (let distance = sampleStart; distance <= sampleStart + sampleLength; distance += 1) {
      const x = centerX + inwardDirection * distance;
      if (x < 0 || x >= scanPixels.width || y < 0 || y >= scanPixels.height) continue;
      dark += pixelLuminance(scanPixels, x, y) < 205 ? 1 : 0;
      total += 1;
    }
    const density = total ? dark / total : 0;
    const score = density - Math.abs(y - expectedY) * 0.001;
    if (score > best.score) best = { score, y };
  }

  if (best.score < 0.42) return null;
  return {
    source,
    target: [centerX, best.y],
    score: best.score,
    value: "ruled-line"
  };
}

function findRuledLineAnchors(scanPixels, logicalPage, registration, preliminaryOffsets, scale) {
  const lines = PAGE_REGISTRATION_LINES[logicalPage] || [];
  if (!lines.length) return [];
  const anchors = [];
  const leftOffset = preliminaryOffsets.left || [0, 0];
  const rightOffset = preliminaryOffsets.right || leftOffset;
  for (const [left, top, right, bottom] of lines) {
    const leftAnchor = lineEndpointAnchor(
      scanPixels,
      [left, top],
      1,
      registration,
      leftOffset,
      scale
    );
    const rightAnchor = lineEndpointAnchor(
      scanPixels,
      [right, bottom],
      -1,
      registration,
      rightOffset,
      scale
    );
    if (leftAnchor) anchors.push(leftAnchor);
    if (rightAnchor) anchors.push(rightAnchor);
  }
  return anchors;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(area) / 2;
}

function plausibleRegisteredQuad(quad, width, height) {
  if (!Array.isArray(quad) || quad.length !== 4 || quad.some(point => point.some(value => !Number.isFinite(value)))) return false;
  const areaRatio = polygonArea(quad) / Math.max(1, width * height);
  if (areaRatio < 0.48 || areaRatio > 1.65) return false;
  const marginX = width * 0.32;
  const marginY = height * 0.32;
  if (quad.some(([x, y]) => x < -marginX || x > width + marginX || y < -marginY || y > height + marginY)) return false;
  const top = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
  const bottom = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
  const left = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
  const right = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
  if (Math.min(top, bottom, left, right) < Math.min(width, height) * 0.45) return false;
  if (Math.max(top, bottom) / Math.max(1, Math.min(top, bottom)) > 1.55) return false;
  if (Math.max(left, right) / Math.max(1, Math.min(left, right)) > 1.55) return false;
  return true;
}

function registerPagePerspective(scanPixels, questions, logicalPage, registration, template) {
  const preliminaryOffsets = pageCheckboxOffsets(scanPixels, questions, logicalPage, registration, template);
  const checkboxAnchors = findCheckboxAnchors(
    scanPixels,
    questions,
    logicalPage,
    registration,
    template,
    preliminaryOffsets
  );
  const scale = Math.max(scanPixels.width / template.scanPageWidth, scanPixels.height / template.scanPageHeight);
  const anchors = checkboxAnchors.concat(
    findRuledLineAnchors(scanPixels, logicalPage, registration, preliminaryOffsets, scale)
  );
  const result = ransacHomography(anchors, {
    threshold: Math.max(REGISTRATION.reprojectionThresholdPixels, scale * 1.6)
  });
  const quad = result ? mappedQuadrilateral(result.matrix, template.scanPageWidth, template.scanPageHeight) : null;
  const minimumInliers = Math.max(REGISTRATION.minimumInliers, Math.min(10, Math.ceil(anchors.length * 0.28)));
  if (!result || result.inliers.length < minimumInliers || !plausibleRegisteredQuad(quad, scanPixels.width, scanPixels.height)) {
    registration.registrationMode = "rotation-and-offset";
    registration.anchorCount = anchors.length;
    registration.inlierCount = result?.inliers?.length || 0;
    registration.registrationError = result?.meanError ?? null;
    registration.registrationConfidence = 0;
    return preliminaryOffsets;
  }
  registration.homography = result.matrix;
  registration.registrationMode = "anchor-ransac-homography";
  registration.anchorCount = anchors.length;
  registration.inlierCount = result.inliers.length;
  registration.registrationError = result.meanError;
  registration.registrationConfidence = Math.max(0, Math.min(1, result.inlierRatio * (1 - result.meanError / 20)));
  registration.documentQuad = quad;
  return pageCheckboxOffsets(scanPixels, questions, logicalPage, registration, template);
}

function scanPointForReferenceCheckbox(option, referenceX, referenceY, registration) {
  const referenceBox = option.referenceBox || option.box;
  const scanBox = option.scanBox || option.box;
  const relativeX = (referenceX - referenceBox[0]) / Math.max(0.001, referenceBox[2] - referenceBox[0]);
  const relativeY = (referenceY - referenceBox[1]) / Math.max(0.001, referenceBox[3] - referenceBox[1]);
  return mapScanPoint(
    scanBox[0] + relativeX * (scanBox[2] - scanBox[0]),
    scanBox[1] + relativeY * (scanBox[3] - scanBox[1]),
    registration
  );
}

function readPixelFeatures(scanPixels, referencePixels, option, logicalPage, registration, template, pageOffsets) {
  const box = option.referenceBox || option.box;
  const column = checkboxColumn(option, template);
  const baseOffset = pageOffsets[column] || [0, 0];
  const detection = insetCheckboxBox(box);
  const scanSamples = [];
  const differenceSamples = [];
  const quadrants = [0, 0, 0, 0];
  const quadrantTotals = [0, 0, 0, 0];
  const centerSamples = [];
  for (let y = detection[1]; y <= detection[3]; y += 1) {
    for (let x = detection[0]; x <= detection[2]; x += 1) {
      const referenceX = (x / template.pageWidth) * referencePixels.width;
      const referenceY = (y / template.pageHeight) * referencePixels.height;
      const referenceLuminance = pixelLuminance(referencePixels, referenceX, referenceY);
      let referenceIsWhite = true;
      for (let offsetY = -3; offsetY <= 3 && referenceIsWhite; offsetY += 1) {
        for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
          if (pixelLuminance(referencePixels, referenceX + offsetX, referenceY + offsetY) <= 235) {
            referenceIsWhite = false;
            break;
          }
        }
      }
      if (!referenceIsWhite) continue;
      const [mappedX, mappedY] = scanPointForReferenceCheckbox(option, x, y, registration);
      const scanLuminance = normalizeTone(
        pixelLuminance(scanPixels, mappedX + baseOffset[0], mappedY + baseOffset[1]),
        registration.tone
      );
      scanSamples.push(scanLuminance);
      differenceSamples.push(Math.max(0, referenceLuminance - scanLuminance));
      const quadrant = (x >= (detection[0] + detection[2]) / 2 ? 1 : 0) + (y >= (detection[1] + detection[3]) / 2 ? 2 : 0);
      quadrantTotals[quadrant] += 1;
      if (scanLuminance < OMR_TOLERANCE.inkThreshold) quadrants[quadrant] += 1;
      if (x >= box[0] + 2 && x <= box[2] - 2 && y >= box[1] + 2 && y <= box[3] - 2) centerSamples.push(scanLuminance);
    }
  }
  const insideVote = multiThresholdVote(scanSamples);
  const centerVote = multiThresholdVote(centerSamples, [155, 180, 205]);
  const differenceDensities = [35, 55, 75].map(
    threshold => differenceSamples.filter(value => value > threshold).length / Math.max(1, differenceSamples.length)
  );
  const differenceDensity = [...differenceDensities].sort((a, b) => a - b)[1];
  const strokeCoverage = quadrants.reduce(
    (count, ink, index) => count + (quadrantTotals[index] && ink / quadrantTotals[index] > 0.018 ? 1 : 0),
    0
  ) / 4;
  const combined = combineMarkFeatures({
    coreDensity: centerVote.score,
    expandedDensity: Math.max(insideVote.score, differenceDensity),
    strokeCoverage
  });
  const agreement = Math.min(insideVote.agreement, centerVote.agreement || 1);
  const score = Math.max(0, combined * (0.94 + agreement * 0.06));
  // Extremely dense marks are often corrections, crossed-out answers or
  // scribbles. Do not silently reinterpret them; keep the detected value but
  // force review so the operator can resolve the student's final intention.
  const overmarked = centerVote.score >= 0.42 || (insideVote.score >= 0.30 && strokeCoverage >= 0.75);
  return {
    score,
    overmarked,
    coreDensity: centerVote.score,
    expandedDensity: insideVote.score,
    differenceDensity,
    strokeCoverage
  };
}

function extractQuestion(question, scanPixels, referencePixels, registration, template, pageOffsets) {
  if (["text", "paragraph"].includes(question.type)) {
    return { value: "", confidence: null, flagged: false, scores: {} };
  }
  const scored = question.options.map(option => {
    const features = readPixelFeatures(scanPixels, referencePixels, option, question.page, registration, template, pageOffsets);
    return { value: option.value, ...features };
  }).sort((a, b) => b.score - a.score);
  const scoreMap = Object.fromEntries(scored.map(item => [item.value, Number(item.score.toFixed(4))]));
  const overmarkedValues = scored.filter(item => item.overmarked).map(item => item.value);

  if (question.type === "multi") {
    const selectionThreshold = learnedThreshold(state.calibrationProfile, question.key, template.markThreshold);
    const resolution = resolveMultiChoice(scored, {
      selectionThreshold,
      ambiguityMargin: template.ambiguityMargin
    });
    return {
      value: resolution.value,
      confidence: multiChoiceConfidence(scored, resolution.threshold),
      flagged: resolution.flagged || resolution.value.some(value => overmarkedValues.includes(value)),
      overmarkedValues,
      adaptiveThreshold: Number(resolution.threshold.toFixed(4)),
      scores: scoreMap
    };
  }

  const singleThreshold = learnedThreshold(
    state.calibrationProfile,
    question.key,
    template.singleMarkThreshold ?? template.markThreshold
  );
  const resolution = resolveSingleChoice(scored, {
    selectionThreshold: singleThreshold,
    conflictThreshold: template.conflictThreshold ?? OMR_TOLERANCE.conflictThreshold,
    ambiguityMargin: template.ambiguityMargin
  });
  return {
    value: resolution.value,
    conflicts: resolution.conflicts,
    confidence: Number(Math.min(0.99, Math.max(0.1, 0.5 + resolution.margin * 3.6)).toFixed(2)),
    flagged: resolution.flagged || (resolution.value && overmarkedValues.includes(resolution.value)),
    overmarkedValues,
    adaptiveThreshold: Number(resolution.threshold.toFixed(4)),
    scores: scoreMap
  };
}

async function renderPdfPage(pdf, pageNumber, scale = 2) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
  return canvas;
}

async function getReferencePage(logicalPage) {
  if (state.referenceCanvases.has(logicalPage)) return state.referenceCanvases.get(logicalPage);
  const canvas = await renderPdfPage(state.referencePdf, logicalPage, Math.min(3.25, state.extractionScale));
  const prepared = { canvas, pixels: canvasPixels(canvas) };
  state.referenceCanvases.set(logicalPage, prepared);
  return prepared;
}

function bestPageAssignment(records, pageCount) {
  let best = null;
  const visit = (physicalIndex, availablePages, assignment, score) => {
    if (physicalIndex === records.length) {
      if (!best || score > best.score) best = { assignment: [...assignment], score };
      return;
    }
    for (const logicalPage of availablePages) {
      const pageScore = records[physicalIndex].classification.scores.find(item => item.page === logicalPage)?.score || 0;
      visit(
        physicalIndex + 1,
        availablePages.filter(page => page !== logicalPage),
        [...assignment, logicalPage],
        score + pageScore
      );
    }
  };
  visit(0, Array.from({ length: pageCount }, (_, index) => index + 1), [], 0);
  return best;
}

function findTextRegionOffset(record, question, referencePixels) {
  if (question.scanTextBox) return record.registration.textOffset || [0, 0];
  const contextBox = expandTextRegion(question.textBox, HANDWRITING_PREPROCESS.alignmentPaddingPoints);
  const samples = [];
  for (let y = contextBox[1]; y <= contextBox[3]; y += HANDWRITING_PREPROCESS.alignmentSampleStepPoints) {
    for (let x = contextBox[0]; x <= contextBox[2]; x += HANDWRITING_PREPROCESS.alignmentSampleStepPoints) {
      const referenceX = (x / state.template.pageWidth) * referencePixels.width;
      const referenceY = (y / state.template.pageHeight) * referencePixels.height;
      if (pixelLuminance(referencePixels, referenceX, referenceY) >= 175) continue;
      const [scanX, scanY] = mapTemplatePoint(x, y, question.page, record.registration);
      samples.push([scanX, scanY]);
    }
  }
  if (!samples.length) return [0, 0];

  const maxShift = localShiftPixels(record.registration.bounds, question.page, REFERENCE_CONTENT_BOUNDS);
  let bestOffset = [0, 0];
  let bestScore = -Infinity;
  const scoreOffsets = offsets => {
    for (const [offsetX, offsetY] of offsets) {
      let matches = 0;
      for (const [scanX, scanY] of samples) {
        if (pixelLuminance(record.pixels, scanX + offsetX, scanY + offsetY) < 205) matches += 1;
      }
      const distancePenalty = (Math.abs(offsetX) + Math.abs(offsetY)) * 0.00035;
      const score = (matches / samples.length) - distancePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestOffset = [offsetX, offsetY];
      }
    }
  };
  scoreOffsets(coarseAlignmentOffsets(maxShift));
  scoreOffsets(fineAlignmentOffsets(bestOffset, maxShift));
  return bestOffset;
}

function distance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function rectifyMappedRegion(record, box, mapper, offset = [0, 0]) {
  const corners = [
    mapper(box[0], box[1], record.registration),
    mapper(box[2], box[1], record.registration),
    mapper(box[2], box[3], record.registration),
    mapper(box[0], box[3], record.registration)
  ];
  const width = Math.max(1, Math.round((distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2));
  const height = Math.max(1, Math.round((distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  const output = context.createImageData(width, height);
  for (let targetY = 0; targetY < height; targetY += 1) {
    const relativeY = height === 1 ? 0 : targetY / (height - 1);
    const designY = box[1] + relativeY * (box[3] - box[1]);
    for (let targetX = 0; targetX < width; targetX += 1) {
      const relativeX = width === 1 ? 0 : targetX / (width - 1);
      const designX = box[0] + relativeX * (box[2] - box[0]);
      const [mappedX, mappedY] = mapper(designX, designY, record.registration);
      const sourceX = Math.max(0, Math.min(record.pixels.width - 1, Math.round(mappedX + offset[0])));
      const sourceY = Math.max(0, Math.min(record.pixels.height - 1, Math.round(mappedY + offset[1])));
      const sourceIndex = (sourceY * record.pixels.width + sourceX) * 4;
      const targetIndex = (targetY * width + targetX) * 4;
      output.data[targetIndex] = record.pixels.data[sourceIndex];
      output.data[targetIndex + 1] = record.pixels.data[sourceIndex + 1];
      output.data[targetIndex + 2] = record.pixels.data[sourceIndex + 2];
      output.data[targetIndex + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return canvas;
}

function cropTextRegion(record, question, referencePage) {
  const sourceTextBox = question.scanTextBox || question.textBox;
  const verticalPadding = question.type === "paragraph" ? HANDWRITING_PREPROCESS.cropPaddingPoints : 2;
  // The direct-scanner A4 boxes already span the calibrated response region.
  // Do not expand them upward: the blank-form mask removes the narrow prompt
  // overlap while retaining handwriting written above the first ruled line.
  const calibratedTextRegion = question.scanTextCropMode === "calibrated-text-region";
  const [x0, y0, x1, y1] = calibratedTextRegion
    ? sourceTextBox
    : expandTextRegion(sourceTextBox, HANDWRITING_PREPROCESS.cropPaddingPoints, verticalPadding);
  const [offsetX, offsetY] = findTextRegionOffset(record, question, referencePage.pixels);
  const mapper = question.scanTextBox ? mapScanPoint : (x, y, registration) => mapTemplatePoint(x, y, question.page, registration);
  const canvas = rectifyMappedRegion(record, [x0, y0, x1, y1], mapper, [offsetX, offsetY]);
  const sourceWidth = canvas.width;
  const sourceHeight = canvas.height;
  const reference = document.createElement("canvas");
  reference.width = sourceWidth;
  reference.height = sourceHeight;
  const referenceCanvas = referencePage.canvas;
  const referenceTextBox = question.referenceTextBox || question.textBox;
  const [referenceX0, referenceY0, referenceX1, referenceY1] = calibratedTextRegion
    ? referenceTextBox
    : expandTextRegion(referenceTextBox, HANDWRITING_PREPROCESS.cropPaddingPoints, verticalPadding);
  const referenceX = (referenceX0 / state.template.pageWidth) * referenceCanvas.width;
  const referenceY = (referenceY0 / state.template.pageHeight) * referenceCanvas.height;
  const referenceWidth = ((referenceX1 - referenceX0) / state.template.pageWidth) * referenceCanvas.width;
  const referenceHeight = ((referenceY1 - referenceY0) / state.template.pageHeight) * referenceCanvas.height;
  reference.getContext("2d", { alpha: false }).drawImage(
    referenceCanvas,
    referenceX,
    referenceY,
    referenceWidth,
    referenceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );
  return { key: question.key, title: question.title, type: question.type, canvas, reference, alignmentOffset: [offsetX, offsetY] };
}

function grayscale(data, index) {
  return (data[index] * 0.299) + (data[index + 1] * 0.587) + (data[index + 2] * 0.114);
}

function removeTinyInkComponents(binaryOutput, softOutput, width, height, minimumPixels = 4) {
  const visited = new Uint8Array(width * height);
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let start = 0; start < width * height; start += 1) {
    if (visited[start] || binaryOutput.data[start * 4] !== 0) continue;
    const stack = [start];
    const component = [];
    visited[start] = 1;
    while (stack.length) {
      const pixel = stack.pop();
      component.push(pixel);
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      for (const [offsetX, offsetY] of neighbors) {
        const targetX = x + offsetX;
        const targetY = y + offsetY;
        if (targetX < 0 || targetX >= width || targetY < 0 || targetY >= height) continue;
        const target = targetY * width + targetX;
        if (visited[target] || binaryOutput.data[target * 4] !== 0) continue;
        visited[target] = 1;
        stack.push(target);
      }
    }
    if (component.length >= minimumPixels) continue;
    for (const pixel of component) {
      const index = pixel * 4;
      for (const output of [binaryOutput, softOutput]) {
        output.data[index] = 255;
        output.data[index + 1] = 255;
        output.data[index + 2] = 255;
      }
    }
  }
}

function cleanHandwritingCrop(crop) {
  const width = crop.canvas.width;
  const height = crop.canvas.height;
  const source = crop.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
  const blank = crop.reference.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
  const referenceInk = new Uint8Array(width * height);
  const backgroundSamples = [];
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const blankLuminance = grayscale(blank.data, pixel * 4);
    if (blankLuminance < 185) referenceInk[pixel] = 1;
    else if (pixel % 7 === 0) backgroundSamples.push(grayscale(source.data, pixel * 4));
  }
  backgroundSamples.sort((left, right) => left - right);
  const background = backgroundSamples.length ? quantile(backgroundSamples, 0.86) : 245;
  const binaryThreshold = Math.max(165, Math.min(226, background - 17));
  const softThreshold = Math.max(180, Math.min(238, background - 6));
  const printedMask = new Uint8Array(referenceInk.length);
  const referenceRadius = Math.max(1, Math.round(Math.min(width, height) / 70));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!referenceInk[y * width + x]) continue;
      for (let offsetY = -referenceRadius; offsetY <= referenceRadius; offsetY += 1) {
        const targetY = y + offsetY;
        if (targetY < 0 || targetY >= height) continue;
        for (let offsetX = -referenceRadius; offsetX <= referenceRadius; offsetX += 1) {
          const targetX = x + offsetX;
          if (targetX >= 0 && targetX < width) printedMask[targetY * width + targetX] = 1;
        }
      }
    }
  }

  const binary = document.createElement("canvas");
  binary.width = width;
  binary.height = height;
  const binaryContext = binary.getContext("2d", { alpha: false, willReadFrequently: true });
  const binaryOutput = binaryContext.createImageData(width, height);
  const soft = document.createElement("canvas");
  soft.width = width;
  soft.height = height;
  const softContext = soft.getContext("2d", { alpha: false, willReadFrequently: true });
  const softOutput = softContext.createImageData(width, height);
  // Retain handwriting close to the first/last ruled line. A large all-sided
  // border used to erase legitimate strokes near the edge of feedback fields.
  const borderX = Math.max(2, Math.round(width * 0.004));
  const borderY = 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const index = pixel * 4;
      const inside = x >= borderX && x < width - borderX && y >= borderY && y < height - borderY;
      const sourceLuminance = grayscale(source.data, index);
      const blankLuminance = grayscale(blank.data, index);
      const templateDifference = blankLuminance - sourceLuminance;
      const survivesTemplate = !printedMask[pixel] || templateDifference > 58;
      const isBinaryInk = inside && sourceLuminance < binaryThreshold && survivesTemplate;
      const isSoftInk = inside && sourceLuminance < softThreshold && survivesTemplate;
      const binaryValue = isBinaryInk ? 0 : 255;
      const softValue = isSoftInk ? Math.max(0, Math.min(205, Math.round((sourceLuminance - 65) * 1.25))) : 255;
      binaryOutput.data[index] = binaryValue;
      binaryOutput.data[index + 1] = binaryValue;
      binaryOutput.data[index + 2] = binaryValue;
      binaryOutput.data[index + 3] = 255;
      softOutput.data[index] = softValue;
      softOutput.data[index + 1] = softValue;
      softOutput.data[index + 2] = softValue;
      softOutput.data[index + 3] = 255;
    }
  }

  const longRuleThreshold = width * 0.48;
  for (let y = 0; y < height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 1) if (binaryOutput.data[(y * width + x) * 4] === 0) dark += 1;
    if (dark < longRuleThreshold) continue;
    for (let wipeY = Math.max(0, y - 1); wipeY <= Math.min(height - 1, y + 1); wipeY += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (wipeY * width + x) * 4;
        for (const output of [binaryOutput, softOutput]) {
          output.data[index] = 255;
          output.data[index + 1] = 255;
          output.data[index + 2] = 255;
        }
      }
    }
  }
  removeTinyInkComponents(binaryOutput, softOutput, width, height);
  binaryContext.putImageData(binaryOutput, 0, 0);
  softContext.putImageData(softOutput, 0, 0);
  return { binary, soft };
}

function thickenInkCanvas(canvas) {
  const { width, height } = canvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const source = context.getImageData(0, 0, width, height);
  const output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const outputContext = output.getContext("2d", { alpha: false, willReadFrequently: true });
  const target = outputContext.createImageData(width, height);
  target.data.fill(255);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let darkest = 255;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const sourceY = y + offsetY;
        if (sourceY < 0 || sourceY >= height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const sourceX = x + offsetX;
          if (sourceX < 0 || sourceX >= width) continue;
          darkest = Math.min(darkest, source.data[(sourceY * width + sourceX) * 4]);
        }
      }
      const index = (y * width + x) * 4;
      target.data[index] = darkest;
      target.data[index + 1] = darkest;
      target.data[index + 2] = darkest;
      target.data[index + 3] = 255;
    }
  }
  outputContext.putImageData(target, 0, 0);
  return output;
}

function wholeFieldImage(canvas, multiline = false) {
  const { width, height } = canvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const data = context.getImageData(0, 0, width, height).data;
  const padding = Math.max(4, Math.round(Math.min(width, height) * 0.06));
  const bounds = inkBounds(data, width, height, { padding });
  if (!bounds) return null;
  const [sourceX, sourceY, sourceRight, sourceBottom] = bounds;
  const sourceWidth = sourceRight - sourceX;
  const sourceHeight = sourceBottom - sourceY;
  const targetHeight = multiline
    ? HANDWRITING_PREPROCESS.paragraphTargetHeight
    : HANDWRITING_PREPROCESS.lineTargetHeight;
  const targetWidth = Math.max(
    HANDWRITING_PREPROCESS.minimumLineWidth,
    Math.min(HANDWRITING_PREPROCESS.maximumLineWidth, Math.round((sourceWidth / sourceHeight) * targetHeight))
  );
  const output = document.createElement("canvas");
  output.width = targetWidth;
  output.height = targetHeight;
  const outputContext = output.getContext("2d", { alpha: false });
  outputContext.fillStyle = "#ffffff";
  outputContext.fillRect(0, 0, targetWidth, targetHeight);
  const scale = Math.min((targetWidth - 20) / sourceWidth, (targetHeight - 12) / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  outputContext.imageSmoothingEnabled = true;
  outputContext.drawImage(
    canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    (targetWidth - drawWidth) / 2,
    (targetHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
  return output.toDataURL("image/png");
}

function prepareHandwritingField(crop) {
  const cleaned = cleanHandwritingCrop(crop);
  const thickened = thickenInkCanvas(cleaned.binary);
  const multiline = crop.type === "paragraph";
  const images = [
    wholeFieldImage(cleaned.soft, multiline),
    wholeFieldImage(thickened, multiline)
  ].filter(Boolean);
  const lines = images.length ? [{ images }] : [];
  return { key: crop.key, lines, multiline: crop.type === "paragraph" };
}

async function recognizeHandwriting(crops, surveyIndex, progressValue) {
  const fields = crops.map(prepareHandwritingField);
  if (!fields.some(field => field.lines.length)) {
    return fields.map(field => ({ key: field.key, text: "", reviewRequired: false }));
  }
  const results = await recognizeHandwritingLocally(fields, {
    onProgress(detail) {
      if (detail.stage === "model") {
        const percentage = Number.isFinite(detail.progress)
          ? (detail.progress <= 1 ? detail.progress * 100 : detail.progress)
          : null;
        const suffix = Number.isFinite(percentage) ? ` ${Math.round(percentage)}%` : "";
        updateProgress(progressValue, `Downloading the free handwriting model${suffix}…`);
      } else if (detail.stage === "recognition") {
        updateProgress(progressValue, `Reading local handwriting for student survey ${surveyIndex}, ${detail.key || "answer"}…`);
      }
    }
  });
  return results.map(field => {
    const chosenLines = (field.candidates || []).map(candidates => chooseRecognizedCandidate(field.key, candidates));
    return {
      key: field.key,
      text: combineRecognizedLines(chosenLines, field.multiline),
      reviewRequired: chosenLines.some(line => String(line).trim())
    };
  });
}

function makeTextDefaults(question) {
  if (question.key === "SCHOOL") return state.batch.school;
  if (question.key === "SURVEY_DATE") return state.batch.visitDate;
  return "";
}

async function extractSurvey({
  pdf,
  file,
  localIndex,
  globalIndex,
  sourcePagesPerSurvey,
  totalSurveyCount
}) {
  const answers = {};
  const handwritingCrops = [];
  const basePage = localIndex * sourcePagesPerSurvey;
  const totalProcessedPages = totalSurveyCount * LOGICAL_SURVEY_PAGES;
  const pageRecords = [];
  for (let physicalIndex = 1; physicalIndex <= LOGICAL_SURVEY_PAGES; physicalIndex += 1) {
    const physicalPage = sourcePageNumber(localIndex, physicalIndex, sourcePagesPerSurvey);
    const canvas = await renderPdfPage(pdf, physicalPage, 1.5);
    const pixels = canvasPixels(canvas);
    const scanBounds = detectContentBounds(pixels);
    const registration = {
      bounds: scanBounds,
      width: pixels.width,
      height: pixels.height,
      skewSlope: estimateSkewSlope(pixels, scanBounds)
    };
    pageRecords.push({
      physicalPage,
      canvas,
      pixels,
      scanBounds,
      registration,
      classification: classifyPage(pixels, registration, state.template)
    });
    const completePages = globalIndex * LOGICAL_SURVEY_PAGES + physicalIndex;
    const percent = 12 + (completePages / totalProcessedPages) * 45;
    updateProgress(percent, `Identifying student survey ${globalIndex + 1}, scanned page ${physicalIndex} of 5…`);
    await new Promise(resolve => window.setTimeout(resolve, 0));
  }

  const bestAssignment = bestPageAssignment(pageRecords, state.template.pagesPerSurvey);
  const fixedAssignment = Array.from({ length: LOGICAL_SURVEY_PAGES }, (_, pageIndex) => pageIndex + 1);
  const fixedScore = pageRecords.reduce(
    (sum, record, recordIndex) => sum + (record.classification.scores.find(item => item.page === recordIndex + 1)?.score || 0),
    0
  );
  const assignment = bestAssignment && bestAssignment.score > fixedScore + 0.10
    ? bestAssignment.assignment
    : fixedAssignment;
  const physicalPageByLogicalPage = new Map();
  pageRecords.forEach((record, recordIndex) => physicalPageByLogicalPage.set(assignment[recordIndex], record.physicalPage));
  for (const record of pageRecords) {
    record.canvas.width = 1;
    record.canvas.height = 1;
    record.pixels = null;
  }

  const pageMap = {};
  const pageAlignments = {};
  const pageTemplateMatches = {};
  for (let logicalPage = 1; logicalPage <= state.template.pagesPerSurvey; logicalPage += 1) {
    const physicalPage = physicalPageByLogicalPage.get(logicalPage);
    const canvas = await renderPdfPage(pdf, physicalPage, state.extractionScale);
    const pixels = canvasPixels(canvas);
    const scanBounds = detectContentBounds(pixels);
    const registration = {
      bounds: scanBounds,
      width: pixels.width,
      height: pixels.height,
      skewSlope: estimateSkewSlope(pixels, scanBounds),
      tone: calibratePageTone(pixels)
    };
    registration.pageBox = pageLayoutScore(pixels, registration, logicalPage, state.template).pageBox;
    const record = { physicalPage, canvas, pixels, scanBounds, registration };
    const reference = await getReferencePage(logicalPage);
    pageMap[logicalPage] = record.physicalPage;
    const pageQuestions = state.template.questions.filter(question => question.page === logicalPage);
    const checkboxOffsets = registerPagePerspective(
      record.pixels,
      pageQuestions,
      logicalPage,
      record.registration,
      state.template
    );
    record.registration.textOffset = averageOffset(Object.values(checkboxOffsets));
    const templateMatch = pageLayoutScore(record.pixels, record.registration, logicalPage, state.template);
    pageTemplateMatches[logicalPage] = {
      id: templateMatch.id,
      label: templateMatch.label,
      matched: templateMatch.matched,
      score: Number(templateMatch.score.toFixed(4)),
      anchorCoverage: Number(templateMatch.anchorCoverage.toFixed(4)),
      matchedAnchors: templateMatch.matchedAnchors,
      expectedOptionCount: templateMatch.expectedOptionCount,
      meanBorder: Number(templateMatch.meanBorder.toFixed(4)),
      lineScore: Number.isFinite(templateMatch.lineScore) ? Number(templateMatch.lineScore.toFixed(4)) : null
    };
    pageAlignments[logicalPage] = {
      bounds: record.registration.bounds,
      pageBox: record.registration.pageBox,
      skewSlope: record.registration.skewSlope,
      width: record.pixels.width,
      height: record.pixels.height,
      homography: record.registration.homography || null,
      documentQuad: record.registration.documentQuad || null,
      registrationMode: record.registration.registrationMode,
      registrationConfidence: record.registration.registrationConfidence,
      registrationError: record.registration.registrationError ?? null,
      anchorCount: record.registration.anchorCount || 0,
      inlierCount: record.registration.inlierCount || 0,
      tone: record.registration.tone,
      checkboxOffsets,
      textOffset: record.registration.textOffset
    };
    for (const question of pageQuestions) {
      const answer = extractQuestion(question, record.pixels, reference.pixels, record.registration, state.template, checkboxOffsets);
      if (question.options?.length && !templateMatch.matched) {
        answer.flagged = true;
        answer.templateMismatch = true;
      }
      if (["text", "paragraph"].includes(question.type)) answer.value = makeTextDefaults(question);
      answers[question.key] = answer;
      if (["text", "paragraph"].includes(question.type) && question.textBox && question.recognize !== false) {
        handwritingCrops.push(cropTextRegion(record, question, reference));
      }
    }
    const completePages = globalIndex * LOGICAL_SURVEY_PAGES + logicalPage;
    const percent = 57 + (completePages / totalProcessedPages) * 36;
    updateProgress(percent, `Reading student survey ${globalIndex + 1}, ${["Before 1", "Before 2", "After 1", "After 2", "Feedback"][logicalPage - 1]}…`);
    await new Promise(resolve => window.setTimeout(resolve, 0));
  }

  let handwritingStatus = state.handwritingUnavailable ? "unavailable" : "pending";
  if (handwritingCrops.length && !state.handwritingUnavailable) {
    const handwritingProgress = 57 + (((globalIndex + 1) * LOGICAL_SURVEY_PAGES) / totalProcessedPages) * 36;
    updateProgress(handwritingProgress, `Reading handwritten answers for student survey ${globalIndex + 1}…`);
    try {
      const fields = await recognizeHandwriting(handwritingCrops, globalIndex + 1, handwritingProgress);
      for (const field of fields) {
        const answer = answers[field.key];
        if (!answer) continue;
        if (field.text || !answer.value) answer.value = field.text;
        if (field.text) {
          answer.confidence = null;
          answer.flagged = field.reviewRequired;
          answer.source = "trocr";
        }
        if (field.key === "STUDENT_NAME") answer.nameConfirmed = false;
      }
      handwritingStatus = "completed";
    } catch (error) {
      handwritingStatus = "failed";
      const message = error instanceof Error ? error.message : "Local handwriting recognition failed.";
      state.handwritingMessage = message;
      state.handwritingUnavailable = /timed out|network|fetch|cors|import|module|model|worker could not start/i.test(message);
      console.warn("Handwriting recognition skipped", error);
    }
  }
  const ignoredPage = ignoredSourcePageNumber(localIndex, sourcePagesPerSurvey);
  let ignoredPageInkDensity = null;
  if (ignoredPage) {
    const ignoredCanvas = await renderPdfPage(pdf, ignoredPage, 0.5);
    ignoredPageInkDensity = sampledDarkDensity(canvasPixels(ignoredCanvas));
    ignoredCanvas.width = 1;
    ignoredCanvas.height = 1;
  }
  const survey = {
    id: crypto.randomUUID(),
    surveyIndex: globalIndex + 1,
    pageStart: basePage + 1,
    pageEnd: basePage + LOGICAL_SURVEY_PAGES,
    ignoredPage,
    ignoredPageInkDensity,
    minimumPageClassificationMargin: Math.min(...pageRecords.map(record => record.classification.margin)),
    pageMap,
    pageAlignments,
    pageTemplateMatches,
    renderDpi: Math.round(state.extractionScale * 72),
    pagesReordered: Object.entries(pageMap).some(([logicalPage, physicalPage]) => Number(logicalPage) !== physicalPage - basePage),
    handwritingStatus,
    sourceFile: file.name,
    status: "needs_review",
    answers
  };
  survey.warnings = validateSurvey(survey);
  return survey;
}

function valueFor(survey, key) {
  return survey.answers[key]?.value;
}

function validateSurvey(survey) {
  const warnings = [];
  const studentName = survey.answers?.STUDENT_NAME;
  if (!String(studentName?.value || "").trim()) {
    warnings.push("STUDENT_NAME: enter the student's name");
  } else if (studentName?.nameConfirmed !== true) {
    warnings.push("STUDENT_NAME: confirm the detected name against the scanned form");
  }
  if ((survey.minimumPageClassificationMargin ?? 1) < 0.015) {
    warnings.push("Page order classification was uncertain; verify that all five page labels match the scanned pages");
  }
  if ((survey.ignoredPageInkDensity ?? 0) > 0.012) {
    warnings.push(`Ignored page ${survey.ignoredPage} contains substantial ink and may not be blank`);
  }
  for (const [page, match] of Object.entries(survey.pageTemplateMatches || {})) {
    if (!match.matched) {
      warnings.push(`Page ${page} does not confidently match the ${match.label || "expected"} checkbox template; verify every tick on this page`);
    }
  }
  for (const [page, alignment] of Object.entries(survey.pageAlignments || {})) {
    if (alignment.registrationMode !== "anchor-ransac-homography") {
      warnings.push(`Page ${page}: perspective registration used the rotation-and-offset fallback; verify its overlays`);
    } else if ((alignment.registrationConfidence ?? 0) < 0.5) {
      warnings.push(`Page ${page}: perspective registration confidence is low; verify its overlays`);
    }
  }
  for (const question of state.template.questions) {
    if (["text", "paragraph"].includes(question.type)) {
      const answer = survey.answers[question.key];
      if (answer?.flagged && answer.value) warnings.push(`${question.key}: verify the recognised handwriting`);
      continue;
    }
    if (question.key === "Q8" && valueFor(survey, "Q7") !== "Yes") continue;
    const answer = survey.answers[question.key];
    if (answer?.templateMismatch) continue;
    if (question.type === "single" && answer?.conflicts?.length > 1) {
      warnings.push(`${question.key}: multiple selections detected (${answer.conflicts.join(", ")}); choose one during review`);
      continue;
    }
    const empty = question.type === "multi" ? !answer?.value?.length : !answer?.value;
    if (empty) warnings.push(`${question.key}: no selection detected`);
    if (answer?.overmarkedValues?.length) {
      warnings.push(`${question.key}: heavy/corrected mark detected (${answer.overmarkedValues.join(", ")}); verify the student's final choice`);
    } else if (answer?.flagged && !empty) {
      warnings.push(`${question.key}: mark is close to the detection threshold`);
    }
  }
  if (valueFor(survey, "Q7") === "No" && valueFor(survey, "Q8")) {
    warnings.push("Q8 should normally be empty because Q7 is No");
  }
  return warnings;
}

async function processPdf() {
  if (!state.files.length || state.isProcessing) return;
  state.isProcessing = true;
  setError();
  els.processButton.disabled = true;
  try {
    state.handwritingUnavailable = false;
    state.handwritingMessage = "";
    state.extractionScale = chooseExtractionScale(Number(navigator.deviceMemory) || 4);
    state.referenceCanvases.clear();
    state.batch.school = els.schoolInput.value.trim();
    state.batch.visitDate = els.visitDateInput.value;
    updateProgress(2, "Loading PDF in your browser…");
    const requestedPagesPerSurvey = Number(els.pagesPerSurvey.value);
    state.pdfs.clear();
    const sources = [];
    for (let fileIndex = 0; fileIndex < state.files.length; fileIndex += 1) {
      const file = state.files[fileIndex];
      updateProgress(3 + (fileIndex / state.files.length) * 7, `Loading ${file.name}…`);
      const data = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data }).promise;
      const pagesPerSurvey = resolveSourcePagesPerSurvey(pdf.numPages, requestedPagesPerSurvey);
      if (!pagesPerSurvey) {
        throw new Error(`${file.name} has ${pdf.numPages} pages. Every file must contain complete groups of 6 pages per student, or 5 pages for the older format.`);
      }
      state.pdfs.set(file.name, pdf);
      sources.push({ file, pdf, pagesPerSurvey, surveyCount: pdf.numPages / pagesPerSurvey });
    }
    const totalSurveyCount = sources.reduce((sum, source) => sum + source.surveyCount, 0);
    const ignoredCount = sources.filter(source => source.pagesPerSurvey === 6).reduce((sum, source) => sum + source.surveyCount, 0);
    const ignoredNote = ignoredCount ? ` ${ignoredCount} blank sixth page${ignoredCount === 1 ? "" : "s"} will be ignored.` : "";
    updateProgress(10, `${totalSurveyCount} surveys detected across ${sources.length} PDF file${sources.length === 1 ? "" : "s"}.${ignoredNote}`);
    state.surveys = [];
    let globalIndex = 0;
    for (const source of sources) {
      for (let localIndex = 0; localIndex < source.surveyCount; localIndex += 1) {
        state.surveys.push(await extractSurvey({
          pdf: source.pdf,
          file: source.file,
          localIndex,
          globalIndex,
          sourcePagesPerSurvey: source.pagesPerSurvey,
          totalSurveyCount
        }));
        globalIndex += 1;
      }
    }
    saveSession();
    updateProgress(96, "Building the review workspace…");
    state.selectedSurvey = 0;
    state.selectedPage = 1;
    state.activeQuestion = null;
    els.workspace.hidden = false;
    renderAll();
    await renderReviewPage();
    const reorderedCount = state.surveys.filter(survey => survey.pagesReordered).length;
    const handwritingCount = state.surveys.filter(survey => survey.handwritingStatus === "completed").length;
    const handwritingNote = handwritingCount
      ? ` Handwriting was read for ${handwritingCount} student survey${handwritingCount === 1 ? "" : "s"}.`
      : state.handwritingMessage ? ` ${state.handwritingMessage} Handwritten fields remain editable.` : "";
    updateProgress(100, `Combined extraction complete for ${state.surveys.length} student surveys from ${sources.length} PDF file${sources.length === 1 ? "" : "s"} at up to ${Math.round(state.extractionScale * 72)} DPI.${reorderedCount ? ` Corrected page order for ${reorderedCount} student survey${reorderedCount === 1 ? "" : "s"}.` : ""}${handwritingNote} The Excel charts use the combined total. Review uncertain answers before downloading the report.`);
    document.querySelector("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    console.error(error);
    setError(error instanceof Error ? error.message : "The PDF could not be processed.");
    els.progress.hidden = true;
  } finally {
    state.isProcessing = false;
    els.processButton.disabled = false;
  }
}

function surveyBadge(survey) {
  if (survey.status === "reviewed") return ["Ready", "ready"];
  return ["Review", ""];
}

function renderSurveyList() {
  els.surveyList.replaceChildren();
  state.surveys.forEach((survey, index) => {
    const [label, badgeClass] = surveyBadge(survey);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `survey-button${index === state.selectedSurvey ? " is-active" : ""}`;
    button.innerHTML = `
      <span class="survey-number">${survey.surveyIndex}</span>
      <span class="survey-label"><strong>${escapeHtml(valueFor(survey, "STUDENT_NAME") || `Student ${survey.surveyIndex}`)}</strong><small>${survey.warnings.length} warning${survey.warnings.length === 1 ? "" : "s"}</small></span>
      <span class="badge ${badgeClass}">${label}</span>`;
    button.addEventListener("click", async () => {
      state.selectedSurvey = index;
      state.selectedPage = 1;
      state.activeQuestion = null;
      renderAll();
      await renderReviewPage();
    });
    els.surveyList.append(button);
  });
}

function currentSurvey() {
  return state.surveys[state.selectedSurvey];
}

function renderPageTabs() {
  els.pageTabs.replaceChildren();
  for (let page = 1; page <= state.template.pagesPerSurvey; page += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-tab";
    button.role = "tab";
    button.setAttribute("aria-selected", page === state.selectedPage ? "true" : "false");
    button.textContent = ["Before 1", "Before 2", "After 1", "After 2", "Feedback"][page - 1];
    button.addEventListener("click", async () => {
      state.selectedPage = page;
      state.activeQuestion = null;
      renderPageTabs();
      renderStatus();
      await renderReviewPage();
    });
    els.pageTabs.append(button);
  }
}

async function renderReviewPage() {
  if (!currentSurvey()) return;
  const pdf = state.pdfs.get(currentSurvey().sourceFile);
  if (!pdf) {
    els.reviewCanvas.hidden = true;
    els.answerOverlay.hidden = true;
    els.reviewNotice.hidden = false;
    return;
  }
  els.reviewCanvas.hidden = false;
  els.answerOverlay.hidden = false;
  els.reviewNotice.hidden = true;
  const pageNumber = currentSurvey().pageMap?.[state.selectedPage] || currentSurvey().pageStart + state.selectedPage - 1;
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = els.reviewCanvas;
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport }).promise;
  renderOverlay();
}

function renderOverlay() {
  els.answerOverlay.replaceChildren();
  const survey = currentSurvey();
  if (!survey) return;
  const questions = state.template.questions.filter(question => question.page === state.selectedPage && question.options);
  const alignment = survey.pageAlignments?.[state.selectedPage];
  for (const question of questions) {
    if (state.activeQuestion && question.key !== state.activeQuestion) continue;
    const selectedValues = Array.isArray(survey.answers[question.key]?.value)
      ? survey.answers[question.key].value
      : [survey.answers[question.key]?.value];
    for (const option of question.options) {
      const sourceBox = option.scanBox || option.box;
      const [x0, y0, x1, y1] = sourceBox;
      const mapper = option.scanBox ? mapScanPoint : (x, y, currentAlignment) => mapTemplatePoint(x, y, state.selectedPage, currentAlignment);
      const [baseX0, baseY0] = alignment
        ? mapper(x0, y0, alignment)
        : [x0, y0];
      const [baseX1, baseY1] = alignment
        ? mapper(x1, y1, alignment)
        : [x1, y1];
      const column = checkboxColumn(option, state.template);
      const [offsetX, offsetY] = alignment?.checkboxOffsets?.[column] || [0, 0];
      const mappedX0 = baseX0 + offsetX;
      const mappedY0 = baseY0 + offsetY;
      const mappedX1 = baseX1 + offsetX;
      const mappedY1 = baseY1 + offsetY;
      const sourceWidth = alignment?.width || state.template.pageWidth;
      const sourceHeight = alignment?.height || state.template.pageHeight;
      const box = document.createElement("span");
      box.className = `answer-box${selectedValues.includes(option.value) ? " is-selected" : ""}`;
      box.style.left = `${(mappedX0 / sourceWidth) * 100}%`;
      box.style.top = `${(mappedY0 / sourceHeight) * 100}%`;
      box.style.width = `${((mappedX1 - mappedX0) / sourceWidth) * 100}%`;
      box.style.height = `${((mappedY1 - mappedY0) / sourceHeight) * 100}%`;
      els.answerOverlay.append(box);
    }
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderQuestion(question, survey) {
  const answer = survey.answers[question.key];
  const card = document.createElement("section");
  card.className = "question-card";
  card.dataset.section = question.section;
  let confidence = answer.confidence === null
    ? "Manual entry"
    : `${Math.round(answer.confidence * 100)}% confidence`;
  if (answer.source === "trocr") confidence = "Local TrOCR · verify";
  card.innerHTML = `<div class="question-heading"><strong>${escapeHtml(question.key)} · ${escapeHtml(question.title)}</strong><span class="confidence">${confidence}</span></div>`;
  card.addEventListener("click", async event => {
    if (event.target.closest("input, textarea, button")) return;
    state.activeQuestion = question.key;
    if (state.selectedPage !== question.page) {
      state.selectedPage = question.page;
      renderPageTabs();
      await renderReviewPage();
    } else {
      renderOverlay();
    }
  });

  if (["text", "paragraph"].includes(question.type)) {
    const field = document.createElement(question.type === "paragraph" ? "textarea" : "input");
    if (question.type === "paragraph") field.className = "text-answer";
    else field.type = "text";
    if (question.key === "STUDENT_NAME") field.maxLength = 20;
    field.value = answer.value || "";
    field.setAttribute("aria-label", question.title);
    field.addEventListener("input", () => updateAnswer(question, field.value));
    field.addEventListener("focus", () => focusQuestion(question));
    card.append(field);
    if (question.key === "STUDENT_NAME") {
      const confirmation = document.createElement("div");
      confirmation.className = "name-confirmation";
      const hint = document.createElement("span");
      hint.textContent = answer.nameConfirmed
        ? "Confirmed against the scanned form."
        : "Check the scan, then confirm this name (maximum 20 characters).";
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "button";
      confirmButton.disabled = !String(answer.value || "").trim() || answer.nameConfirmed === true;
      confirmButton.textContent = answer.nameConfirmed ? "Name confirmed" : "Confirm student name";
      confirmButton.addEventListener("click", () => {
        answer.nameConfirmed = true;
        answer.flagged = false;
        answer.source = "confirmed";
        answer.confidence = null;
        survey.warnings = validateSurvey(survey);
        saveSession();
        renderAll();
        showToast(`Student name confirmed for survey ${survey.surveyIndex}.`);
      });
      confirmation.append(hint, confirmButton);
      card.append(confirmation);
    }
  } else {
    const choices = document.createElement("div");
    choices.className = "choice-list";
    for (const option of question.options) {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = question.type === "multi" ? "checkbox" : "radio";
      input.name = `survey-${survey.id}-${question.key}`;
      input.value = option.value;
      input.checked = question.type === "multi" ? answer.value.includes(option.value) : answer.value === option.value;
      input.addEventListener("change", () => {
        if (question.type === "multi") {
          const values = [...choices.querySelectorAll("input:checked")].map(item => item.value);
          updateAnswer(question, values);
        } else {
          updateAnswer(question, option.value);
        }
      });
      input.addEventListener("focus", () => focusQuestion(question));
      label.append(input, Object.assign(document.createElement("span"), { textContent: option.value }));
      choices.append(label);
    }
    card.append(choices);
    if (question.type === "single") {
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "clear-answer";
      clearButton.textContent = "Clear selection";
      clearButton.addEventListener("click", () => {
        choices.querySelectorAll("input").forEach(input => { input.checked = false; });
        updateAnswer(question, "");
      });
      card.append(clearButton);
    }
  }

  const relevantWarnings = survey.warnings.filter(warning => warning.startsWith(`${question.key}:`) || warning.startsWith(`${question.key} `));
  if (relevantWarnings.length) {
    const warning = document.createElement("p");
    warning.className = "question-warning";
    warning.textContent = relevantWarnings.join(" · ");
    card.append(warning);
  }
  return card;
}

async function focusQuestion(question) {
  state.activeQuestion = question.key;
  if (state.selectedPage !== question.page) {
    state.selectedPage = question.page;
    renderPageTabs();
    await renderReviewPage();
  } else {
    renderOverlay();
  }
}

function updateAnswer(question, value) {
  const survey = currentSurvey();
  const answer = survey.answers[question.key];
  answer.value = question.key === "STUDENT_NAME"
    ? Array.from(String(value ?? "")).slice(0, 20).join("")
    : value;
  if (question.key === "STUDENT_NAME") answer.nameConfirmed = false;
  answer.conflicts = [];
  answer.flagged = false;
  answer.source = "manual";
  answer.confidence = null;
  answer.manuallyCorrected = true;
  answer.calibrationSignature = null;
  if (survey.status === "reviewed") survey.status = "needs_review";
  survey.warnings = validateSurvey(survey);
  renderOverlay();
  renderSurveyList();
  renderMetrics();
  renderCharts();
  renderStatus();
  saveSession();
}

function renderAnswerForm() {
  const survey = currentSurvey();
  els.answerForm.replaceChildren();
  if (!survey) return;
  const filter = els.sectionFilter.value;
  for (const question of state.template.questions) {
    if (filter !== "all" && question.section !== filter) continue;
    els.answerForm.append(renderQuestion(question, survey));
  }
}

function renderStatus() {
  const survey = currentSurvey();
  if (!survey) return;
  const [label] = surveyBadge(survey);
  const pageMatch = survey.pageTemplateMatches?.[state.selectedPage];
  const templateLabel = pageMatch
    ? ` · ${pageMatch.matched ? "template matched" : "template check required"}`
    : "";
  els.reviewKicker.textContent = `Survey ${survey.surveyIndex} · ${survey.sourceFile} · Pages ${survey.pageStart}-${survey.pageEnd}`;
  const handwritingLabel = survey.handwritingStatus === "completed"
    ? " · local handwriting detected"
    : "";
  els.reviewStatus.textContent = `${label} · ${survey.warnings.length} warning${survey.warnings.length === 1 ? "" : "s"}${templateLabel}${handwritingLabel}`;
  els.approveButton.innerHTML = `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z"/><path d="m8 12 2.5 2.5L16 9"/></svg>${survey.status === "reviewed" ? "Reviewed" : "Mark reviewed"}`;
}

function renderMetrics() {
  const counts = state.surveys.reduce((result, survey) => {
    result[survey.status] = (result[survey.status] || 0) + 1;
    return result;
  }, {});
  els.metricSurveys.textContent = state.surveys.length;
  els.metricReady.textContent = counts.reviewed || 0;
  els.metricReview.textContent = counts.needs_review || 0;
}

function chartColors(definition, count) {
  return Array.from({ length: count }, (_, index) => definition.colors[index % definition.colors.length]);
}

function makeChart(definition) {
  const chart = document.createElement("article");
  chart.className = `chart chart-${definition.kind}`;
  const kicker = document.createElement("p");
  kicker.className = "chart-kicker";
  kicker.textContent = `${definition.number}. ${definition.section}`;
  const heading = document.createElement("h3");
  heading.textContent = definition.title;
  chart.append(kicker, heading);
  return chart;
}

function appendLegend(chart, categories, colors) {
  const legend = document.createElement("div");
  legend.className = "report-legend";
  categories.forEach((category, index) => {
    const item = document.createElement("span");
    item.innerHTML = `<i class="legend-swatch" style="background:${colors[index]}"></i>${escapeHtml(category)}`;
    legend.append(item);
  });
  chart.append(legend);
}

function renderStackedComparison(definition, data) {
  const chart = makeChart(definition);
  const rows = [data.valuesA, data.valuesB];
  const colors = chartColors(definition, data.categories.length);
  const totals = rows.map(values => values.reduce((sum, value) => sum + value, 0));
  const maximum = Math.max(...totals, 1);
  appendLegend(chart, data.categories, colors);
  if (!totals.some(Boolean)) {
    chart.append(Object.assign(document.createElement("p"), { className: "chart-empty", textContent: "No values yet." }));
    return chart;
  }
  const plot = document.createElement("div");
  plot.className = "stacked-plot";
  rows.forEach((values, rowIndex) => {
    const row = document.createElement("div");
    row.className = "stacked-row";
    const label = Object.assign(document.createElement("strong"), { textContent: rowIndex === 0 ? "Before" : "After" });
    const track = document.createElement("span");
    track.className = "stacked-track";
    values.forEach((value, index) => {
      if (!value) return;
      const segment = document.createElement("span");
      segment.className = "stacked-segment";
      segment.style.width = `${(value / maximum) * 100}%`;
      segment.style.background = colors[index];
      segment.title = `${data.categories[index]}: ${value}`;
      track.append(segment);
    });
    const total = Object.assign(document.createElement("span"), { className: "stacked-total", textContent: totals[rowIndex] });
    row.append(label, track, total);
    plot.append(row);
  });
  chart.append(plot);
  return chart;
}

function renderPieChart(definition, data) {
  const chart = makeChart(definition);
  const values = data.values;
  const colors = chartColors(definition, data.categories.length);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) {
    chart.append(Object.assign(document.createElement("p"), { className: "chart-empty", textContent: "No values yet." }));
    return chart;
  }
  let cursor = 0;
  const stops = [];
  values.forEach((value, index) => {
    if (!value) return;
    const start = (cursor / total) * 100;
    cursor += value;
    const end = (cursor / total) * 100;
    stops.push(`${colors[index]} ${start}% ${end}%`);
  });

  const layout = document.createElement("div");
  layout.className = "pie-layout";
  const pie = document.createElement("div");
  pie.className = "pie-visual";
  pie.style.background = `conic-gradient(${stops.join(",")})`;
  pie.setAttribute("role", "img");
  pie.setAttribute("aria-label", `${definition.title}, ${total} responses`);

  const legend = document.createElement("div");
  legend.className = "pie-legend";
  values.forEach((value, index) => {
    if (!value) return;
    const item = document.createElement("div");
    const percentage = ((value / total) * 100).toFixed(1).replace(".0", "");
    item.innerHTML = `<i class="legend-swatch" style="background:${colors[index]}"></i><span>${escapeHtml(data.categories[index])}</span><strong>${value} · ${percentage}%</strong>`;
    legend.append(item);
  });
  layout.append(pie, legend);
  chart.append(layout);
  return chart;
}

function renderHorizontalBarChart(definition, data) {
  const chart = makeChart(definition);
  const maximum = Math.max(...data.values, 1);
  const plot = document.createElement("div");
  plot.className = "horizontal-bar-plot";
  data.categories.forEach((category, index) => {
    const row = document.createElement("div");
    row.className = "horizontal-bar-row";
    row.innerHTML = `<span>${escapeHtml(category)}</span><span class="horizontal-bar-track"><i style="width:${(data.values[index] / maximum) * 100}%;background:${definition.colors[0]}"></i></span><strong>${data.values[index]}</strong>`;
    plot.append(row);
  });
  chart.append(plot);
  return chart;
}

function renderCharts() {
  const charts = REPORT_CHARTS.map(definition => {
    const data = resolveChartData(definition, state.surveys);
    if (definition.kind === "stacked") return renderStackedComparison(definition, data);
    if (definition.kind === "bar") return renderHorizontalBarChart(definition, data);
    return renderPieChart(definition, data);
  });
  els.chartGrid.replaceChildren(...charts);
}

function renderAll() {
  renderSurveyList();
  renderPageTabs();
  renderAnswerForm();
  renderStatus();
  renderMetrics();
  renderCharts();
}

function markReviewed() {
  const survey = currentSurvey();
  if (!survey) return;
  survey.warnings = validateSurvey(survey);
  if (survey.answers?.STUDENT_NAME?.nameConfirmed !== true) {
    window.alert("Confirm the student name against the scanned form before marking this survey as reviewed.");
    state.selectedPage = 1;
    els.sectionFilter.value = "all";
    renderAll();
    return;
  }
  const critical = survey.warnings.filter(warning => !warning.startsWith("Q8 should"));
  if (critical.length) {
    const proceed = window.confirm(`This survey still has ${critical.length} extraction warning${critical.length === 1 ? "" : "s"}. Mark it reviewed anyway?`);
    if (!proceed) return;
  }
  if (survey.status !== "reviewed") {
    for (const question of state.template.questions) {
      if (["text", "paragraph"].includes(question.type)) continue;
      const answer = survey.answers[question.key];
      if (!answer?.scores || !answer.manuallyCorrected) continue;
      const signature = JSON.stringify(answer.value);
      if (answer.calibrationSignature === signature) continue;
      state.calibrationProfile = recordCalibration(
        state.calibrationProfile,
        question.key,
        answer.scores,
        answer.value
      );
      answer.calibrationSignature = signature;
    }
  }
  survey.status = "reviewed";
  saveSession();
  renderAll();
  showToast(`Survey ${survey.surveyIndex} marked as reviewed.`);
}

function buildExportSurvey(survey) {
  return {
    id: survey.id,
    index: survey.surveyIndex,
    status: survey.status,
    sourceFile: survey.sourceFile,
    answers: Object.fromEntries(Object.entries(survey.answers).map(([key, answer]) => [key, answer.value]))
  };
}

function downloadBlob(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const string = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${string.replaceAll('"', '""')}"`;
}

function exportCsv() {
  if (!state.surveys.length) return;
  if (!confirmExportReadiness()) return;
  const keys = state.template.questions.map(question => question.key);
  const headers = ["survey_id", "survey_number", "status", "source_file", ...keys];
  const rows = state.surveys.map(survey => [
    survey.id,
    survey.surveyIndex,
    survey.status,
    survey.sourceFile,
    ...keys.map(key => survey.answers[key]?.value ?? "")
  ]);
  const csv = `\uFEFF${headers.map(csvCell).join(",")}\r\n${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadBlob(`u4b-survey-results-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv;charset=utf-8");
}

function exportJson() {
  if (!state.surveys.length || !confirmExportReadiness()) return;
  const payload = {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    template: { id: state.template.id, version: state.template.version },
    batch: state.batch,
    sourceFiles: [...new Set(state.surveys.map(survey => survey.sourceFile))],
    surveys: state.surveys.map(buildExportSurvey)
  };
  downloadBlob(`u4b-survey-results-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
}

async function exportXlsx() {
  if (!state.surveys.length) return;
  if (!confirmExportReadiness()) return;
  const originalContent = els.downloadXlsxButton.innerHTML;
  els.downloadXlsxButton.disabled = true;
  els.downloadXlsxButton.innerHTML = `<svg class="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4zM4 10h16M10 4v16"/><path d="m13 14 2 2 3-4"/></svg>Building Excel file…`;
  try {
    const workbook = await buildSurveyWorkbook({
      template: state.template,
      surveys: state.surveys,
      batch: state.batch
    });
    downloadBlob(
      `u4b-survey-results-${new Date().toISOString().slice(0, 10)}.xlsx`,
      workbook,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    showToast("Excel workbook downloaded with response data and all 16 report charts.");
  } catch (error) {
    console.error(error);
    showToast(error instanceof Error ? error.message : "Excel export failed.");
  } finally {
    els.downloadXlsxButton.disabled = false;
    els.downloadXlsxButton.innerHTML = originalContent;
  }
}

function confirmExportReadiness() {
  const unconfirmedNames = state.surveys.filter(survey => survey.answers?.STUDENT_NAME?.nameConfirmed !== true);
  if (unconfirmedNames.length) {
    window.alert(`${unconfirmedNames.length} survey${unconfirmedNames.length === 1 ? " has" : "s have"} an unconfirmed student name. Confirm every name against the scanned form before exporting.`);
    return false;
  }
  const unsafeTemplates = state.surveys.filter(survey => (
    survey.status !== "reviewed"
    && Object.values(survey.pageTemplateMatches || {}).some(match => !match.matched)
  ));
  if (unsafeTemplates.length) {
    window.alert(`${unsafeTemplates.length} survey${unsafeTemplates.length === 1 ? " has" : "s have"} an unreviewed page-template mismatch. Review its checkbox overlays and mark it reviewed before exporting.`);
    return false;
  }
  const pending = state.surveys.filter(survey => survey.status !== "reviewed").length;
  if (!pending) return true;
  return window.confirm(`${pending} survey${pending === 1 ? " has" : "s have"} not been marked reviewed. Export anyway?`);
}

async function init() {
  try {
    state.calibrationProfile = loadCalibration();
    state.template = await loadTemplate();
    state.referencePdf = await pdfjsLib.getDocument({ data: decodeBase64(REFERENCE_PDF_BASE64) }).promise;
    setupUploadEvents();
    els.processButton.addEventListener("click", processPdf);
    els.sectionFilter.addEventListener("change", renderAnswerForm);
    els.approveButton.addEventListener("click", markReviewed);
    els.downloadXlsxButton.addEventListener("click", exportXlsx);
    els.downloadCsvButton.addEventListener("click", exportCsv);
    els.downloadJsonButton.addEventListener("click", exportJson);
    els.clearDataButton.addEventListener("click", clearLocalData);
    restoreSession();
  } catch (error) {
    setError(error instanceof Error ? error.message : "Application initialization failed.");
  }
}

init();

export { csvCell, validateTemplate };
