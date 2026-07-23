// packages/eval/src/core/mutation.ts
// run a base test case against every IR mutant; a mutant is killed when the suite now fails

import {
  mutants,
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

// the base case must pass on the un-mutated project; each valid mutant re-runs the same case &
// counts as killed iff the case fails -> the suite's oracles (asserts + model) caught the change
export async function runMutationForCase(
  base: TestCase,
  options: RunOptions = {}
): Promise<MutationRunResult>
{
  const all = mutants(base.project)
  const outcomes = []
  const invalid: MutationRecord[] = []
  for (const m of all)
  {
    // a stillborn mutant that fails graph validation tests nothing behavioral; exclude it
    if (validateProject(m.project).counts.error > 0)
    {
      invalid.push(m.record)
      continue
    }
    const r = await runTest({ ...base, project: m.project }, options)
    outcomes.push({ record: m.record, killed: !r.ok })
  }
  return { report: scoreMutants(outcomes), invalid }
}
