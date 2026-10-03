// packages/eval/src/core/mutation.ts
// run every IR mutant w/ evidence bound to that mutant's project

import {
  iterateMutants,
  scoreMutants,
  type MutationRecord,
  type MutationReport,
} from '@scratch-agent/mutate'
import { validateProject } from '@scratch-agent/validate'

import { runTest, type RunOptions, type TestCase } from './test.js'

interface MutationRunResult
{
  report: MutationReport
  // mutants dropped before running because they produced an invalid (stillborn) project
  invalid: MutationRecord[]
}

// each valid mutant re-runs the same case; non-project failures abort authoritative scoring
export async function runMutationForCase(
  base: TestCase,
  options: RunOptions = {}
): Promise<MutationRunResult>
{
  if (options.artifactBytes !== undefined)
  {
    throw new Error(
      'mutation runs cannot use artifactBytes; each mutant must execute its bound project'
    )
  }
  const outcomes = []
  const invalid: MutationRecord[] = []
  for (const m of iterateMutants(base.project))
  {
    // a stillborn mutant that fails graph validation tests nothing behavioral; exclude it
    if (validateProject(m.project).counts.error > 0)
    {
      invalid.push(m.record)
      continue
    }
    const r = await runTest({ ...base, project: m.project }, options)
    const nonProjectIssue = r.issues.find(
      ({ issue }) => issue.responsibility !== 'project'
    )
    if (nonProjectIssue)
    {
      const { lane, issue } = nonProjectIssue
      throw new Error(
        `mutation run aborted at ${m.record.id}: ${lane} issue ${issue.code} is ${issue.responsibility}-owned: ${issue.message}`
      )
    }
    outcomes.push({ record: m.record, killed: !r.ok })
  }
  return { report: scoreMutants(outcomes), invalid }
}
