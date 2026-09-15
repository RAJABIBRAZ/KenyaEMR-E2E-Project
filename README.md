# TaifaCare E2E and optimization project

This is the standalone working directory for the KenyaEMR/TaifaCare performance audits, QA browser measurements, and test-case automation planning. The audits describe findings and candidates; they are not proof that a code hotspot or memory leak has been fixed.

## What is here

- `docs/*performance-audit.csv` and `docs/performance-audit.md`: static audits of the frontend and related modules.
- `docs/qa-frontend-runtime-performance-audit.csv`: reviewed live QA findings from the Playwright run.
- `e2e/performance/qa-performance.spec.ts`: read-only browser audit for login, dashboard, resource transfer, Web Vitals, and route lifecycle memory.
- `e2e/cases/login-smoke.spec.ts`: first four read-only workbook-linked checks for login layout, viewport fit, empty-form validation, and password masking. With password recovery excluded from TC001, the latest UAT run had three passes and one failure; TC001 is partial coverage.
- `docs/taifacare-test-case-coverage.csv`, `docs/taifacare-proposed-edge-cases.csv`, and `docs/taifacare-test-coverage-and-edge-cases.xlsx`: inventory of the supplied workbook and proposed edge cases. These are planning outputs, not executed test results.
- `docs/qa-automation-progress.csv`: implementation overlay for the workbook inventory; it does not imply a case was executed or passed.
- `docs/uat-login-smoke-results.csv` and `docs/uat-login-smoke-audit.md`: reviewed UAT results for the first four cases.
- `docs/archive/`: preserved full-workbook login results from before password recovery was excluded.
- `docs/uat-frontend-runtime-performance-audit.csv`, `docs/uat-route-memory-checkpoints.csv`, and `docs/uat-performance-run.md`: authenticated UAT frontend findings and an Excel-ready ten-cycle memory table.
- `tools/generate-taifacare-test-coverage.py`: repeatable workbook inventory generator.
- `tools/uat_patient_tracker.py` and `e2e/helpers/uat-patient-tracker.ts`: local-only audit trail for identifiers assigned by UAT to synthetic patients.

The supplied source workbook is kept at `docs/TaifaCare_Complete_Test_Cases_299_20251111.xlsx` and ignored by Git. The unrelated requirements PDF from the previous workspace was not moved here.

## Run the QA performance check

Requires Node.js, Chrome or Chromium, and a dedicated QA account. Do not commit credentials or run the current account against clinical/financial write scenarios.

```bash
npm install
npm run test:qa-performance
```

The audit reads `/tmp/kenyaemr-perf.env` by default. Set `KENYAEMR_PERF_ENV_FILE` to use another absolute-path credential file. The default Chrome executable is `/usr/bin/google-chrome`; override with `QA_CHROME_EXECUTABLE_PATH` if needed. See `docs/qa-playwright-performance-audit.md` for all runtime options and output interpretation.

The test has screenshots, video, and traces disabled. Raw JSON/CSV results are generated under ignored `test-results/`; the HTML report goes under ignored `playwright-report/`. Reviewed findings are in `docs/qa-frontend-runtime-performance-audit.csv`.

## Run the first anonymous login smoke tests

These tests need the QA base URL but no account credentials. They do not submit records, search for patients, or make invalid-login attempts.

```bash
KENYAEMR_URL=https://uat.kenyahmis.org/openmrs/spa/login npm run test:qa-smoke
```

The current TC001 check covers visible login controls and branding but excludes password recovery at the user's request. The original workbook still includes that step, so TC001 is reported as passed for the current scope only. TC002 tests desktop and mobile viewport fit; UAT had 48 px vertical overflow at all three sizes. TC006 relies on native required-field validation. The earlier temporary QA credential file is no longer present, so a future run against that separate QA environment needs its own QA-only file.

## Authenticated UAT dashboard and memory audit

The UAT test credentials are kept in `/home/rajab/.config/kenyaemr/uat-perf.env` outside this directory. Use the dedicated UAT configurations so earlier QA reports are not overwritten:

```bash
KENYAEMR_PERF_ENV_FILE=/home/rajab/.config/kenyaemr/uat-perf.env \
KENYAEMR_PERF_ENVIRONMENT=UAT \
npm run test:uat-performance

KENYAEMR_PERF_ENV_FILE=/home/rajab/.config/kenyaemr/uat-perf.env \
KENYAEMR_PERF_ENVIRONMENT=UAT \
QA_PERF_ROUTE_CYCLES=10 \
npm run test:uat-performance:long
```

The ten-cycle run reproduced linear DOM and listener retention. The audit process may still exit successfully because its strict leak budget is opt-in; consult `docs/uat-performance-run.md` and the reviewed CSV before interpreting the result. This is browser JavaScript/DOM auditing, not server Java heap profiling.

## Rebuild the test-case inventory

Requires Python 3 and `openpyxl`:

```bash
python3 tools/generate-taifacare-test-coverage.py docs/TaifaCare_Complete_Test_Cases_299_20251111.xlsx
```

The generator writes the inventory CSV and combined workbook to `docs/`. Existing edge-case proposals are preserved. For safety and coverage caveats, see `docs/taifacare-test-automation-plan.md`.

## Track UAT-assigned synthetic patient IDs

The tracker records identifiers and optional UUIDs after UAT assigns them; it does not allocate PIDs, create patients, or access the database. The append-only JSONL and Excel-ready CSV export live in ignored `tracker-data/`, so runtime identifiers do not enter Git. Start one run ID for the whole Playwright execution, then call the helper only from authorized synthetic-patient tests:

```bash
export QA_E2E_RUN_ID=$(npm run -s tracker:run-id)
npm run tracker:export
npm run tracker:test
```

See `docs/uat-patient-tracker.md` for the schema, helper example, parallel-worker scope, and safety rules. No patient-creation tests are enabled by this tracker alone.

## Where the login-background optimization lives

The deployed asset switch from `login-background_ksm.svg` to `login-background_en.png` remains in the `openmrs-config-kenyaemr` repository. Commit `ea34f8bf` (`perf: optimize login background asset`) changed `frontend-config/dev/kenyaemr.config.json` and `dha_build.sh`; its configuration should stay in that deployment repository. The browser audit confirms the optimized PNG is delivered and records the remaining login badge 404 separately.

This directory is the place to document, reproduce, and extend optimization and E2E work; it does not duplicate or replace the deployed config repository.
