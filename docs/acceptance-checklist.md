# Acceptance checklist

Use this checklist after deployment and whenever scanner settings change.

1. Open `/api/health` and confirm it returns `ok: true`.
2. Upload one complete batch PDF, then repeat with two or more PDFs selected together. For the current benchmark, `24082026111218-0001.pdf` has 168 pages and uses six pages per student.
3. Confirm the 168-page file produces 28 student surveys and ignores every sixth page, ending with page 168. For multiple files, confirm the displayed total equals the sum of students in all selected PDFs.
4. Check that no warning says an ignored page contains substantial ink.
5. Confirm every populated page matches its Before 1, Before 2, After 1, After 2 or Feedback fingerprint. For every student, compare the blue checkbox overlays with the original scan before marking the survey reviewed.
6. Correct uncertain or conflicting answers manually. Only those corrections are used for future local calibration.
7. Confirm Q8 is blank when Q7 is `No`.
8. Compare the detected student name with the page image, correct it if necessary, and click **Confirm student name**. A missing or unconfirmed name must block review and export.
9. Confirm every survey is marked reviewed before export.
10. Download Excel and confirm the `Responses`, `Chart Data` and `Visual Report` sheets open, all 16 charts are present, and their counts use the combined responses from every uploaded PDF.
11. Refresh the browser and confirm the reviewed answers return. Select the same PDF file or files again to restore the page images without replacing saved corrections.

The exact scanned PDF is intentionally not committed to the repository because it contains student responses. It must be supplied separately for final scan-accuracy acceptance testing.
