# UAT Registration read-only smoke run

Run date: 2026-09-15. Environment: `https://uat.kenyahmis.org`. Browser: headless Chrome via Playwright. Latest result: 6 passed, 0 failed. The runs used the existing read-only UAT audit account; credentials remained outside Git. Trace, video, and screenshots were disabled. No patient search or registration submit was performed, and no patient event was written to the local tracker.

| Source key | Result | What was actually checked | Not covered |
| --- | --- | --- | --- |
| `03_Registration!R2` / TC041 | Passed | Logged in, clicked Registration in the home sidebar, reached `/openmrs/spa/home/registration`, and saw Client Registry verification. | No patient search or registry lookup. |
| `03_Registration!R15` / TC054 | Passed for scoped pre-submit check | On the separate `/openmrs/spa/patient-registration` form, blank First and Family Name fields were HTML-required and reported `valueMissing`. | Workbook Save click and validation-message assertions; no full required-field inventory. |
| `03_Registration!R23` / reused TC041 | Passed for scoped layout check | Basic Info, Contact Details, Demographics, and Next of Kin sections, plus Register patient and Cancel actions, were visible. | Workbook's Register Patient entry step, every field, and every mandatory indicator. |
| `03_Registration!R32` / reused TC054 | Passed for scoped pre-submit check in the second run | Male and Female radios could each be selected, with the other deselected. | Workbook's Other option, dropdown interaction, and saved selection. |
| `03_Registration!R33` / reused TC055 | Passed for scoped pre-submit check | County, Sub County, Ward, and Village inputs were visible. | Hierarchical location selection and values saved to a patient record. |
| `03_Registration!R36` / TC062 | Passed for scoped Cancel check | Synthetic unsaved form returned to the previous page; no patient-registration POST was observed after Cancel. | Workbook confirmation prompt and proof that no persisted draft exists. |

The Client Registry verification section is on the sidebar landing route, not the separate patient-entry form. A direct visit to the form should not be used as evidence for `R2`. Reused TC IDs are distinguished by source key. These results do not validate the disabled-by-default synthetic registration write test (`03_Registration!R20` / TC059).

Earlier batches passed three and then four checks. A draft six-case run had five passes and a test-assertion failure: Cancel returned to the previous Dashboard page while the test incorrectly expected Client Registry. The corrected previous-page assertion then passed in the six-case run. This was a test assumption, not evidence that Cancel failed. The 2025 workbook expects a confirmation prompt; none appeared in the read-only Cancel inspection, so `R36` remains partial pending product review.

Re-run only the read-only suite with:

```bash
KENYAEMR_PERF_ENV_FILE=/home/rajab/.config/kenyaemr/uat-perf.env \
npm run test:uat-registration-readonly
```
