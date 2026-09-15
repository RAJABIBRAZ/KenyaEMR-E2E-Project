# UAT Registration read-only smoke run

Run date: 2026-09-15. Environment: `https://uat.kenyahmis.org`. Browser: headless Chrome via Playwright. Result: 3 passed, 0 failed. The run used the existing read-only UAT audit account; credentials remained outside Git. Trace, video, and screenshots were disabled. No patient search or registration submit was performed, and no patient event was written to the local tracker.

| Source key | Result | What was actually checked | Not covered |
| --- | --- | --- | --- |
| `03_Registration!R2` / TC041 | Passed | Logged in, clicked Registration in the home sidebar, reached `/openmrs/spa/home/registration`, and saw Client Registry verification. | No patient search or registry lookup. |
| `03_Registration!R15` / TC054 | Passed for scoped pre-submit check | On the separate `/openmrs/spa/patient-registration` form, blank First and Family Name fields were HTML-required and reported `valueMissing`. | Workbook Save click and validation-message assertions; no full required-field inventory. |
| `03_Registration!R23` / reused TC041 | Passed for scoped layout check | Basic Info, Contact Details, Demographics, and Next of Kin sections, plus Register patient and Cancel actions, were visible. | Workbook's Register Patient entry step, every field, and every mandatory indicator. |

The Client Registry verification section is on the sidebar landing route, not the separate patient-entry form. A direct visit to the form should not be used as evidence for `R2`. Reused TC IDs are distinguished by source key. These results do not validate the disabled-by-default synthetic registration write test (`03_Registration!R20` / TC059).

Re-run only the read-only suite with:

```bash
KENYAEMR_PERF_ENV_FILE=/home/rajab/.config/kenyaemr/uat-perf.env \
npm run test:uat-registration-readonly
```
