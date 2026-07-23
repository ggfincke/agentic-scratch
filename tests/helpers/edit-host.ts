// tests/helpers/edit-host.ts
// share exact host-limit, head-projection, & unchanged-lineage test fixtures

import type { ProjectOrderedCorrespondence } from '@scratch-agent/ir'
import {
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  activeOrderedSemanticLineages,
  type EditLimitKeyV1,
  type HeadProjectionV1,
} from '@scratch-agent/ir/edit'

import type { buildSourceLineageV1 } from '@scratch-agent/edit'

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
