export type PatientIdentity = {
  patientUuid?: string;
  patientIdentifier?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function patientObject(value: unknown): Record<string, unknown> | undefined {
  const root = object(value);
  if (!root) return undefined;
  return object(root.patient) ?? object(object(root.data)?.patient) ?? root;
}

/** Read only identifiers supplied by UAT; never generate or infer a PID. */
export function extractPatientIdentity(value: unknown): PatientIdentity {
  const patient = patientObject(value);
  if (!patient) return {};

  const patientUuid = cleanText(patient.uuid);
  const directIdentifier = cleanText(patient.patientIdentifier);
  const identifiers = Array.isArray(patient.identifiers)
    ? patient.identifiers
        .map(object)
        .filter((entry): entry is Record<string, unknown> => entry !== undefined)
        .filter((entry) => entry.voided !== true)
    : [];
  const preferred = identifiers.filter((entry) => entry.preferred === true).map((entry) => cleanText(entry.identifier));
  const candidate = preferred.length === 1 ? preferred[0] : identifiers.length === 1 ? cleanText(identifiers[0].identifier) : undefined;

  return {
    patientUuid: patientUuid && UUID.test(patientUuid) ? patientUuid : undefined,
    patientIdentifier: directIdentifier ?? candidate,
  };
}

/** A UUID in a UAT response location or chart route is a lookup key, not a patient identifier. */
export function extractPatientUuidFromUrl(rawUrl: string, expectedOrigin: string): string | undefined {
  try {
    const url = new URL(rawUrl, expectedOrigin);
    if (url.origin !== expectedOrigin || !url.pathname.toLowerCase().includes('/patient')) return undefined;
    return url.pathname.split('/').find((part) => UUID.test(part));
  } catch {
    return undefined;
  }
}
