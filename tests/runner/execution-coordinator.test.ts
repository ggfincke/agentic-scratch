// tests/runner/execution-coordinator.test.ts
// protect serialized execution & permanent poison semantics

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  poisonRunnerExecution,
  withRunnerExecution,
} from '@scratch-agent/runner'
import {
  RUN_ISSUE_CODES,
  RunnerIssueError,
} from '@scratch-agent/runner'

function deferred(): {
  promise: Promise<void>
  resolve: () => void
}
{
  let resolve!: () => void
  const promise = new Promise<void>((done) =>
  {
    resolve = done
  })
  return { promise, resolve }
}

function isPoisoned(error: unknown): boolean
{
  return (
    error instanceof RunnerIssueError &&
    error.issue.code === RUN_ISSUE_CODES.coordinatorPoisoned
  )
}

test('execution is FIFO, rejection-safe, and permanently poisonable', async () =>
{
  const firstGate = deferred()
  const firstEntered = deferred()
  const order: string[] = []

  const first = withRunnerExecution(async () =>
  {
    order.push('first:start')
    firstEntered.resolve()
    await firstGate.promise
    order.push('first:end')
  })
  await firstEntered.promise

  const rejected = withRunnerExecution(() =>
  {
    order.push('second:start')
    throw new Error('expected callback failure')
  })
  const third = withRunnerExecution(() =>
  {
    order.push('third:start')
    return 'third:done'
  })

  await Promise.resolve()
  assert.deepEqual(order, ['first:start'])
  firstGate.resolve()
  await first
  await assert.rejects(rejected, /expected callback failure/)
  assert.equal(await third, 'third:done')
  assert.deepEqual(order, [
    'first:start',
    'first:end',
    'second:start',
    'third:start',
  ])

  const runningGate = deferred()
  const runningEntered = deferred()
  const running = withRunnerExecution(async () =>
  {
    order.push('running:start')
    runningEntered.resolve()
    await runningGate.promise
    order.push('running:end')
    return 'running:done'
  })
  await runningEntered.promise

  let queuedRan = false
  const queued = withRunnerExecution(() =>
  {
    queuedRan = true
  })
  const queuedRejection = assert.rejects(queued, isPoisoned)

  poisonRunnerExecution(new Error('injected cleanup failure'))
  runningGate.resolve()

  assert.equal(await running, 'running:done')
  await queuedRejection
  assert.equal(queuedRan, false)

  let futureRan = false
  await assert.rejects(
    withRunnerExecution(() =>
    {
      futureRan = true
    }),
    isPoisoned
  )
  assert.equal(futureRan, false)
  assert.deepEqual(order.slice(-2), ['running:start', 'running:end'])
})
