// packages/edit/src/support/canonical.ts
// canonical byte, digest, opaque-ID, & exact-identity helpers for edit records

import { DEFAULT_EDIT_ADMISSION_LIMITS } from '@scratch-agent/sb3'
import {
  canonicalJsonV1,
  DEFAULT_CANONICAL_JSON_LIMITS,
} from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type {
  ExactRevisionIdentityV1,
  HeadProjectionV1,
} from '@scratch-agent/ir/edit'

export function editCanonicalBytesV1(value: unknown): Uint8Array
{
  return new TextEncoder().encode(
    canonicalJsonV1(value, {
      maxDepth: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonDepth,
      maxNodes: DEFAULT_EDIT_ADMISSION_LIMITS.maxJsonNodes,
      maxMembers: DEFAULT_EDIT_ADMISSION_LIMITS.maxMembersPerContainer,
      maxStringCodeUnits: DEFAULT_CANONICAL_JSON_LIMITS.maxStringCodeUnits,
    })
  )
}

export function editCanonicalSha256V1(value: unknown): string
{
  return sha256Hex(editCanonicalBytesV1(value))
}

export function editOpaqueIdV1(
  prefix: string,
  entropy: Uint8Array,
  semanticContext: unknown
): string
{
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(prefix))
    throw new TypeError('opaque edit ID prefix is invalid')
  return `${prefix}-${sha256Hex(
    new Uint8Array([
      ...new TextEncoder().encode(`${prefix}\0`),
      ...entropy,
      ...editCanonicalBytesV1(semanticContext),
    ])
  ).slice(0, 32)}`
}

export function exactRevisionFromHeadV1(
  head: HeadProjectionV1
): ExactRevisionIdentityV1
{
  return {
    sourceArtifactSha256: head.sourceArtifactSha256,
    revisionNumber: head.revisionNumber,
    revisionId: head.revisionId,
    candidateSha256: head.candidateSha256,
    assetManifestSha256: head.assetManifestSha256,
    changeContractSha256: head.changeContractSha256,
    capabilityProfileSha256: head.capabilityProfileSha256,
  }
}

export function sameHeadV1(
  left: HeadProjectionV1,
  right: HeadProjectionV1
): boolean
{
  return editCanonicalSha256V1(left) === editCanonicalSha256V1(right)
}
