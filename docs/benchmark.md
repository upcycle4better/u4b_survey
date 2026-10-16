# Real scan benchmark notes

The production detector was designed around the 54-page scanner PDF (`20082026140709-0001.pdf`). That private scan is not distributed in this repository. When available for acceptance testing, it is expected to contain nine student groups of six source pages: five survey pages followed by one blank scanner page. Blank pages are therefore 6, 12, 18, 24, 30, 36, 42, 48 and 54.

Earlier manual testing identified two real-world cases that older builds handled poorly:

- Student 1 page 1 has approximately 8 degrees of form rotation. The previous detector searched only about ±1.25 degrees and used a shear-only correction. The production build now searches up to ±12 degrees and rotates both axes before local registration.
- Some pages have scanner/paper perspective distortion and non-uniform checkbox displacement. The production build now uses wider scale-aware grid alignment followed by checkbox/ruled-line anchors, RANSAC homography, and a plausibility check before accepting the transform.

The mark reader now normalizes page tone, uses several ink thresholds, compares against the blank reference, and flags very heavy/corrected marks. Contradictory single-choice marks remain blank for manual review instead of being guessed.

Automated tests cover wide rotation, perspective recovery, false-anchor rejection, page-tone calibration, six-page grouping, report logic, handwriting preprocessing and Excel generation. `npm run verify` must pass before deployment.

Handwriting remains probabilistic because the free local TrOCR model is interpreting unconstrained student handwriting. A timeout prevents model/network failure from blocking checkbox extraction; all handwriting stays editable in review.
