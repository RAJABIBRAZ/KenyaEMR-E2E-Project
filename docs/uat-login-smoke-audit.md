# UAT anonymous login smoke run

Run date: 2026-09-15. Target: `https://uat.kenyahmis.org/openmrs/spa/login`. Browser: headless system Chrome via Playwright. With password recovery excluded from the current TC001 scope, four read-only checks ran; three passed and one failed. No account credentials were used, no records were searched or submitted, and screenshots, video, and traces were disabled.

| Case | Result | Observation |
| --- | --- | --- |
| TC001 / `01_Login!R2` | Passed (scoped) | Main logo, footer brand images, username, password, and sign-in controls were visible. Password recovery was not assessed in this run. |
| TC002 / `01_Login!R3` | Failed | The document required 48 px of vertical scrolling at all three tested sizes. Footer images were still within the viewport. |
| TC006 / `01_Login!R7` | Passed | Blank submit stayed on login; native required-field validation was present. |
| TC007 / `01_Login!R8` | Passed | A non-credential sentinel remained in an input with `type=password`. |

## Viewport evidence

| Viewport | Document height | Overflow |
| --- | ---: | ---: |
| 1366 × 768 | 816 px | 48 px |
| 1280 × 720 | 768 px | 48 px |
| 390 × 844 | 892 px | 48 px |

On desktop, the deployed background image's element began 48 px below the top of the viewport and ended 48 px below the bottom. This suggests an offset/full-height composition worth checking in the login layout CSS; it does not prove which rule is responsible. The footer brand images were visible without scrolling at all three sizes, so TC002 is a scrollbar/layout failure rather than evidence that the footer logos were hidden.

The original workbook TC001 includes a Forgot Password step. At the user's request, password recovery is excluded from the active login suite for now; the source workbook is unchanged. The TC001 pass is therefore partial coverage, not a full-workbook pass. The earlier full-scope results and report are preserved in `docs/archive/` and `test-results/archive/` for traceability.

The reviewed machine-readable results are in `docs/uat-login-smoke-results.csv`; the Playwright JSON is in the ignored `test-results/qa-smoke-results.json`. Reproduce with:

```bash
KENYAEMR_URL=https://uat.kenyahmis.org/openmrs/spa/login npm run test:qa-smoke
```
