// packages/edit/src/session/layout.ts
// canonical logical keys for one immutable edit-session artifact layout

const SAFE_COMPONENT = /^[a-z0-9][a-z0-9-]{0,127}$/u

export function assertEditLogicalComponent(value: string): string
{
  if (!SAFE_COMPONENT.test(value))
    throw new TypeError('edit artifact component is not host-safe')
  return value
}

function assertEditLogicalFilename(value: string): string
{
  if (!/^[a-z0-9][a-z0-9.-]{0,127}$/u.test(value) || value.includes('..'))
    throw new TypeError('edit artifact filename is not host-safe')
  return value
}

function revisionDirectory(revisionNumber: number, revisionId: string): string
{
  if (!Number.isSafeInteger(revisionNumber) || revisionNumber < 0)
    throw new TypeError('revision number must be a nonnegative safe integer')
  if (!/^[0-9a-f]{64}$/u.test(revisionId))
    throw new TypeError('revision ID must be SHA-256')
  return `revisions/${String(revisionNumber).padStart(6, '0')}-${revisionId}`
}

export interface EditSessionLayoutV1
{
  prefix: string
  session: string
  sourceInput: string
  sourceAdmission: string
  sourceSemanticIdentity: string
  sourceProvenance: string
  changeContractRegistration: string
  boundChangeContract: string
  capabilityProfile: string
  head: string
  currentReport: string
  idempotencyIndex: string
  quotaState: string
  recoveryBegin: string
  recoveryTombstone: string
  recoveryTerminalPlan: string
  assetPayloads: string
  assetRecords: string
  assetPayload(payloadSha256: string): string
  assetRecord(assetToken: string): string
  revision(revisionNumber: number, revisionId: string, name: string): string
  attempt(sequence: number, requestHash: string, name: string): string
  preview(candidateSha256: string): string
  checkpoint(sequence: number, recordSha256: string): string
  event(sequence: number, eventSha256: string): string
  report(reportArtifactSha256: string, name: string): string
  evaluation(sequence: number, attemptSha256: string, name: string): string
  evaluationEvidence(payloadSha256: string): string
  refusalEvidence(evidenceSha256: string): string
  export(sequence: number, exportSha256: string, name: string): string
}

export function editSessionLayoutV1(sessionKey: string): EditSessionLayoutV1
{
  assertEditLogicalComponent(sessionKey)
  const prefix = `sessions/${sessionKey}`
  const join = (value: string): string => `${prefix}/${value}`
  const safeHash = (value: string): string =>
  {
    if (!/^[0-9a-f]{64}$/u.test(value))
      throw new TypeError('edit artifact hash component is invalid')
    return value
  }
  const sequence = (value: number): string =>
  {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new TypeError('edit artifact sequence is invalid')
    return String(value).padStart(6, '0')
  }
  return Object.freeze({
    prefix,
    session: join('session.json'),
    sourceInput: join('source/input.sb3'),
    sourceAdmission: join('source/admission.json'),
    sourceSemanticIdentity: join('source/semantic-identity.json'),
    sourceProvenance: join('source/provenance.json'),
    changeContractRegistration: join(
      'authority/change-contract-registration.json'
    ),
    boundChangeContract: join('authority/bound-change-contract.json'),
    capabilityProfile: join('authority/capability-profile.json'),
    head: join('head.json'),
    currentReport: join('current-report.json'),
    idempotencyIndex: join('idempotency-index.json'),
    quotaState: join('quota-state.json'),
    recoveryBegin: join('recovery/begin-authority-v1.json'),
    recoveryTombstone: join('recovery/pre-manifest-abandoned-v1.json'),
    recoveryTerminalPlan: join('recovery/terminal-plan-v1.json'),
    // admitted asset bytes are keyed by payload digest so repeated admissions of
    // one payload retain once, while the per-token record keeps the token->digest
    // binding replay needs without any session state
    assetPayloads: join('assets/payloads'),
    assetRecords: join('assets/records'),
    assetPayload: (payloadSha256: string) =>
      join(`assets/payloads/${safeHash(payloadSha256)}.bin`),
    assetRecord: (assetToken: string) =>
      join(`assets/records/${assertEditLogicalFilename(assetToken)}.json`),
    revision: (number: number, id: string, name: string) =>
      join(
        `${revisionDirectory(number, id)}/${assertEditLogicalFilename(name)}`
      ),
    attempt: (number: number, hash: string, name: string) =>
      join(
        `attempts/${sequence(number)}-${safeHash(hash).slice(0, 16)}/${assertEditLogicalFilename(name)}`
      ),
    preview: (hash: string) => join(`preview-cache/${safeHash(hash)}.sb3`),
    checkpoint: (number: number, hash: string) =>
      join(
        `checkpoints/${sequence(number)}-${safeHash(hash).slice(0, 16)}.json`
      ),
    event: (number: number, hash: string) =>
      join(`events/${sequence(number)}-${safeHash(hash)}.json`),
    report: (hash: string, name: string) =>
      join(`reports/${safeHash(hash)}/${assertEditLogicalFilename(name)}`),
    // one directory per evaluation attempt, keyed by the semantic attempt hash
    // so a replayed attempt lands on the same key; names inside are prepared,
    // deterministic-results, external-requests, completed, certificate, index
    evaluation: (number: number, hash: string, name: string) =>
      join(
        `evaluations/${sequence(number)}-${safeHash(hash).slice(0, 16)}/${assertEditLogicalFilename(name)}`
      ),
    evaluationEvidence: (hash: string) =>
      join(`evaluation-evidence/${safeHash(hash)}.bin`),
    refusalEvidence: (hash: string) =>
      join(`refusal-evidence/${safeHash(hash)}.json`),
    // one directory per publication attempt, keyed by the semantic export hash.
    // ordinal names are the recovery reading order, so an interrupted export is
    // classified by which of them exist
    export: (number: number, hash: string, name: string) =>
      join(
        `exports/${sequence(number)}-${safeHash(hash).slice(0, 16)}/${assertEditLogicalFilename(name)}`
      ),
  })
}
