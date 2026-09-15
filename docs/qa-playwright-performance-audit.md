# QA frontend Playwright performance audit

This audit measures the deployed KenyaEMR frontend in a Chromium browser. It covers the anonymous login bootstrap, authenticated dashboard startup, Web Vitals, failed requests, transferred bytes, main-thread metrics, and repeated SPA route lifecycle behavior.

The test visits only the login page, the dashboard, and an empty patient-registration page. It does not search for patients or submit clinical forms. Selecting a login location changes only the current browser session and does not save a default location.

## Files

- `playwright.qa.config.ts` isolates the QA audit from the normal E2E suite and its global setup.
- `e2e/performance/qa-performance.spec.ts` contains the audit.
- `docs/qa-frontend-runtime-performance-audit.csv` contains the reviewed findings from the latest run.

## Credentials

Keep the credentials outside the repository. The default file is `/tmp/kenyaemr-perf.env`:

```text
KENYAEMR_URL=https://qa.example.org/openmrs
KENYAEMR_USERNAME=qa-audit-user
KENYAEMR_PASSWORD=temporary-password
```

The parser also accepts the labelled format used during the original audit. Use a dedicated read-only QA account, set file permissions to `600`, and delete or rotate the credentials after testing.

To use a different credentials file, set `KENYAEMR_PERF_ENV_FILE` to its absolute path.

## Install and run

From the standalone `E2E_Optimization_Project` directory:

```bash
npm install
npm run test:qa-performance
```

The Playwright configuration uses `/usr/bin/google-chrome` by default. Override it when necessary:

```bash
QA_CHROME_EXECUTABLE_PATH=/path/to/chrome \
npm run test:qa-performance
```

## Runtime options

| Variable | Default | Purpose |
| --- | ---: | --- |
| `KENYAEMR_PERF_ENV_FILE` | `/tmp/kenyaemr-perf.env` | Credentials file outside Git |
| `QA_CHROME_EXECUTABLE_PATH` | `/usr/bin/google-chrome` | Installed Chrome binary |
| `QA_PERF_LOGIN_SETTLE_MS` | `8000` | Login-page sampling window |
| `QA_PERF_DASHBOARD_SETTLE_MS` | `15000` | Dashboard sampling window |
| `QA_PERF_ROUTE_SETTLE_MS` | `4000` | Wait after each SPA route change |
| `QA_PERF_ROUTE_CYCLES` | `4` | Dashboard and patient-registration round trips |
| `QA_PERF_ENFORCE_BUDGETS` | `false` | Fail the test when consistent DOM/listener retention is detected |

For a longer confirmation run:

```bash
QA_PERF_ROUTE_CYCLES=10 \
npm run test:qa-performance
```

Enable the current lifecycle assertion in CI only after accepting or fixing the baseline:

```bash
QA_PERF_ENFORCE_BUDGETS=true \
npm run test:qa-performance
```

## Outputs

Each run creates:

- `test-results/qa-performance/**/qa-performance-results.json`
- `test-results/qa-performance/**/qa-performance-results.csv`
- `playwright-report/qa-performance/index.html`

Open the HTML report with:

```bash
node_modules/.bin/playwright show-report playwright-report/qa-performance
```

The JSON and CSV contain paths and performance measurements only. Query strings, UUID-like URL segments, credentials, page text, screenshots, video, and traces are excluded. These output directories are ignored by the standalone project's `.gitignore`.

## Interpreting the memory test

The test forces Chromium garbage collection after every route checkpoint and records:

- `JSHeapUsedSize` and `JSHeapTotalSize`
- `Nodes`
- `JSEventListeners`
- `Documents` and `Frames`

A one-time increase after the first route visit can be normal module caching. Consistent increases at the same warmed route over multiple cycles indicate retained lifecycle state and should be investigated with before/after heap snapshots.

The latest two Playwright runs reproduced a leak candidate at every dashboard checkpoint: approximately 294 additional DOM nodes, 2,191 additional event listeners, and 0.4 MB additional forced-GC JavaScript heap per cycle. These measurements identify the dashboard/patient-registration route lifecycle as the reproduction path; they do not by themselves identify the exact component retaining the objects.

## Current frontend hotspots

- Dashboard LCP was approximately 3.4-4.5 seconds across the two Playwright runs.
- Dashboard CLS was approximately 0.656.
- The latest dashboard run recorded 18 long tasks, totaling about 1.87 seconds, with a longest task of 400 ms.
- The uncached dashboard loaded 188 resources and transferred approximately 3.24 MB.
- The login page still requests `/openmrs/spa/badge_ksm.png`, which returns HTTP 404.
- The optimized `/openmrs/spa/login-background_en.png` is deployed; the oversized login background finding remains resolved.

Use Chrome heap snapshots with a non-sensitive QA dataset to identify the retaining component. Prioritize `useEffect` cleanup, store subscriptions, window/document listeners, observers, timers, workspace registrations, and aborting in-flight requests in the home dashboard, patient-registration ESM, and shared shell extensions.
