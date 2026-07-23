// packages/eval/src/core/issues.ts
// issue disposition & conversion at the candidate-evaluation boundary

import type { RunIssue, RunnerIssueLocation } from '@scratch-agent/runner'

import {
  stableFingerprint,
  type EvidenceLocation,
  type RunFailure,
} from './failures.js'
import type { LaneRunIssue } from './test.js'

export type EvaluationDisposition =
  | 'project-failure'
  | 'case-invalid'
  | 'stopped-infrastructure'
  | 'stopped-unsupported'

function evidenceLocation(
  location: RunnerIssueLocation | undefined
): EvidenceLocation | undefined
{
  if (!location) return undefined
  return location
}

export function runIssueFailure(
  testId: string,
  tagged: LaneRunIssue
): RunFailure
{
  const location = evidenceLocation(tagged.issue.location)
  return {
    kind: 'run',
    fingerprint: stableFingerprint('run', {
      testId,
      lane: tagged.lane,
      issueKind: tagged.issue.kind,
      code: tagged.issue.code,
    }),
    testId,
    lane: tagged.lane,
    issueKind: tagged.issue.kind,
    code: tagged.issue.code,
    location,
    message: tagged.issue.message,
  }
}

export function issueDisposition(
  issues: readonly RunIssue[]
): EvaluationDisposition | null
{
  if (issues.some((issue) => issue.responsibility === 'infrastructure'))
  {
    return 'stopped-infrastructure'
  }
  if (issues.some((issue) => issue.responsibility === 'unsupported'))
  {
    return 'stopped-unsupported'
  }
  if (issues.some((issue) => issue.responsibility === 'repair-case'))
  {
    return 'case-invalid'
  }
  if (issues.some((issue) => issue.responsibility === 'project'))
  {
    return 'project-failure'
  }
  return null
}

export function caseIssue(code: string, message: string): RunIssue
{
  return {
    code,
    kind: 'scenario',
    responsibility: 'repair-case',
    message,
  }
}
