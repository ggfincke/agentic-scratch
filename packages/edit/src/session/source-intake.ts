// packages/edit/src/session/source-intake.ts
// host-neutral exact source bytes & provenance evidence for revision-zero admission

import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u

export type EditSourceProvenanceV1 =
  | {
      kind: 'projectSession'
      projectSessionId: string
      selectedDisplayName: string
      canonicalRealpath: string
      device: string
      inode: string
      byteLength: number
      modifiedAtNanoseconds: string
      sourceInspectionPolicySha256: string
      diagnosticPolicySha256: string
      runtimePolicySha256: string
      provenanceRegistrationSha256: string
    }
  | {
      kind: 'registeredTemplate'
      registryProfileSha256: string
      registryEntryId: string
      templateId: string
      templateVersion: number
      templateArtifactSha256: string
      registryResolutionProofSha256: string
      sourceInspectionPolicySha256: string
      diagnosticPolicySha256: string
      runtimePolicySha256: string
      provenanceRegistrationSha256: string
      backingFileIdentity?: {
        canonicalRealpath: string
        device: string
        inode: string
        byteLength: number
        modifiedAtNanoseconds: string
      }
    }

export interface EditSourceIntakeV1
{
  bytes: Uint8Array
  displayName: string
  expectedArtifactSha256: string
  provenance: EditSourceProvenanceV1
  recheck(): Promise<EditSourceIntakeRecheckV1>
}

export type EditSourceIntakeRecheckV1 =
  | { ok: true; observedArtifactSha256: string }
  | {
      ok: false
      reason: 'missing' | 'changed' | 'unavailable'
      observedArtifactSha256?: string
    }

function assertText(value: string, name: string): void
{
  if (value.length === 0 || value.includes('\0'))
    throw new TypeError(`${name} must be nonempty and contain no NUL`)
}

function assertSha256(value: string, name: string): void
{
  if (!SHA256_PATTERN.test(value)) throw new TypeError(`${name} is not SHA-256`)
}

export function validateEditSourceIntakeV1(
  intake: EditSourceIntakeV1
): EditSourceIntakeV1
{
  assertText(intake.displayName, 'source display name')
  assertSha256(intake.expectedArtifactSha256, 'expected source artifact hash')
  const actual = sha256Hex(intake.bytes)
  if (actual !== intake.expectedArtifactSha256)
    throw new Error(
      'source intake bytes do not match the expected artifact hash'
    )
  const provenance = intake.provenance
  const serialized = canonicalJsonBytesV1(provenance)
  if (serialized.byteLength > 256 * 1024)
    throw new RangeError(
      'source provenance exceeds the hard registration limit'
    )
  for (const [key, value] of Object.entries(provenance))
  {
    if (key.endsWith('Sha256') && typeof value === 'string')
      assertSha256(value, `source provenance ${key}`)
  }
  if (
    provenance.kind === 'registeredTemplate' &&
    (!Number.isSafeInteger(provenance.templateVersion) ||
      provenance.templateVersion < 1)
  )
    throw new TypeError('template version must be a positive safe integer')
  return Object.freeze({
    ...intake,
    bytes: new Uint8Array(intake.bytes),
    provenance: structuredClone(provenance),
  })
}

export function sourceProvenanceEvidenceSha256V1(
  provenance: EditSourceProvenanceV1
): string
{
  return sha256Hex(canonicalJsonBytesV1(provenance))
}
