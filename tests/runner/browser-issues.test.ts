// tests/runner/browser-issues.test.ts
// protect browser failure ownership at the playwright boundary

import assert from 'node:assert/strict'
import test from 'node:test'

import { browserFailureIssue, browserPageIssue } from '../../packages/runner/src/browser/browser-issues.js'
import { RUN_ISSUE_CODES } from '../../packages/runner/src/policy/issues.js'

test('an injected runtime disconnect remains infrastructure-owned', () =>
{
  const issue = browserFailureIssue(
    new Error('page.evaluate: Target page, context or browser has been closed'),
    'runtime',
    false
  )

  assert.equal(issue.code, RUN_ISSUE_CODES.browserRuntimeFailed)
  assert.equal(issue.kind, 'runtime')
  assert.equal(issue.responsibility, 'infrastructure')
  assert.equal(issue.location, undefined)
})

test('an explicit in-page runtime error remains project-owned', () =>
{
  const issue = browserPageIssue(
    new Error('project callback failed'),
    'runtime'
  )

  assert.equal(issue.code, RUN_ISSUE_CODES.browserPageError)
  assert.equal(issue.kind, 'runtime')
  assert.equal(issue.responsibility, 'project')
  assert.deepEqual(issue.location, { kind: 'project' })
})
