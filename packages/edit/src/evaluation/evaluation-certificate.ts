// packages/edit/src/evaluation/evaluation-certificate.ts
// immutable evaluation certificates & their head-change invalidation

import {
  aggregateEditEvaluationV1,
  editEvaluationGateDispositionSetSha256V1,
  editEvaluationLimitationSetSha256V1,
} from '@scratch-agent/eval'
import { semanticHashV1 } from '@scratch-agent/ir/edit'

import { editCanonicalSha256V1, exactRevisionFromHeadV1 } from '../support/canonical.js'

import type { ActivatedEvaluationPlanV1 } from './evaluation-plans.js'
import type {
  EditEvaluationEvidenceEntryV1,
  EditRuntimeIdentityPinningV1,
} from './evaluation-ports.js'
import type {
  EditAllowedChangeResultV1,
  EditEvaluationAggregateV1,
  EditLaneStatusV1,
  EditPreservationResultV1,
  EditRequiredChangeResultV1,
} from '@scratch-agent/eval'
import type {
  EditEvaluationCertificateHashProjectionV1,
  EditEvaluationCertificateV1,
  ExactRevisionIdentityV1,
  HeadProjectionV1,
} from '@scratch-agent/ir/edit'

interface EditEvaluationCertificateInputV1
{
  readonly plan: ActivatedEvaluationPlanV1
  readonly revision: ExactRevisionIdentityV1
  readonly semanticSourceSha256: string
  readonly historySha256: string
  readonly projectJsonSha256: string
  readonly evaluatedCandidateByteLength: number
  readonly identity: EditRuntimeIdentityPinningV1
  readonly fixedTimePolicySha256: string
  readonly seedSetSha256: string
  readonly laneStatuses: readonly EditLaneStatusV1[]
  readonly required: EditRequiredChangeResultV1
  readonly allowed: EditAllowedChangeResultV1
  readonly preservation: EditPreservationResultV1
  readonly evidence: readonly EditEvaluationEvidenceEntryV1[]
  readonly extraLimitations?: readonly string[]
}

interface EditEvaluationCertificateResultV1
{
  readonly certificate: EditEvaluationCertificateV1
  readonly aggregate: EditEvaluationAggregateV1
}

// * the projection deliberately excludes evaluation IDs, run directories, wall
// * clock times, & storage ordering, so a replay under a fresh run directory &
// * a newly issued evaluation ID reproduces the same certificate hash
export function buildEditEvaluationCertificateV1(
  input: EditEvaluationCertificateInputV1
): EditEvaluationCertificateResultV1
{
  const aggregate = aggregateEditEvaluationV1({
    required: input.required,
    allowed: input.allowed,
    preservation: input.preservation,
    laneStatuses: input.laneStatuses,
    extraLimitations: input.extraLimitations,
  })
  const projection: EditEvaluationCertificateHashProjectionV1 = {
    schemaVersion: 1,
    status: aggregate.status,
    evaluationPlanId: input.plan.planId,
    evaluationPlanSha256: input.plan.evaluationPlanSha256,
    evaluatedRevision: input.revision,
    evaluatedCandidateByteLength: input.evaluatedCandidateByteLength,
    semanticSourceSha256: input.semanticSourceSha256,
    historySha256: input.historySha256,
    changeContractSha256: input.revision.changeContractSha256,
    projectJsonSha256: input.projectJsonSha256,
    requiredChangeResultSha256: input.required.resultSha256,
    allowedChangeResultSha256: input.allowed.resultSha256,
    preservationResultSha256: input.preservation.resultSha256,
    scenarioSetSha256: input.plan.scenarioSetSha256,
    seedSetSha256: input.seedSetSha256,
    fixedTimePolicySha256: input.fixedTimePolicySha256,
    observationPlanSetSha256: input.plan.observationPlanSetSha256,
    rubricSetSha256: input.plan.rubricSetSha256,
    lensPolicySetSha256: input.plan.lensPolicySetSha256,
    vmIdentitySha256: input.identity.vmIdentitySha256,
    browserIdentitySha256: input.identity.browserIdentitySha256,
    runtimeIdentitySha256: input.identity.runtimeIdentitySha256,
    pinnedScratchIdentitySha256: input.identity.pinnedScratchIdentitySha256,
    buildIdentitySha256: input.identity.buildIdentitySha256,
    executableIdentitySha256: input.identity.executableIdentitySha256,
    evidence: Object.freeze(input.evidence.map((entry) => entry.binding)),
    limitationSetSha256: editEvaluationLimitationSetSha256V1(
      aggregate.limitations
    ),
    gateDispositionSetSha256: editEvaluationGateDispositionSetSha256V1(
      input.laneStatuses
    ),
  }
  return Object.freeze({
    certificate: Object.freeze({
      hashProjection: projection,
      certificateSha256: semanticHashV1('certificate', projection),
    }),
    aggregate,
  })
}

