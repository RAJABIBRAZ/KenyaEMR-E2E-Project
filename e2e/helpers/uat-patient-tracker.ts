import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export type UatPatientEventStatus = 'CREATED' | 'OBSERVED' | 'FAILED';

export type UatPatientEvent = {
  status: UatPatientEventStatus;
  fixtureKey: string;
  module: string;
  testName: string;
  runId?: string;
  sourceKey?: string;
  patientIdentifier?: string;
  patientUuid?: string;
  failureCode?: string;
};

// Playwright runs from the project root; avoiding import.meta keeps this helper
// compatible with the repository's CommonJS Playwright TypeScript loader.
const trackerScript = resolve(process.cwd(), 'tools/uat_patient_tracker.py');

/**
 * Record a synthetic patient's identifier only after UAT has assigned it.
 * This helper never reserves identifiers or sends data to UAT.
 */
export function recordUatPatientEvent(event: UatPatientEvent): Promise<string> {
  const runId = event.runId ?? process.env.QA_E2E_RUN_ID;
  if (!runId) {
    throw new Error('Set QA_E2E_RUN_ID once before the Playwright run, or pass runId.');
  }

  const payload = {
    status: event.status,
    fixture_key: event.fixtureKey,
    module: event.module,
    test_name: event.testName,
    run_id: runId,
    source_key: event.sourceKey ?? null,
    patient_identifier: event.patientIdentifier ?? null,
    patient_uuid: event.patientUuid ?? null,
    failure_code: event.failureCode ?? null,
  };

  return new Promise((resolve, reject) => {
    const python = process.env.QA_PYTHON_EXECUTABLE ?? 'python3';
    const child = spawn(python, [trackerScript, 'record'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    let eventId = '';
    let errorOutput = '';
    child.stdout.on('data', (chunk: Buffer) => {
      eventId += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errorOutput += chunk.toString('utf8').slice(0, 2048);
    });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('UAT patient tracker failed: ' + errorOutput.trim()));
        return;
      }
      resolve(eventId.trim());
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
