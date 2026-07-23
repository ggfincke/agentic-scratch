// packages/eval/src/core/options.ts
// registered repair tests & narrow candidate-evaluation options

import type { Severity } from '@scratch-agent/validate'

import type { FailureExpectation } from './failures.js'
import type { RunOptions, TestSpec } from './test.js'

type TestRole = 'repair-target' | 'regression'

type BaselineExpectation =
  | { outcome: 'pass' }
  | {
      outcome: 'fail'
      failures: FailureExpectation[]
      allowAdditionalProjectFailures: false
    }

export interface RepairTestSpec extends TestSpec
{
  id: string
  role: TestRole
  baseline: BaselineExpectation
}

type EvaluationPhase = 'baseline' | 'targeted' | 'regression'

export type DiagnosticThreshold = Severity | 'never'

export interface DiagnosticRegressionOptions
{
  rejectNewGraphAtOrAbove: DiagnosticThreshold
  rejectNewStaticAtOrAbove: DiagnosticThreshold
  allowedNewGraphCodes: string[]
  allowedNewStaticCodes: string[]
}

export interface CandidateEvaluationOptions
{
  tests: RepairTestSpec[]
  selectedTestIds: string[]
  phase: EvaluationPhase
  diagnostics: DiagnosticRegressionOptions
  run?: RunOptions
}

export interface CandidatePipelineOptions
{
  tests: RepairTestSpec[]
  diagnostics: DiagnosticRegressionOptions
  run?: RunOptions
}

export const DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS: DiagnosticRegressionOptions =
  {
    rejectNewGraphAtOrAbove: 'info',
    rejectNewStaticAtOrAbove: 'info',
    allowedNewGraphCodes: [],
    allowedNewStaticCodes: [],
  }

export const REPAIR_TEST_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/

export function targetedTestIds(tests: RepairTestSpec[]): string[]
{
  return tests
    .filter(
      (test) =>
        test.role === 'repair-target' && test.baseline.outcome === 'fail'
    )
    .map((test) => test.id)
}

export function regressionTestIds(tests: RepairTestSpec[]): string[]
{
  return tests.map((test) => test.id)
}
