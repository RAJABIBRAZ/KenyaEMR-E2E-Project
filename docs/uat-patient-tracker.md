# UAT synthetic-patient ID tracker

This tracker is an audit log, not an ID generator. UAT assigns the actual patient identifier; an authorized registration or fixture check records that identifier afterward. No database connection, PID reservation, patient creation, or UAT write is implemented here. The supplied synthetic-data blueprint proposes database-backed sequential `QAE2E-000001` identifiers, but that part is intentionally not adopted because the current workflow has no database writer and the chosen requirement is to record UAT-generated IDs.

## Files and privacy

- `tracker-data/uat-patient-events.jsonl` is the append-only local record.
- `tracker-data/uat-patient-events.csv` is a regenerated Excel-ready export.
- Both files are ignored by Git and created with owner-only permissions (`0600`).
- The tracker accepts only identifier, optional UUID, synthetic fixture key, status, and run/test metadata. Do not put names, phone numbers, national IDs, clinical data, credentials, URLs, or raw error messages in it.
- The `fixture_key` must begin `QAE2E-` to mark synthetic automation data. The actual UAT `patient_identifier` is recorded exactly as UAT supplied it; it is not required to have the `QAE2E` prefix.

Do not move the runtime tracker into `docs/` or commit it. If a team-wide audit trail is required, use an approved secure shared store later; separate local clones do not automatically aggregate records.

## One run ID per execution

Generate a run ID once before the Playwright command and pass it to all workers through the environment:

```bash
export QA_E2E_RUN_ID=$(npm run -s tracker:run-id)
```

The format is `E2E-YYYYMMDD-HHMMSS-<random>`. The helper refuses to record if no run ID is supplied. To place the local tracker outside this repo, set `QA_PATIENT_TRACKER_PATH` to an absolute JSONL path; CSV export will be next to it.

## Recording from a future authorized Playwright test

Import the helper from a spec under `e2e/cases/`:

```ts
import { recordUatPatientEvent } from '../helpers/uat-patient-tracker';

// Only after the UAT UI has confirmed creation and displayed/returned its ID:
await recordUatPatientEvent({
  status: 'CREATED',
  fixtureKey: 'QAE2E-REG-SMOKE-001',
  module: 'Registration',
  testName: 'Register synthetic patient',
  sourceKey: '03_Registration!R2',
  patientIdentifier: actualIdentifierFromUat,
  patientUuid: patientUuidFromUat, // optional if not yet available
});
```

`CREATED` means the current run created a synthetic patient and UAT supplied an identifier. `OBSERVED` means an already-existing synthetic fixture was seen, or a later check supplied its UUID. `FAILED` records an attempted synthetic registration with a short uppercase `failureCode`; it may have no identifier if UAT never assigned one. Do not send a raw exception or page content. Each call appends an event; the CSV is an event history, not a deduplicated current-patient table.

The helper does not prove that a patient is synthetic merely because a caller supplied a `QAE2E-` fixture key. Registration and fixture tests must independently verify they are acting on an approved synthetic record and authorized QA environment. The existing UAT account was supplied for read-only performance auditing; this tracker does not authorize clinical or registration writes.

## Export and verification

```bash
npm run tracker:export
npm run tracker:test
```

The export regenerates `tracker-data/uat-patient-events.csv` from JSONL, including a header when the tracker is empty. Formula-like cell values are prefixed for safer opening in spreadsheet software; the JSONL preserves the exact UAT identifier. The tests use temporary synthetic values and do not contact UAT.

Append and export use local file locks, so multiple Playwright worker processes on the same Linux machine can record without interleaving JSONL lines. This is not a globally shared tracker for different hosts, and it does not guarantee UAT ID uniqueness; UAT remains the identifier authority.
