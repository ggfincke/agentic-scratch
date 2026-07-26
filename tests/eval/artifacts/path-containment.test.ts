// tests/eval/artifacts/path-containment.test.ts
// component-aware root containment & project artifact path regression coverage

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  isPathWithinRootV1,
  ProjectArtifactStore,
  ProjectArtifactStoreLimitError,
} from '@scratch-agent/eval'

test('path containment distinguishes parent components from dot-prefixed names', () =>
{
  const root = resolve('/tmp', 'agentic-scratch-containment-root')
  assert.equal(isPathWithinRootV1(root, root), true)
  assert.equal(isPathWithinRootV1(root, root, { allowEqual: false }), false)
  assert.equal(isPathWithinRootV1(root, join(root, '..data')), true)
  assert.equal(isPathWithinRootV1(root, join(root, 'nested', '..cache')), true)
  assert.equal(isPathWithinRootV1(root, resolve(root, '..', 'outside')), false)
})

test('project artifacts admit dot-prefixed child components without admitting escapes', (t) =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-artifacts-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const store = new ProjectArtifactStore(temp)

  assert.equal(
    store.absolutePath(join('..data', 'artifact.json')),
    join(temp, '..data', 'artifact.json')
  )
  assert.throws(() => store.absolutePath('.'), /escapes the run root/u)
  assert.throws(
    () => store.absolutePath(join('..', 'outside.json')),
    /escapes the run root/u
  )
})

test('project artifact batches preflight aggregate bytes without replacing either file', (t) =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-artifact-batch-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const store = new ProjectArtifactStore(temp, { maxBytes: 10 })
  store.writeTextBatch([
    {
      relativePath: 'report.md',
      kind: 'markdown',
      mediaType: 'text/markdown',
      value: 'old',
    },
    {
      relativePath: 'report.json',
      kind: 'json',
      mediaType: 'application/json',
      value: 'old',
    },
  ])

  assert.throws(
    () =>
      store.writeTextBatch([
        {
          relativePath: 'report.md',
          kind: 'markdown',
          mediaType: 'text/markdown',
          value: '123456',
        },
        {
          relativePath: 'report.json',
          kind: 'json',
          mediaType: 'application/json',
          value: '123456',
        },
      ]),
    ProjectArtifactStoreLimitError
  )
  assert.equal(readFileSync(join(temp, 'report.md'), 'utf-8'), 'old')
  assert.equal(readFileSync(join(temp, 'report.json'), 'utf-8'), 'old')
  assert.deepEqual(
    store.references().map((entry) => [entry.path, entry.byteLength]),
    [
      ['report.json', 3],
      ['report.md', 3],
    ]
  )
})
