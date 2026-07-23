// packages/edit/src/session/retained-request-authority.ts
// shared exact domain, wire, & admitted-asset request authority checks

import {
  parseEditToolInputV1,
  type EditAssetAdmitRequestV1,
  type EditPreviewRequestV1,
  type EditToolName,
  type HeadProjectionV1,
} from '@scratch-agent/ir/edit'

import type { SessionAssetRecordV1 } from '../assets/asset-admission.js'
import { editCanonicalSha256V1 } from '../support/canonical.js'

const SESSION_ATTEMPT_TOOL_NAMES = Object.freeze([
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_export',
  'edit_close',
] as const satisfies readonly EditToolName[])

type SessionAttemptToolName = (typeof SESSION_ATTEMPT_TOOL_NAMES)[number]

function recordV1(value: unknown): Record<string, unknown> | null
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isSessionAttemptToolNameV1(
  value: string
): value is SessionAttemptToolName
{
  return SESSION_ATTEMPT_TOOL_NAMES.includes(value as SessionAttemptToolName)
}

function expectedAssetAdmitHeadV1(
  request: EditAssetAdmitRequestV1
): HeadProjectionV1
{
  return Object.freeze({
    sourceArtifactSha256: request.expectedSourceArtifactSha256,
    revisionNumber: request.expectedRevisionNumber,
    revisionId: request.expectedRevisionId,
    candidateSha256: request.expectedCandidateSha256,
    assetManifestSha256: request.expectedAssetManifestSha256,
    changeContractSha256: request.expectedChangeContractSha256,
    capabilityProfileSha256: request.expectedCapabilityProfileSha256,
    capabilitySnapshotSha256: request.expectedCapabilitySnapshotSha256,
  })
}

function expectedPreviewHeadV1(
  request: EditPreviewRequestV1
): HeadProjectionV1
{
  const expected = request.batch.expected
  return Object.freeze({
    sourceArtifactSha256: expected.expectedSourceArtifactSha256,
    revisionNumber: expected.expectedRevisionNumber,
    revisionId: expected.expectedRevisionId,
    candidateSha256: expected.expectedCandidateSha256,
    assetManifestSha256: expected.expectedAssetManifestSha256,
    changeContractSha256: expected.expectedChangeContractSha256,
    capabilityProfileSha256: expected.expectedCapabilityProfileSha256,
    capabilitySnapshotSha256: expected.expectedCapabilitySnapshotSha256,
  })
}

export function retainedStatefulRequestBindingFailureV1(input: {
  readonly toolName: string
  readonly requestId: string
  readonly sessionId: string
  readonly boundaryKind: 'directHost' | 'mcp'
  readonly request: unknown
  readonly transportRequest: unknown
}): string | null
{
  const domain = recordV1(input.request)
  if (domain?.['requestId'] !== input.requestId)
    return 'retained domain request identity differs'
  if (!isSessionAttemptToolNameV1(input.toolName))
    return 'retained attempt names a non-session edit tool'
  const identicalProjection =
    editCanonicalSha256V1(input.transportRequest) ===
    editCanonicalSha256V1(input.request)
  if (input.boundaryKind === 'directHost' && identicalProjection) return null
  const parsed = parseEditToolInputV1(input.toolName, input.transportRequest)
  if (!parsed.ok)
    return `${input.toolName} retained transport request is not exact`
  const transport = parsed.value as Record<string, unknown>
  if (
    transport['requestId'] !== input.requestId ||
    transport['sessionId'] !== input.sessionId
  )
    return `${input.toolName} retained transport request identity differs`
  if (input.toolName === 'edit_preview')
  {
    const request = parsed.value as EditPreviewRequestV1
    if (
      editCanonicalSha256V1(domain['expectedHead']) !==
        editCanonicalSha256V1(expectedPreviewHeadV1(request)) ||
      editCanonicalSha256V1(domain['canonicalTransaction']) !==
        editCanonicalSha256V1(request.batch)
    )
      return 'edit_preview retained transport and domain requests differ'
    return null
  }
  if (input.toolName === 'edit_asset_admit')
  {
    const request = parsed.value as EditAssetAdmitRequestV1
    const source = recordV1(domain['source'])
    if (
      source === null ||
      editCanonicalSha256V1(domain['expectedHead']) !==
        editCanonicalSha256V1(expectedAssetAdmitHeadV1(request)) ||
      source['kind'] !== request.source.kind ||
      source['expectedPayloadSha256'] !== request.source.expectedPayloadSha256
    )
      return 'edit_asset_admit retained transport and domain requests differ'
    if (request.source.kind === 'inputFile')
    {
      const provenance = recordV1(source['provenance'])
      if (
        source['mediaKind'] !== request.source.mediaKind ||
        source['expectedByteLength'] !== request.source.expectedByteLength ||
        provenance?.['kind'] !== 'assetInput' ||
        provenance['selectedPath'] !== request.source.absolutePath ||
        provenance['sha256'] !== request.source.expectedPayloadSha256 ||
        provenance['byteLength'] !== request.source.expectedByteLength
      )
        return 'edit_asset_admit retained input-file authority differs'
      return null
    }
    if (
      (source['mediaKind'] !== 'costume' && source['mediaKind'] !== 'sound') ||
      !Number.isSafeInteger(source['byteLength']) ||
      (source['byteLength'] as number) < 0 ||
      editCanonicalSha256V1(source['media']) !==
        editCanonicalSha256V1(request.source.media)
    )
      return 'edit_asset_admit retained source-media authority differs'
    return null
  }
  return identicalProjection
    ? null
    : `${input.toolName} retained transport and domain requests differ`
}

export function retainedAssetDomainRecordFailureV1(
  request: unknown,
  record: SessionAssetRecordV1
): string | null
{
  const source = recordV1(recordV1(request)?.['source'])
  if (
    source === null ||
    source['kind'] !== record.origin ||
    source['mediaKind'] !== record.mediaKind ||
    source['expectedPayloadSha256'] !== record.payloadSha256
  )
    return 'asset domain request differs from its retained record'
  if (source['kind'] === 'inputFile')
  {
    const provenance = recordV1(source['provenance'])
    if (
      source['expectedByteLength'] !== record.byteLength ||
      provenance?.['kind'] !== 'assetInput' ||
      provenance['sha256'] !== record.payloadSha256 ||
      provenance['byteLength'] !== record.byteLength
    )
      return 'asset input-file authority differs from its retained record'
    return null
  }
  return source['kind'] === 'sourceMedia' &&
    source['byteLength'] === record.byteLength
    ? null
    : 'asset source-media authority differs from its retained record'
}
