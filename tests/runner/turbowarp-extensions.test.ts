// tests/runner/turbowarp-extensions.test.ts
// load allowlisted TurboWarp extensions offline in the rendered TurboWarp lane

import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { blankProject } from '@scratch-agent/ir'
import { runBrowserScenario } from '@scratch-agent/runner'
import { TURBOWARP_EXTENSION_ALLOWLIST_V1 } from '@scratch-agent/sb3'

test('the TurboWarp lane runs Local Storage and Gamepad blocks with no network', async () =>
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
  const trace = await runBrowserScenario(
    await project.toSb3(),
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
