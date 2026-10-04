// tests/static/scratchblocks.test.ts
// project scratchblocks export: non-empty, deterministic, opcode-derived text

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import JSZip from 'jszip'

import type { ProjectJson } from '@scratch-agent/sb3'
import { emitProjectScratchblocks } from '@scratch-agent/static'
import { fixturePath } from '../helpers/repo-paths.js'

async function fixtureProjectJson(name: string): Promise<ProjectJson>
{
  const zip = await JSZip.loadAsync(readFileSync(fixturePath(name)))
  const entry = zip.file('project.json')
  assert.ok(entry, 'fixture has project.json')
  return JSON.parse(await entry.async('text')) as ProjectJson
}

test('scratchblocks: fixture emits stable per-target scripts', async () =>
{
  const project = await fixtureProjectJson('fixture.sb3')
  const first = emitProjectScratchblocks(project)
  const second = emitProjectScratchblocks(project)
  assert.deepEqual(second, first)
  assert.deepEqual(
    first.targets.map((t) => t.name),
    ['Stage', 'Sprite1']
  )
})

test('scratchblocks: empty targets stay script-free & sprite renders known blocks', async () =>
{
  const project = await fixtureProjectJson('fixture.sb3')
  const emitted = emitProjectScratchblocks(project)
  const stage = emitted.targets[0]!
  assert.deepEqual(stage.scripts, [])
  const sprite = emitted.targets[1]!
  assert.ok(sprite.scripts.length > 0, 'Sprite1 has top-level scripts')
  const text = sprite.scripts.join('\n')
  assert.match(text, /when @greenFlag clicked/)
  assert.match(text, /set \[score v\] to \[0\]/)
  assert.match(text, /change x by \(10\)/)
})
