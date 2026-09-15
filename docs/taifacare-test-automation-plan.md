# TaifaCare test-case inventory and Playwright automation plan

The supplied workbook is a test specification, not an instruction to run every step against QA. The original file in Downloads was read only. The generated [coverage workbook](taifacare-test-coverage-and-edge-cases.xlsx) has three tabs: Summary, Source Case Inventory, and Proposed Edge Cases. The same inventory and new edge cases are available as CSV files.

## What was actually captured

| Workbook area | Populated case rows |
| --- | ---: |
| Login | 15 |
| Dashboard | 16 |
| Registration | 53 |
| Triage | 23 |
| Consultation | 34 |
| Patient Chart | 30 |
| Laboratory | 25 |
| Pharmacy | 30 |
| Admissions | 25 |
| MCH | 27 |
| Imaging | 15 |
| Procedures | 10 |
| Billing | 10 |
| Reports | 10 |
| System | 4 |
| Partograph | 189 |
| EHR Reports | 34 |
| HIV Reports | 63 |
| **Total** | **613** |

The filename says 299; the workbook Summary title says 481; Summary metadata says 595. None matches the 613 populated case rows. There are 577 distinct TC/FT IDs: 23 IDs are reused, accounting for 36 extra occurrences. Never use TC ID alone as an automation key; use the `Source Key` column (for example, `03_Registration!R2`).

Within the workbook's advertised `TC001`–`TC595` range, 27 numeric TC IDs have no populated row (including `TC516`–`TC531` and `TC595`), while nine rows use the separate `FT-` prefix. These are identifier gaps, not proof that the corresponding scenarios were never written elsewhere.

The `Workbook Test Status` field is blank on 579 rows and says `Not Tested` on 34 rows. `Workbook Dev Status` is a separate development field: 21 rows say `Completed`, 490 say `Pending`, and 102 are blank. Development completion is not test execution evidence.

## Baseline automation mapping at workbook import

This table describes the initial inventory classification, not the latest executable suite. For current implementation, execution, and scoped results, consult `qa-automation-progress.csv` and the UAT run notes. Generated `Not automated` rows below are not automatically promoted when a later spec is added.

| State | Rows | Meaning |
| --- | ---: | --- |
| Partial existing E2E mapping | 2 | Valid login (`01_Login!R4`) and logout (`15_System!R5`) resemble existing Playwright specs, but those specs have not been verified against the current QA UI or full workbook assertions. |
| Not automated | 611 | Catalogued and assigned a suggested spec path; no executable functional test has been created from the row. |
| Proposed new edge cases | 32 | Additional scenarios, not executed and not yet coded. |

The existing QA performance spec measures startup and route-memory behavior. It is not counted as functional test coverage for a workbook row merely because it visits the same page.

## Review required before automating

The inventory classifies scenarios conservatively from names and steps. It is a planning aid, not a guarantee of what a scenario will do:

| Classification | Rows | What it means |
| --- | ---: | --- |
| Read-only UI candidate | 29 | Likely suitable for early QA smoke checks after current UI assertions are confirmed. |
| Sensitive read-only candidate | 221 | Requires an authorized role and de-identified seeded data; no records should be written. |
| State change or side effect possible | 39 | Needs a synthetic fixture, cleanup, and workflow review. |
| High-impact write or side effect possible | 135 | Includes registration/clinical/financial/admin actions; explicit QA authority and isolated fixtures are needed. |
| Clinical-state change possible | 189 | All Partograph cases are held for clinical-rule review and a synthetic labor record. |

The classifier also flagged 143 rows whose expected results need a measurable assertion, 180 rows whose steps need more concrete UI actions or test data, and 104 existing negative/boundary candidates. Flags can overlap. These are heuristic counts; a human test owner should resolve false positives and confirm whether each proposed edge case already exists under another title.

The generated inventory intentionally does not copy source steps, descriptions, actual results, tester names, or full expected-result text into the repository. Use `Source Sheet` and `Source Row` to consult the original workbook when refining an automated test. This reduces the chance of bringing sensitive test data into Git.

## Suggested implementation order

1. Normalize duplicate IDs and replace broad or circular expected results with observable assertions. Agree which 2025 cases still match the 2026 QA application.
2. Build read-only login/dashboard/navigation and role-aware report smoke tests using dedicated QA accounts and de-identified fixtures. Run these without trace, video, or screenshots unless the dataset is cleared for recording.
3. Add isolated synthetic patient/visit fixtures and cleanup contracts. A disabled write-gated registration spec may be prepared earlier, but only then enable and run registration, triage, consultation, orders, dispensing, admission, billing, admin, and Partograph writes.
4. Add negative, boundary, retry/idempotency, concurrent-user, offline, and security cases from the edge register. Clinical thresholds, consent, financial rounding, and confidentiality expectations must come from signed-off local policy rather than assumptions in code.
5. Run the suite in bounded module batches and record `Implemented`, `Executed`, and `Passed/Failed` separately in the coverage matrix. A passing Playwright process should never silently promote unrelated rows to `Passed`.

## Rebuild the inventory

The import script is repeatable and accepts any local workbook path:

```bash
python3 tools/generate-taifacare-test-coverage.py \
  /home/rajab/Downloads/TaifaCare_Complete_Test_Cases_299_20251111.xlsx
```

It needs the local `openpyxl` package. It regenerates the metadata CSV and combined XLSX from the original workbook and `docs/taifacare-proposed-edge-cases.csv`. The source workbook remains unchanged.

## Required decision for write tests

Before enabling or running scenarios that create patients, visits, observations, orders, dispensing transactions, payments, user accounts, or role changes, confirm the QA-only synthetic data convention, test roles, rollback/cleanup process, and which side effects are authorized. The current temporary account was provided for a read-only frontend performance audit and should not be silently reused for workflow writes.
