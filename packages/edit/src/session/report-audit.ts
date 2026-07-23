// packages/edit/src/session/report-audit.ts
// audit that the current retained report accounts for every retained record

import type { EditKernelReportV1 } from '../contracts/kernel-types.js'

// what replay actually found in the store, counted independently of anything
// the report claims about itself
interface EditRetainedInventoryV1
{
  readonly revisionCount: number
  readonly attemptCount: number
  readonly checkpointCount: number
  readonly certificateCount: number
  readonly completedEvaluationCount: number
  readonly evaluationRecordedEventCount: number
  readonly exportAttemptCount: number
  readonly publishedExportCount: number
  readonly eventHeadSha256: string
}

export interface EditReportCompletenessResultV1
{
  readonly complete: boolean
  readonly omissions: readonly string[]
}

function countOmission(
  omissions: string[],
  label: string,
  claimed: number,
  retained: number
): void
{
  if (claimed === retained) return
  omissions.push(
    claimed < retained
      ? `the current report accounts for ${claimed} of ${retained} retained ${label}`
      : `the current report claims ${claimed} ${label} but only ${retained} are retained`
  )
}

// * the failure this exists to catch is a current report that silently omits a
// * retained evaluation or export. Older reports legitimately account for less,
// * so only the report the pointer currently names is audited
export function auditEditReportCompletenessV1(
  report: EditKernelReportV1,
  inventory: EditRetainedInventoryV1
): EditReportCompletenessResultV1
{
  const omissions: string[] = []
  countOmission(
    omissions,
    'revisions',
    report.revisionCount,
    inventory.revisionCount
  )
  countOmission(
    omissions,
    'attempts',
    report.attemptCount,
    inventory.attemptCount
  )
  countOmission(
    omissions,
    'checkpoints',
    report.checkpointCount,
    inventory.checkpointCount
  )
  countOmission(
    omissions,
    'certificates',
    report.certificateCount,
    inventory.certificateCount
  )
  if (report.eventHeadSha256 !== inventory.eventHeadSha256)
    omissions.push(
      'the current report names an event head that is not the last retained event'
    )
  // an evaluation directory that reached its completed record must have produced
  // exactly one retained certificate & one recorded event; a gap means an
  // evaluation happened that the report cannot see
  if (inventory.completedEvaluationCount !== inventory.certificateCount)
    omissions.push(
      `${inventory.completedEvaluationCount} completed evaluations retained ${inventory.certificateCount} certificates`
    )
  if (inventory.evaluationRecordedEventCount < inventory.certificateCount)
    omissions.push(
      `${inventory.certificateCount} certificates have only ${inventory.evaluationRecordedEventCount} evaluation-recorded events`
    )
  if (report.certificateCount > 0 && report.evaluationState === 'none')
    omissions.push(
      'the current report claims no evaluation while certificates are retained'
    )
  if (inventory.publishedExportCount > 1)
    omissions.push('more than one publication is retained for one session')
  const exported = inventory.publishedExportCount === 1
  if (exported !== (report.exportState === 'exported'))
    omissions.push(
      exported
        ? 'a publication is retained but the current report does not report an export'
        : 'the current report reports an export that no retained publication supports'
    )
  if (
    exported &&
    report.state !== 'closed-exported' &&
    report.state !== 'recovery-required'
  )
    omissions.push(
      `a publication is retained but the current report is in state ${report.state}`
    )
  if (report.state === 'closed-exported' && !exported)
    omissions.push('the current report closed as exported with no publication')
  if (report.limitations.length === 0)
    omissions.push('the current report states no limitations at all')
  return Object.freeze({
    complete: omissions.length === 0,
    omissions: Object.freeze(omissions),
  })
}
