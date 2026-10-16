import test from "node:test";
import assert from "node:assert/strict";

import { REPORT_CHARTS, resolveChartData } from "../public/report-config.js";

function survey(answers) {
  return { answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { value }])) };
}

test("report configuration contains the required 16 charts in order", () => {
  assert.equal(REPORT_CHARTS.length, 16);
  assert.deepEqual(REPORT_CHARTS.map(chart => chart.number), Array.from({ length: 16 }, (_, index) => index + 1));
  assert.deepEqual(REPORT_CHARTS.map(chart => chart.id), [
    "gender", "age", "knowledge-before", "knowledge-change", "learning-themes",
    "unwanted-clothing", "disposal-reasons", "purchase-frequency", "environment-care",
    "recycling-importance", "emotions", "current-second-hand", "second-hand-frequency",
    "future-second-hand", "personal-impact", "sharing-learning"
  ]);
});

test("second-hand frequency only counts students who answered Yes to Q7", () => {
  const definition = REPORT_CHARTS.find(chart => chart.id === "second-hand-frequency");
  const data = resolveChartData(definition, [
    survey({ Q7: "Yes", Q8: "Weekly" }),
    survey({ Q7: "No", Q8: "Weekly" }),
    survey({ Q7: "Yes", Q8: "Every month" })
  ]);
  assert.equal(data.values[data.categories.indexOf("Weekly")], 1);
  assert.equal(data.values[data.categories.indexOf("Every month")], 1);
});

test("written learning may count in more than one theme", () => {
  const definition = REPORT_CHARTS.find(chart => chart.id === "learning-themes");
  const data = resolveChartData(definition, [survey({ Q11: "Recycle clothing to reduce waste and protect the environment." })]);
  assert.equal(data.values[0], 1);
  assert.equal(data.values[1], 1);
  assert.equal(data.values[2], 1);
});

test("Other is counted without reading its handwritten explanation", () => {
  const definition = REPORT_CHARTS.find(chart => chart.id === "disposal-reasons");
  const data = resolveChartData(definition, [survey({ Q5: ["Other"], Q5_OTHER: "Uniform policy" })]);
  assert.ok(data.categories.includes("Other"));
  assert.ok(!data.categories.some(category => category.includes("Uniform policy")));
  assert.equal(data.values[data.categories.indexOf("Other")], 1);
});

test("chart totals combine surveys from every uploaded source PDF", () => {
  const definition = REPORT_CHARTS.find(chart => chart.id === "knowledge-before");
  const first = survey({ Q1: "I know a little bit" });
  first.sourceFile = "scan-a.pdf";
  const second = survey({ Q1: "I know a little bit" });
  second.sourceFile = "scan-b.pdf";
  const data = resolveChartData(definition, [first, second]);
  assert.equal(data.values[data.categories.indexOf("I know a little bit")], 2);
});
