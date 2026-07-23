// packages/runner/src/policy/execution-coordinator.ts
// serialize scoped runs that temporarily replace process-global runtime state

import {
  RUN_ISSUE_CODES,
  RunnerIssueError,
  createRunIssue,
  type RunIssue,
} from './issues.js'
import { errorMessage } from '../error-message.js'

let nextTurn: Promise<void> = Promise.resolve()
let poisonIssue: RunIssue | null = null

// permanently stop this process after a process-global restoration failure
export function poisonRunnerExecution(error: unknown): void
{
  if (poisonIssue) return
  poisonIssue = createRunIssue({
    code: RUN_ISSUE_CODES.coordinatorPoisoned,
    kind: 'internal',
    responsibility: 'infrastructure',
    message: `runner execution is poisoned after cleanup failure: ${errorMessage(error)}`,
  })
}

export function runnerExecutionPoisonIssue(): RunIssue | null
{
  return poisonIssue
}

// hold the shared lock only while callback runs, incl. its awaited cleanup
export async function withRunnerExecution<T>(
  callback: () => T | PromiseLike<T>
): Promise<T>
{
  const previousTurn = nextTurn
  let release!: () => void
  nextTurn = new Promise<void>((resolve) =>
  {
    release = resolve
  })

  await previousTurn
  try
  {
    if (poisonIssue) throw new RunnerIssueError(poisonIssue)
    return await callback()
  }
  finally
  {
    release()
  }
}
