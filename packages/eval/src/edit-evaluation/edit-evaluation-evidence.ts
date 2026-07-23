// packages/eval/src/edit-evaluation/edit-evaluation-evidence.ts
// exact revision/history/contract wrappers around eval-owned evaluation outputs

import { semanticHashV1 } from '@scratch-agent/ir/edit'

import type { EditEvaluationLaneV1 } from './edit-evaluation-matrix.js'
import type { EditEvaluationSideV1 } from './edit-scenario-lowering.js'
import type {
  EditEvidenceContentHashProjectionV1,
  EvaluationEvidenceSemanticBindingV1,
  EvidenceContentHashCollectionV1,
  ExactRevisionIdentityV1,
} from '@scratch-agent/ir/edit'

type EditEvaluationEvidenceKindV1 =
  EvaluationEvidenceSemanticBindingV1['evidenceKind']

// every eval output is wrapped against the exact revision it was produced from
// plus the history & contract that authorized it; nothing enters a certificate
// without all three
export interface EditEvaluationRevisionBindingV1
{
  readonly revision: ExactRevisionIdentityV1
  readonly historySha256: string
  readonly changeContractSha256: string
  readonly evaluationPlanSha256: string
}

function editEvaluationBindingSha256V1(
  binding: EditEvaluationRevisionBindingV1
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'edit-evaluation-binding',
    schemaVersion: 1,
    revision: binding.revision,
    historySha256: binding.historySha256,
    changeContractSha256: binding.changeContractSha256,
    evaluationPlanSha256: binding.evaluationPlanSha256,
  })
}

interface EditEvaluationEvidenceInputV1
{
  readonly binding: EditEvaluationRevisionBindingV1
  readonly evidenceKind: EditEvidenceContentHashProjectionV1['evidenceKind']
  readonly mediaType: string
  readonly payloadSha256: string
  readonly byteLength: number
  readonly lane?: EditEvaluationLaneV1
  readonly side?: EditEvaluationSideV1
  readonly scenarioId?: string
}

interface EditEvaluationEvidenceRecordV1
{
  readonly projection: EditEvidenceContentHashProjectionV1
  readonly contentSha256: string
}

// the content hash covers the whole projection, so the revision/contract binding
// is inside the digest & a record cannot be re-pointed at another revision
export function wrapEditEvaluationEvidenceV1(
  input: EditEvaluationEvidenceInputV1
): EditEvaluationEvidenceRecordV1
{
  if (!/^[0-9a-f]{64}$/u.test(input.payloadSha256))
    throw new TypeError('evaluation evidence payload digest must be SHA-256')
  if (!Number.isSafeInteger(input.byteLength) || input.byteLength < 0)
    throw new TypeError('evaluation evidence byte length must be a count')
  const projection: EditEvidenceContentHashProjectionV1 = {
    schemaVersion: 1,
    evidenceKind: input.evidenceKind,
    mediaType: input.mediaType,
    payloadSha256: input.payloadSha256,
    byteLength: input.byteLength,
    revision: input.binding.revision,
    identityBindingSha256: editEvaluationBindingSha256V1(input.binding),
    ...(input.lane === undefined ? {} : { lane: input.lane }),
    ...(input.side === undefined ? {} : { side: input.side }),
    ...(input.scenarioId === undefined ? {} : { scenarioId: input.scenarioId }),
  }
  return Object.freeze({
    projection,
    contentSha256: semanticHashV1('evidence-content', projection),
  })
}

interface EditEvaluationEvidenceBindingInputV1
{
  readonly evidenceKind: EditEvaluationEvidenceKindV1
  readonly lane: EvaluationEvidenceSemanticBindingV1['lane']
  readonly requestSha256: string
  readonly resultSha256: string
  readonly contentSha256: string
}

export function editEvaluationEvidenceBindingV1(
  input: EditEvaluationEvidenceBindingInputV1
): EvaluationEvidenceSemanticBindingV1
{
  return Object.freeze({
    evidenceKind: input.evidenceKind,
    lane: input.lane,
    requestSha256: input.requestSha256,
    resultSha256: input.resultSha256,
    contentSha256: input.contentSha256,
  })
}

// evidence hashes enter the certificate as an ordered collection; ordering is
// the caller's cheap-to-expensive lane order, never storage order
export function editEvidenceContentCollectionV1(
  hashes: readonly string[]
): EvidenceContentHashCollectionV1
{
  for (const hash of hashes)
  {
    if (!/^[0-9a-f]{64}$/u.test(hash))
      throw new TypeError('evidence content hash must be SHA-256')
  }
  const ordered = Object.freeze([...hashes])
  return Object.freeze({
    hashes: ordered,
    totalCount: ordered.length,
    collectionSha256: semanticHashV1('evidence-content', {
      kind: 'edit-evidence-content-collection',
      schemaVersion: 1,
      hashes: ordered,
    }),
  })
}
