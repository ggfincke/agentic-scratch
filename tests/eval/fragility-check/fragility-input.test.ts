// tests/eval/fragility-check/fragility-input.test.ts
// bounds fragility input reads & keeps read failures path-free

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { test } from 'node:test'

import {
  FRAGILITY_CHECK_ISSUE_CODES,
  FragilityCheckInputError,
  readFragilityCheckInput,
  runFragilityCheck,
  type FragilityInputReadFailure,
} from '@scratch-agent/eval'

const PROBE_PATH = resolve('scripts/project/fragility-probe.ts')

function expectInputFailure(
  action: () => unknown,
  failure: FragilityInputReadFailure,
  forbiddenPath: string
): void
{
  assert.throws(action, (error: unknown) =>
  {
    assert.ok(error instanceof FragilityCheckInputError)
    assert.equal(error.failure, failure)
    assert.equal(error.message.includes(forbiddenPath), false)
    assert.equal(error.message.includes(basename(forbiddenPath)), false)
    return true
  })
}

test('fragility input reader accepts only bounded regular files', () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-input-'))
  try
  {
    const regular = join(temp, 'regular-secret-marker.sb3')
    const bytes = Buffer.from('bounded input')
    writeFileSync(regular, bytes)
    assert.deepEqual(readFragilityCheckInput(regular, 64), bytes)

    const directory = join(temp, 'directory-secret-marker')
    mkdirSync(directory)
    expectInputFailure(
      () => readFragilityCheckInput(directory, 64),
      'not-regular',
      directory
    )

    const symlink = join(temp, 'symlink-secret-marker.sb3')
    symlinkSync(regular, symlink)
    expectInputFailure(
      () => readFragilityCheckInput(symlink, 64),
      'not-regular',
      symlink
    )

    const oversized = join(temp, 'oversized-secret-marker.sb3')
    writeFileSync(oversized, new Uint8Array())
    truncateSync(oversized, 65)
    expectInputFailure(
      () => readFragilityCheckInput(oversized, 64),
      'too-large',
      oversized
    )
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility input reader rejects a FIFO without blocking', () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-fragility-fifo-'))
  try
  {
    const fifo = join(temp, 'fifo-secret-marker.sb3')
    const create = spawnSync('mkfifo', [fifo], {
      encoding: 'utf8',
      timeout: 3_000,
    })
    assert.equal(create.error, undefined)
    assert.equal(create.status, 0, create.stderr)

    const script = `
      import {
        FragilityCheckInputError,
        readFragilityCheckInput
      } from '@scratch-agent/eval'
      try {
        readFragilityCheckInput(process.env.AGENTIC_FRAGILITY_FIFO_PATH, 64)
        process.exitCode = 2
      } catch (error) {
        process.stdout.write(JSON.stringify({
          typed: error instanceof FragilityCheckInputError,
          failure: error.failure,
          message: error.message
        }))
      }
    `
    const startedAt = performance.now()
    const read = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', script],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          AGENTIC_FRAGILITY_FIFO_PATH: fifo,
        },
        timeout: 3_000,
      }
    )
    const elapsedMs = performance.now() - startedAt

    assert.equal(read.error, undefined)
    assert.equal(read.status, 0, read.stderr)
    assert.ok(elapsedMs < 3_000, `FIFO read took ${elapsedMs} ms`)
    const result = JSON.parse(read.stdout) as {
      typed: boolean
      failure: string
      message: string
    }
    assert.deepEqual(
      { typed: result.typed, failure: result.failure },
      { typed: true, failure: 'not-regular' }
    )
    assert.equal(result.message.includes(fifo), false)
    assert.equal(result.message.includes(basename(fifo)), false)
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})

test('fragility check ignores invalid runtime read failures', async () =>
{
  const temp = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-fragility-invalid-read-')
  )
  try
  {
    const secretPath = join(temp, 'secret-input-marker.sb3')
    const invalidFailure =
      `invalid-runtime-value:${secretPath}` as FragilityInputReadFailure
    const runRoot = join(temp, 'run')
    const result = await runFragilityCheck({
      input: {
        bytes: null,
        displayName: 'unavailable.sb3',
        readFailure: invalidFailure,
      },
      runRoot,
      runId: 'fragility-invalid-read-failure',
      failOn: null,
      probeScriptPath: PROBE_PATH,
    })

    assert.equal(
      result.report.issues[0]?.code,
      FRAGILITY_CHECK_ISSUE_CODES.inputReadFailed
    )
    assert.equal(
      result.report.issues[0]?.message,
      'selected input could not be read'
    )
    const persisted = [
      JSON.stringify(result.report),
      readFileSync(join(runRoot, 'fragility-check.json'), 'utf8'),
      readFileSync(join(runRoot, 'fragility-check.md'), 'utf8'),
    ].join('\n')
    assert.equal(persisted.includes(secretPath), false)
    assert.equal(persisted.includes('secret-input-marker.sb3'), false)
    assert.equal(persisted.includes('invalid-runtime-value'), false)
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})
