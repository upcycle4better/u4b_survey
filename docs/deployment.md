# Vercel deployment

## Before deployment

```bash
npm install
npm run verify
```

Commit every project file, including `public/report-config.js`, and push to the branch connected to Vercel.

## Vercel settings

- Framework Preset: Other
- Root Directory: repository root
- Build Command: leave empty
- Output Directory: leave empty
- Install Command: `npm install`
- Environment variables: none required

`vercel.json` routes the application to `public/index.html` and keeps module, worker, JSON and vendor asset paths available.

## Free handwriting recognition

Handwriting recognition runs in the browser and requires no Vercel environment variables. The first extraction downloads the free TrOCR model and caches it in the browser. Make sure the browser can access `cdn.jsdelivr.net` and `huggingface.co`.

## Verify after deployment

1. Confirm the latest Git commit appears in the Vercel deployment details.
2. Open the site and hard-refresh with `Ctrl+F5`.
3. Upload the supplied 54-page benchmark PDF (9 students × 6 source pages) or another complete 5/6-page batch.
4. Review at least one student and open the dashboard.
5. Confirm the dashboard lists 16 numbered charts.
6. Download Excel and confirm the sheets are `Responses`, `Chart Data` and `Visual Report`.
7. Confirm the first extraction shows the model download progress.
8. Confirm recognised handwritten fields display `Local TrOCR · verify` and remain editable.

If an older output still appears, confirm Vercel Root Directory is the repository root, redeploy the latest commit and hard-refresh. Vercel cannot deploy local files that were never committed and pushed to GitHub.
