# Authenticated UAT frontend performance run

Run date: 2026-09-15. Target: `uat.kenyahmis.org`. Browser: system Chrome 149 via Playwright with no network or CPU throttling. The audit signed in with a dedicated UAT test account and visited only the dashboard and an empty patient-registration route. It did not search for patients or submit clinical or financial records. Credentials stayed in `/home/rajab/.config/kenyaemr/uat-perf.env` outside the project with mode `600`; screenshots, video, and traces were disabled.

The first authenticated attempt stopped before entering credentials because the login form did not render within 30 seconds. A fresh public-browser check loaded the form, and a four-cycle retry and a separate ten-cycle run both completed. Treat that first timeout as a reliability candidate requiring reproduction, not a proven application defect.

## Main outcome

The ten-cycle UAT run reproduced linear DOM and listener retention at every warmed dashboard checkpoint:

| Metric | Cycle 1 | Cycle 10 | Change | Pattern |
| --- | ---: | ---: | ---: | --- |
| DOM nodes | 1,506 | 3,918 | +2,412 | Exactly +268 per cycle |
| Event listeners | 5,732 | 7,871 | +2,139 | Approximately +238 per cycle |
| Forced-GC JS heap | 26,082,044 B | 25,895,244 B | -186,800 B | Non-monotonic; cycle 3 to 10 rose by 1,790,408 B |

The four-cycle UAT run independently showed +268 nodes and +239 listeners per cycle. This is a strong browser-side DOM/listener leak candidate in the dashboard/patient-registration route lifecycle. It does not identify the retaining component. The forced-GC heap series does not prove or rule out retained JavaScript objects; a controlled heap-snapshot comparison is needed with de-identified QA data. This browser audit does not measure server-side Java heap or Java memory leaks.

Playwright reported the performance test as passed because the optional `QA_PERF_ENFORCE_BUDGETS` assertion was not enabled. A passed audit process means measurements completed; it does not mean the route lifecycle passed a no-leak acceptance criterion.

## Other measured hotspots

- Dashboard cold load: 205 completed requests and 2,821,004 transferred bytes; 151 scripts transferred 2,466,745 bytes (about 87.4% of all bytes).
- Login cold load: 55 requests and 1,320,093 transferred bytes; 35 scripts transferred 784,907 bytes. The largest login image was `kenya_republic_logo.png` at 171,516 transferred bytes.
- Login still requested `badge_ksm.png`, which returned HTTP 404. The optimized `login-background_en.png` returned HTTP 200 at 28,636 transferred bytes.
- Login CLS was 0.135 and dashboard CLS was 0.168. Dashboard LCP was 852 ms on this unthrottled fast setup; that timing should not be generalized to clinic devices.
- The anonymous login smoke audit separately found 48 px of vertical overflow at three viewport sizes; see `docs/uat-login-smoke-audit.md`.

The reviewed finding table is `docs/uat-frontend-runtime-performance-audit.csv`, and `docs/uat-route-memory-checkpoints.csv` is an Excel-ready ten-row checkpoint table. The authoritative ten-cycle raw JSON/CSV are under the ignored `test-results/uat-performance-10-cycle/` directory, with an HTML report under `playwright-report/uat-performance-10-cycle/`. The first four-cycle raw JSON uses the older hard-coded `environment: "QA"` field even though it was run against UAT; the reused spec was corrected before the ten-cycle run, whose JSON says `environment: "UAT"`.

## Reproduce without moving credentials into Git

```bash
KENYAEMR_PERF_ENV_FILE=/home/rajab/.config/kenyaemr/uat-perf.env \
KENYAEMR_PERF_ENVIRONMENT=UAT \
npm run test:uat-performance

KENYAEMR_PERF_ENV_FILE=/home/rajab/.config/kenyaemr/uat-perf.env \
KENYAEMR_PERF_ENVIRONMENT=UAT \
QA_PERF_ROUTE_CYCLES=10 \
npm run test:uat-performance:long
```

Before enforcing a CI leak budget, agree a warm-up point and acceptable plateau tolerance. For source diagnosis, prioritize dashboard and patient-registration ESM unmount cleanup plus shared shell subscriptions, listeners, observers, and timers. Avoid heap snapshots on live or identifiable records.
