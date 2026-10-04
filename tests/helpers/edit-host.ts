// tests/helpers/edit-host.ts
// shared exact edit-host policy, port, head, & lineage test fixtures

import assert from 'node:assert/strict'

import type { ProjectOrderedCorrespondence } from '@scratch-agent/ir'
import {
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  activeOrderedSemanticLineages,
  scenarioPolicyValueSemanticSha256V1,
  type EditLimitKeyV1,
  type EditScenarioPolicyV1,
  type HeadProjectionV1,
} from '@scratch-agent/ir/edit'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type {
  buildSourceLineageV1,
  EditClockPort,
  EditEntropyPort,
} from '@scratch-agent/edit'

const RETAINED_SCENARIO_POLICY = Object.freeze({
  scenarioId: 'scenario',
  applicability: 'baselineAndCandidate',
  seed: 0,
  fixedDateMs: 0,
  maxTicks: 1,
  steps: Object.freeze([{ do: 'greenFlag' as const }]),
}) satisfies EditScenarioPolicyV1

export type MutableRetainedPolicyContract = {
  policyBindings: Array<{
    kind: string
    semanticSha256: string
    retainedArtifactSha256: string
  }>
  evaluationPlans: Array<{ scenarioPolicySha256s: string[] }>
}

export function attachRetainedPolicyFixturesV1(
  contract: MutableRetainedPolicyContract
): readonly Uint8Array[]
{
  const scenarioBytes = canonicalJsonBytesV1(RETAINED_SCENARIO_POLICY)
  const runtimeBytes = canonicalJsonBytesV1({
    policyKind: 'runtime',
    schemaVersion: 1,
  })
  const lensBytes = canonicalJsonBytesV1({
    policyKind: 'lens',
    schemaVersion: 1,
  })
  const bytesByKind = new Map<string, Uint8Array>([
    ['scenario', scenarioBytes],
    ['runtime', runtimeBytes],
    ['lens', lensBytes],
  ])
  const scenarioSemanticSha256 = scenarioPolicyValueSemanticSha256V1(
    RETAINED_SCENARIO_POLICY
  )
  for (const binding of contract.policyBindings)
  {
    const bytes = bytesByKind.get(binding.kind)
    assert.ok(bytes, `test policy bytes are missing for ${binding.kind}`)
    binding.retainedArtifactSha256 = sha256Hex(bytes)
    if (binding.kind === 'scenario')
      binding.semanticSha256 = scenarioSemanticSha256
  }
  for (const plan of contract.evaluationPlans)
    plan.scenarioPolicySha256s = [scenarioSemanticSha256]
  return Object.freeze([scenarioBytes, runtimeBytes, lensBytes])
}

export function deterministicClock(start: number): EditClockPort
{
  let now = start
  return { nowEpochMs: () => ++now }
}

export function deterministicEntropy(seed: number): EditEntropyPort
{
  let sequence = seed
  return {
    randomBytes(byteLength: number): Uint8Array
    {
      const bytes = new Uint8Array(byteLength)
      for (let index = 0; index < byteLength; index++)
        bytes[index] = (sequence + index * 31) & 0xff
      sequence += byteLength + 11
      return bytes
    },
  }
}

export const HOST_DEFAULT_LIMITS = Object.freeze(
  Object.fromEntries(
    Object.entries(PHASE_8_EDIT_LIMIT_AUTHORITY_V1).map(([key, entry]) => [
      key,
      entry.defaultValue,
    ])
  ) as Record<EditLimitKeyV1, number>
)

export const HOST_HARD_LIMITS = Object.freeze(
  Object.fromEntries(
    Object.entries(PHASE_8_EDIT_LIMIT_AUTHORITY_V1).map(([key, entry]) => [
      key,
      entry.hardMaximum,
    ])
  ) as Record<EditLimitKeyV1, number>
)

export function expectedHeadRequest(head: HeadProjectionV1)
{
  return {
    expectedAssetManifestSha256: head.assetManifestSha256,
    expectedCandidateSha256: head.candidateSha256,
    expectedCapabilityProfileSha256: head.capabilityProfileSha256,
    expectedChangeContractSha256: head.changeContractSha256,
    expectedRevisionId: head.revisionId,
    expectedRevisionNumber: head.revisionNumber,
    expectedSourceArtifactSha256: head.sourceArtifactSha256,
  }
}

export function planningHead(head: HeadProjectionV1, sessionId: string)
{
  return {
    sessionId,
    ...expectedHeadRequest(head),
    expectedCapabilitySnapshotSha256: head.capabilitySnapshotSha256,
  }
}

export function unchangedTargetCorrespondence(
  beforeRevisionIdentity: string,
  afterRevisionIdentity: string,
  semanticSourceSha256: string,
  lineage: ReturnType<typeof buildSourceLineageV1>['active']
): ProjectOrderedCorrespondence
{
  const lineageIds = activeOrderedSemanticLineages(lineage, 'target', null).map(
    (entry) => entry.lineageId
  )
  return {
    beforeRevisionIdentity,
    afterRevisionIdentity,
    beforeSemanticSourceSha256: semanticSourceSha256,
    afterSemanticSourceSha256: semanticSourceSha256,
    targets: {
      collectionKind: 'targets',
      collectionPath: '/targets',
      beforeCollectionPath: '/targets',
      afterCollectionPath: '/targets',
      ownerLineageId: null,
      targetOwnerLineageId: null,
      containerLineageId: null,
      beforeLineageIds: lineageIds,
      afterLineageIds: lineageIds,
      members: lineageIds.map((lineageId, index) => ({
        lineageId,
        beforeIndex: index,
        afterIndex: index,
      })),
    },
  }
}
