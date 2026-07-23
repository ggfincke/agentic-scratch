// packages/runner/src/browser/browser-issues.ts
// classify browser lane failures at the playwright boundary

import {
  RUN_ISSUE_CODES,
  createRunIssue,
  isRunnerIssueError,
  toRunIssue,
  type RunIssue,
} from '../policy/issues.js'
import { errorMessage } from '../error-message.js'

export type BrowserRunStage = 'launch' | 'setup' | 'project-load' | 'runtime'

export function browserPageIssue(
  error: Error,
  stage: BrowserRunStage
): RunIssue
{
  const message = `pageerror: ${error.message}`
  if (stage === 'project-load')
  {
    return createRunIssue({
      code: RUN_ISSUE_CODES.browserProjectLoadFailed,
      kind: 'project-load',
      responsibility: 'unsupported',
      message,
    })
  }
  if (stage === 'runtime')
  {
    return createRunIssue({
      code: RUN_ISSUE_CODES.browserPageError,
      kind: 'runtime',
      responsibility: 'project',
      message,
      location: { kind: 'project' },
    })
  }
  return createRunIssue({
    code: RUN_ISSUE_CODES.browserPageError,
    kind: 'internal',
    responsibility: 'infrastructure',
    message,
  })
}

export function browserFailureIssue(
  error: unknown,
  stage: BrowserRunStage,
  networkDenied: boolean
): RunIssue
{
  if (isRunnerIssueError(error)) return error.issue
  if (networkDenied)
  {
    return createRunIssue({
      code: RUN_ISSUE_CODES.networkExecutionFailed,
      kind: 'network-policy',
      responsibility: 'unsupported',
      message: errorMessage(error),
    })
  }
  if (stage === 'launch')
  {
    return toRunIssue(error, {
      code: RUN_ISSUE_CODES.browserLaunchFailed,
      kind: 'browser-launch',
      responsibility: 'infrastructure',
    })
  }
  if (stage === 'project-load')
  {
    return toRunIssue(error, {
      code: RUN_ISSUE_CODES.browserProjectLoadFailed,
      kind: 'project-load',
      responsibility: 'unsupported',
    })
  }
  if (stage === 'runtime')
  {
    return toRunIssue(error, {
      code: RUN_ISSUE_CODES.browserRuntimeFailed,
      kind: 'runtime',
      responsibility: 'infrastructure',
    })
  }
  return toRunIssue(error, {
    code: RUN_ISSUE_CODES.browserSetupFailed,
    kind: 'internal',
    responsibility: 'infrastructure',
  })
}