type EditCertificateStandingV1 = 'current' | 'historical'

export interface EditRetainedCertificateV1
{
  readonly evaluationId: string
  readonly sequence: number
  readonly planId: string
  readonly certificate: EditEvaluationCertificateV1
  readonly attemptSha256: string
  readonly evidenceContentCollectionSha256: string
}

// a certificate binds one exact revision; a later edit does not invalidate the
// record, it makes it historical - the evidence stays, the exportability does not
export function certificateStandingV1(
  retained: EditRetainedCertificateV1,
  head: HeadProjectionV1
): EditCertificateStandingV1
{
  const current = exactRevisionFromHeadV1(head)
  return editCanonicalSha256V1(
    retained.certificate.hashProjection.evaluatedRevision
  ) === editCanonicalSha256V1(current)
    ? 'current'
    : 'historical'
}

export interface EditExportabilityV1
{
  readonly exportable: boolean
  readonly refusalCode:
    | 'edit.stale_certificate'
    | 'edit.evaluation_failed'
    | 'edit.evaluation_inconclusive'
    | 'edit.evaluation_unavailable'
    | null
  readonly detail: string
}

// only a passed certificate on the exact current head, produced by the
// contract's export-required plan, authorizes export
export function evaluateExportabilityV1(input: {
  readonly retained: readonly EditRetainedCertificateV1[]
  readonly head: HeadProjectionV1
  readonly exportRequiredPlanId: string
}): EditExportabilityV1
{
  const forPlan = input.retained.filter(
    (entry) => entry.planId === input.exportRequiredPlanId
  )
  if (forPlan.length === 0)
  {
    return Object.freeze({
      exportable: false,
      refusalCode: 'edit.evaluation_unavailable',
      detail: `no certificate exists for export-required plan ${input.exportRequiredPlanId}`,
    })
  }
  const current = forPlan.filter(
    (entry) => certificateStandingV1(entry, input.head) === 'current'
  )
  if (current.length === 0)
  {
    return Object.freeze({
      exportable: false,
      refusalCode: 'edit.stale_certificate',
      detail: `every ${input.exportRequiredPlanId} certificate is bound to an earlier revision; the head moved after evaluation`,
    })
  }
  const latest = current.reduce((left, right) =>
    right.sequence > left.sequence ? right : left
  )
  const status = latest.certificate.hashProjection.status
  if (status === 'passed')
  {
    return Object.freeze({
      exportable: true,
      refusalCode: null,
      detail: 'exact-head certificate passed the export-required plan',
    })
  }
  return Object.freeze({
    exportable: false,
    refusalCode:
      status === 'failed'
        ? 'edit.evaluation_failed'
        : status === 'inconclusive'
          ? 'edit.evaluation_inconclusive'
          : 'edit.evaluation_unavailable',
    detail: `exact-head certificate for ${input.exportRequiredPlanId} is ${status}`,
  })
}

// the ordered certificate set that enters the semantic report projection; order
// is issue order, & only semantic identities enter the digest
export function certificateSetProjectionV1(
  retained: readonly EditRetainedCertificateV1[]
): { readonly entries: readonly unknown[]; readonly sha256: string }
{
  const entries = Object.freeze(
    [...retained]
      .sort((left, right) => left.sequence - right.sequence)
      .map((entry) => ({
        sequence: entry.sequence,
        planId: entry.planId,
        certificateSha256: entry.certificate.certificateSha256,
        status: entry.certificate.hashProjection.status,
        evaluatedRevision: entry.certificate.hashProjection.evaluatedRevision,
        attemptSha256: entry.attemptSha256,
        evidenceContentCollectionSha256: entry.evidenceContentCollectionSha256,
      }))
  )
  return Object.freeze({
    entries,
    sha256: editCanonicalSha256V1({
      schemaVersion: 1,
      label: 'evaluation-certificates',
      entries,
    }),
  })
}
