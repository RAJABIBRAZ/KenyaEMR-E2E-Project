import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractPatientIdentity, extractPatientUuidFromUrl } from '../e2e/helpers/registration-identity.ts';

const uuid = '074e3e3b-bbfd-40b5-b235-5dd7822b8f6e';

test('selects UAT preferred identifier, not an optional secondary identifier', () => {
  assert.deepEqual(
    extractPatientIdentity({ uuid, identifiers: [
      { identifier: 'secondary-123', preferred: false },
      { identifier: 'UAT-123', preferred: true },
    ] }),
    { patientUuid: uuid, patientIdentifier: 'UAT-123' },
  );
});

test('accepts a single UAT identifier and nested patient response', () => {
  assert.deepEqual(
    extractPatientIdentity({ data: { patient: { uuid, identifiers: [{ identifier: 'UAT-456' }] } } }),
    { patientUuid: uuid, patientIdentifier: 'UAT-456' },
  );
});

test('does not invent an identifier from a UUID or ambiguous identifiers', () => {
  assert.deepEqual(extractPatientIdentity({ uuid }), { patientUuid: uuid, patientIdentifier: undefined });
  assert.deepEqual(
    extractPatientIdentity({ uuid, identifiers: [{ identifier: 'A' }, { identifier: 'B' }] }),
    { patientUuid: uuid, patientIdentifier: undefined },
  );
});

test('takes chart UUID only from the expected UAT origin', () => {
  assert.equal(
    extractPatientUuidFromUrl(`/openmrs/spa/patient/${uuid}/chart`, 'https://uat.kenyahmis.org'),
    uuid,
  );
  assert.equal(
    extractPatientUuidFromUrl(`https://example.com/openmrs/spa/patient/${uuid}/chart`, 'https://uat.kenyahmis.org'),
    undefined,
  );
  assert.equal(
    extractPatientUuidFromUrl(`/openmrs/spa/visit/${uuid}`, 'https://uat.kenyahmis.org'),
    undefined,
  );
});
