# UAT anonymous login smoke run

Run date: 2026-09-15. Target: `https://uat.kenyahmis.org/openmrs/spa/login`. Browser: headless system Chrome via Playwright. Four read-only workbook-linked cases ran; two passed and two failed. No account credentials were used, no records were searched or submitted, and screenshots, video, and traces were disabled.

| Case | Result | Observation |
| --- | --- | --- |
| TC001 / `01_Login!R2` | Failed | Main logo, footer brand images, username, password, and sign-in controls were visible. No visible Forgot Password link was found; the public login page exposed no links. |
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

TC001 is a specification-versus-deployment discrepancy. Confirm with the product owner whether a password-recovery link is required before adding one or changing the workbook assertion. Do not silently remove the assertion just to make the suite green.

The reviewed machine-readable results are in `docs/uat-login-smoke-results.csv`; the Playwright JSON is in the ignored `test-results/qa-smoke-results.json`. Reproduce with:

```bash
KENYAEMR_URL=https://uat.kenyahmis.org/openmrs/spa/login npm run test:qa-smoke
```
