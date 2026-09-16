# Registration workflow readiness

This is a source-keyed completion map for all 53 populated rows in the supplied `03_Registration` workbook sheet. It is not an assertion that every workflow is automated or has passed. Regenerate the Excel-ready [matrix](registration-workflow-readiness.csv) with `npm run registration:matrix`; the script copies only case IDs/titles and local automation metadata, not source steps, demographics, or credentials.

Rows `R39–R54` repeat the scenario definition, steps, and expected result of `R23–R38` respectively. The 53 source rows therefore describe 37 distinct scenario definitions. Both source keys remain in the matrix because TC IDs are reused and duplicate rows must not be silently marked passed. A test owner should confirm whether each repeat should share one automated execution.

| Workflow | Source rows | Distinct definitions | What blocks full execution |
| --- | ---: | ---: | --- |
| Sidebar/landing navigation | 1 | 1 | None for the existing read-only test. |
| National ID and Client Registry/HIE | 9 | 8 | Approved synthetic identity and de-identified HIE fixture; current UI confirmation; no real-person search. |
| OTP and dependent verification | 5 | 5 | Approved OTP sandbox/test channel, synthetic person/dependent, and consent; never send real messages. |
| Create, emergency, edit, or start visit | 16 | 11 | Explicit UAT write authority, dedicated account/location, synthetic fixture, and reconciliation/idempotency plan. |
| Patient form and validation | 22 | 12 | Some are pre-submit read-only; workbook Save/validation, saved addresses, and performance thresholds need approved execution context. |
| Total | 53 | 37 | |

Current evidence is deliberately narrow: `R2` passed in UAT exactly as written; `R15`, `R23`, `R32`, `R33`, and `R36` passed only scoped pre-submit checks. The write-gated `R20` test saved one authorized synthetic patient on 2026-09-15 and captured UAT's assigned ID locally; it is still only partial TC059 coverage. A guarded human-assisted principal-ID/OTP test now partially implements `R3`, `R4`, `R6`, `R8`, and `R9`. Its 2026-09-16 live attempts reached the ID-search result and an unidentified modal but did not complete verification; `R3`, `R4`, and `R6` have only scoped pre-OTP evidence. The other 41 source rows are not implemented; this count includes the 16 repeated source rows.

The separate proposed edge register adds four Registration cases outside the 53 workbook rows:

| Edge key | Scenario | Readiness |
| --- | --- | --- |
| `EDGE-007` | Concurrent submissions with one identifier | Needs synthetic write authority, controlled duplicate fixture, and cleanup/idempotency rules. |
| `EDGE-008` | OTP expiry and replay | Needs approved OTP test channel and signed-off expiry/replay policy. |
| `EDGE-009` | Save timeout followed by retry | Needs controlled response delay, write authority, and safe reconciliation; do not retry blindly. |
| `EDGE-010` | Leap-day/future-DOB boundaries | May be pre-submit read-only, but age/date policy and current UI behavior must be confirmed. |

The last read-only UAT inspection on 2026-09-15 showed two distinct routes: the home sidebar's `/openmrs/spa/home/registration` landing page contains Client Registry verification, while `/openmrs/spa/patient-registration` is the patient-entry form. The latter showed Male/Female radios and a `Register patient` submit action. Workbook `R32` expects a Male/Female/Other dropdown and saved selection, so the product owner should resolve that mismatch before a full-case assertion. The workbook's Save and Start Visit and emergency flows also need current-UI confirmation; they were not exercised in the read-only inspection.

To finish Registration E2E rather than merely its inventory, resolve these dependencies in order:

1. Confirm current UAT Registration read-only browser access and source-case acceptance, including whether duplicate rows share one execution.
2. Supply approved synthetic National ID/HIE/Client Registry records and an OTP test channel; do not use arbitrary 8-digit IDs that might belong to real people.
3. Explicitly authorize synthetic patient/visit writes in UAT using a separate write-enabled QA account and approved session location. Keep all credentials outside Git; use UAT-generated IDs in the ignored local tracker.
4. Agree cleanup or persistence, duplicate prevention, and unknown-save reconciliation before running creation/edit/emergency cases. Never blindly retry a save when the response was not observed.
5. Execute each distinct scenario, record the actual result against its source key, and obtain owner sign-off before propagating an execution result to a duplicate row.

The matrix generator itself performs no UAT action. The separately approved read-only Registration suite run on 2026-09-15 passed six checks; it did not search patients, send OTP, or submit registration. A later separately approved synthetic registration did submit one patient. On 2026-09-16 an interactive UAT inspection showed `Enter OTP` after principal-ID lookup and `Check In` plus `Show dependents` after the OTP dialog closed, matching the user's stated success criterion. The first live Playwright attempt then stopped before search on a UAT focus trap; a corrected second attempt completed lookup but stopped because an unidentified modal overlaid a background button. The test now checks for an open modal but has not been rerun since that correction. Neither the manual observation nor these attempts prove SMS delivery or a full automated pass. Workbook instructions are test specifications, not authorization for further UAT writes or external OTP/HIE actions.
