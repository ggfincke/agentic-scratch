// packages/runner/src/policy/issues.ts
// stable producer-owned classifications for runner failures

import { errorMessage } from '../error-message.js'

type RunIssueKind =
  | 'project-load'
  | 'scenario'
  | 'tick-budget'
  | 'network-policy'
  | 'browser-launch'
  | 'observation'
  | 'runtime'
  | 'internal'

type IssueResponsibility =
  'project' | 'repair-case' | 'infrastructure' | 'unsupported'

export type RunnerIssueLocation =
  | { kind: 'project' }
  | { kind: 'asset'; path: string }
  | { kind: 'unresolved-target'; name: string }

export interface RunIssue
{
  readonly code: string
  readonly kind: RunIssueKind
  readonly responsibility: IssueResponsibility
  readonly message: string
  readonly location?: RunnerIssueLocation
}

type RunIssueInput = Omit<RunIssue, 'message'> & { message: string }

export const RUN_ISSUE_CODES = {
  projectLoadFailed: 'runner.project.load-failed',
  scenarioInvalidMaxTicks: 'runner.scenario.invalid-max-ticks',
  scenarioInvalidWaitTicks: 'runner.scenario.invalid-wait-ticks',
  scenarioInvalidTapTicks: 'runner.scenario.invalid-tap-ticks',
  scenarioInvalidBroadcastTicks: 'runner.scenario.invalid-broadcast-max-ticks',
  scenarioDuplicateSnapshot: 'runner.scenario.duplicate-snapshot-label',
  scenarioUnknownStep: 'runner.scenario.unknown-step',
  scenarioMissingTarget: 'runner.scenario.unresolved-target',
  tickBudgetExceeded: 'runner.tick-budget.exceeded',
  broadcastTickBudgetExceeded: 'runner.tick-budget.broadcast-exceeded',
  networkRequestDenied: 'runner.network.request-denied',
  networkExecutionFailed: 'runner.network.execution-failed',
  vmInitializationFailed: 'runner.vm.initialization-failed',
  vmRuntimeFailed: 'runner.vm.runtime-failed',
  vmObserverFailed: 'runner.vm.observer-failed',
  vmSnapshotFailed: 'runner.vm.snapshot-failed',
  vmLogError: 'runner.vm.log-error',
  vmCleanupFailed: 'runner.vm.cleanup-failed',
  browserLaunchFailed: 'runner.browser.launch-failed',
  browserSetupFailed: 'runner.browser.setup-failed',
  browserProjectLoadFailed: 'runner.browser.project-load-failed',
  browserRuntimeFailed: 'runner.browser.runtime-failed',
  browserPageError: 'runner.browser.page-error',
  browserConsoleError: 'runner.browser.console-error',
  browserSnapshotFailed: 'runner.browser.snapshot-failed',
  observationPlanInvalid: 'runner.observation.plan-invalid',
  observationCaptureFailed: 'runner.observation.capture-failed',
  observationBudgetExceeded: 'runner.observation.budget-exceeded',
  observationIncomplete: 'runner.observation.incomplete',
  observationIdentityMismatch: 'runner.observation.identity-mismatch',
  // spelled exactly as the contract pins it; the surrounding dotted
  // codes predate that pin & are not renamed here
  observationResourceExceeded: 'runner.observation_resource_exceeded',
  observationNonScalar: 'runner.observation_non_scalar',
  runtimeLineageManifestInvalid: 'runner.runtime-lineage.manifest-invalid',
  runtimeLineageUnavailable: 'runner.runtime-lineage.unavailable',
  identityBoundActionInconclusive: 'runner.identity-bound.action-inconclusive',
  browserCleanupFailed: 'runner.browser.cleanup-failed',
  coordinatorPoisoned: 'runner.coordinator.poisoned',
  internalFailed: 'runner.internal.failed',
} as const

export function createRunIssue(input: RunIssueInput): RunIssue
{
  return { ...input }
}

export class RunnerIssueError extends Error
{
  readonly issue: RunIssue

  constructor(issue: RunIssue)
  {
    super(issue.message)
    this.name = 'RunnerIssueError'
    this.issue = issue
  }
}

export function isRunnerIssueError(error: unknown): error is RunnerIssueError
{
  return error instanceof RunnerIssueError
}

export function toRunIssue(
  error: unknown,
  fallback: Omit<RunIssueInput, 'message'>
): RunIssue
{
  if (isRunnerIssueError(error)) return error.issue
  return createRunIssue({ ...fallback, message: errorMessage(error) })
}

export function runIssueMessages(issues: readonly RunIssue[]): string[]
{
  return issues.map((issue) => issue.message)
}
