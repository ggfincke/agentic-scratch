// tests/runner/turbowarp-extensions.test.ts
// load allowlisted TurboWarp extensions offline in the rendered TurboWarp lanes

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { PNG } from 'pngjs'

import {
  evaluateAuthoringCandidateV3,
  validateAuthoringCandidateEvaluationV3,
} from '@scratch-agent/eval'
import { blankProject } from '@scratch-agent/ir'
import { getStandardAuthoritySha256V2 } from '@scratch-agent/ir/edit'
import { runBrowserScenario } from '@scratch-agent/runner'
import { TURBOWARP_EXTENSION_ALLOWLIST_V1 } from '@scratch-agent/sb3'

// stores & reads a Local Storage value, then polls a gamepad at green flag
async function extensionProjectBytes(): Promise<Uint8Array>
{
  const project = blankProject()
  const stage = project.json.targets[0]!
  stage.variables = {
    'var-got': ['got', 'unset'],
    'var-pad': ['pad', 'unset'],
  }
  stage.blocks = {
    flag: {
      opcode: 'event_whenflagclicked',
      next: 'namespace',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    namespace: {
      opcode: 'localstorage_setProjectId',
      next: 'store',
      parent: 'flag',
      inputs: { ID: [1, [10, 'runner-test']] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    store: {
      opcode: 'localstorage_set',
      next: 'read',
      parent: 'namespace',
      inputs: { KEY: [1, [10, 'k']], VALUE: [1, [10, 'stored']] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    read: {
      opcode: 'data_setvariableto',
      next: 'poll',
      parent: 'store',
      inputs: { VALUE: [3, 'get', [10, '']] },
      fields: { VARIABLE: ['got', 'var-got'] },
      shadow: false,
      topLevel: false,
    },
    get: {
      opcode: 'localstorage_get',
      next: null,
      parent: 'read',
      inputs: { KEY: [1, [10, 'k']] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    poll: {
      opcode: 'data_setvariableto',
      next: null,
      parent: 'read',
      inputs: { VALUE: [3, 'connected', [10, '']] },
      fields: { VARIABLE: ['pad', 'var-pad'] },
      shadow: false,
      topLevel: false,
    },
    connected: {
      opcode: 'Gamepad_gamepadConnected',
      next: null,
      parent: 'poll',
      inputs: { pad: [1, 'padMenu'] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    padMenu: {
      opcode: 'Gamepad_menu_padMenu',
      next: null,
      parent: 'connected',
      inputs: {},
      fields: { padMenu: ['any'] },
      shadow: true,
      topLevel: false,
    },
  }
  project.json.extensions = ['Gamepad', 'localstorage']
  project.json.extensionURLs = Object.fromEntries(
    TURBOWARP_EXTENSION_ALLOWLIST_V1.map((entry) => [entry.id, entry.url])
  )
  project.json.extensionStorage = { localstorage: { namespace: 'runner-test' } }
  return await project.toSb3()
}

test('the TurboWarp lane runs Local Storage and Gamepad blocks with no network', async () =>
{
  const trace = await runBrowserScenario(
    await extensionProjectBytes(),
    {
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 2 },
        { do: 'snapshot', label: 'done' },
      ],
    },
    { screenshotDir: mkdtempSync(join(tmpdir(), 'turbowarp-extensions-')) }
  )
  // a blocked request or a refused extension load fails the run
  assert.ok(trace.ok, `browser errors: ${trace.errors.join('; ')}`)
  const done = trace.snapshots.find((snapshot) => snapshot.label === 'done')
  assert.equal(done?.variables.got, 'stored')
  assert.equal(done?.variables.pad, false)
})

test('candidate evaluation runs an extension candidate on its mandatory TurboWarp lane', async () =>
{
  const bytes = await extensionProjectBytes()
  const request = {
    candidateBytes: bytes,
    candidateSha256: createHash('sha256').update(bytes).digest('hex'),
    standardAuthoritySha256: getStandardAuthoritySha256V2(),
    compilerIdentitySha256: 'c'.repeat(64),
    runtimeTargets: [
      {
        schemaVersion: 1,
        runtime: 'turbowarp',
        scheduler: 'deterministic',
        tickRate: 60,
      } as const,
    ],
    scenarios: [
      {
        id: 'storage',
        scenario: {
          seed: 1,
          fixedDateMs: 0,
          maxTicks: 10,
          steps: [
            { do: 'greenFlag' },
            { do: 'wait', ticks: 2 },
            { do: 'snapshot', label: 'done' },
          ],
        },
      },
    ],
    assertions: [
      {
        scenarioId: 'storage',
        assertion: {
          at: 'done',
          probe: { on: 'var', name: 'got' },
          match: { kind: 'equals', value: 'stored' },
        },
      },
    ],
    evidenceRoot: mkdtempSync(
      join(tmpdir(), 'turbowarp-extension-evaluation-')
    ),
  }
  // vanilla scratch-vm cannot load the extensions, so no headless lane runs
  const evaluation = await evaluateAuthoringCandidateV3(request)
  assert.equal(
    evaluation.disposition,
    'accepted',
    JSON.stringify(evaluation.issues)
  )
  assert.deepEqual(
    evaluation.lanes.map((cell) => [cell.lane, cell.assertions[0]?.ok]),
    [['turboWarpBrowser', true]]
  )
  assert.deepEqual(
    validateAuthoringCandidateEvaluationV3(evaluation, request),
    []
  )
})

// real rotated stamps split at the surface, then a cleared clip leaves the next stamp whole
test('clipping splits rotated dry and wet stamps without leaking to the next stamp', async () =>
{
  const project = blankProject()
  const sprite = project.addSprite('Clipped sprite')
  for (const [name, color] of [
    ['dry', '#ff0000'],
    ['wet', '#0000ff'],
    ['next', '#00ff00'],
  ])
  {
    const bytes = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${color}"/></svg>`
    )
    const assetId = createHash('md5').update(bytes).digest('hex')
    sprite.addCostume(
      {
        name: name!,
        assetId,
        md5ext: `${assetId}.svg`,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 40,
        rotationCenterY: 40,
      },
      bytes
    )
  }
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'pen_clear' },
    { opcode: 'motion_gotoxy', inputs: { X: -60, Y: 0 } },
    { opcode: 'motion_pointindirection', inputs: { DIRECTION: 45 } },
    {
      opcode: 'looks_seteffectto',
      fields: { EFFECT: ['GHOST'] },
      inputs: { VALUE: 50 },
    },
    { opcode: 'looks_switchcostumeto', inputs: { COSTUME: 'dry' } },
    {
      opcode: 'xeltallivclipblend_setClipbox',
      inputs: { X1: -240, Y1: 0.25, X2: 240, Y2: 180 },
    },
    { opcode: 'pen_stamp' },
    { opcode: 'xeltallivclipblend_clearClipbox' },
    { opcode: 'looks_switchcostumeto', inputs: { COSTUME: 'wet' } },
    {
      opcode: 'xeltallivclipblend_setClipbox',
      inputs: { X1: -240, Y1: -180, X2: 240, Y2: 0.25 },
    },
    { opcode: 'pen_stamp' },
    { opcode: 'xeltallivclipblend_clearClipbox' },
    {
      opcode: 'looks_seteffectto',
      fields: { EFFECT: ['GHOST'] },
      inputs: { VALUE: 0 },
    },
    { opcode: 'motion_gotoxy', inputs: { X: 80, Y: 0 } },
    { opcode: 'looks_switchcostumeto', inputs: { COSTUME: 'next' } },
    { opcode: 'pen_stamp' },
    { opcode: 'looks_hide' },
  ])
  const extension = TURBOWARP_EXTENSION_ALLOWLIST_V1.find(
    (entry) => entry.id === 'xeltallivclipblend'
  )!
  project.json.extensions = ['pen', extension.id]
  project.json.extensionURLs = { [extension.id]: extension.url }
  const trace = await runBrowserScenario(
    await project.toSb3(),
    {
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 2 },
        { do: 'snapshot', label: 'split' },
      ],
    },
    { screenshotDir: mkdtempSync(join(tmpdir(), 'clipping-stamps-')) }
  )
  assert.ok(trace.ok, trace.errors.join('; '))
  const image = PNG.sync.read(
    readFileSync(trace.screenshots.find((shot) => shot.label === 'split')!.path)
  )
  assert.equal(image.width, 480)
  assert.equal(image.height, 360)
  const rgb = (x: number, y: number) =>
    Array.from(
      image.data.subarray(
        (y * image.width + x) * 4,
        (y * image.width + x) * 4 + 3
      )
    )
  for (let y = 168; y < 180; y++)
  {
    const color = rgb(180, y)
    assert.equal(color[0], 255, `dry row ${y}`)
    assert.ok(
      Math.abs(color[1]! - 128) <= 1 && Math.abs(color[2]! - 128) <= 1,
      `dry opacity row ${y}: ${color}`
    )
  }
  for (let y = 180; y < 192; y++)
  {
    const color = rgb(180, y)
    assert.equal(color[2], 255, `wet row ${y}`)
    assert.ok(
      Math.abs(color[0]! - 128) <= 1 && Math.abs(color[1]! - 128) <= 1,
      `wet opacity row ${y}: ${color}`
    )
  }
  for (const y of [168, 180, 191])
    assert.deepEqual(rgb(320, y), [0, 255, 0], `cleared row ${y}`)
})
