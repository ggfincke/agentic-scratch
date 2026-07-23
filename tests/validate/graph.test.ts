// tests/validate/graph.test.ts
// each graph/referential defect raises its diagnostic; real projects stay error-free

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import type { Block, ProjectJson, Target } from '@scratch-agent/sb3'
import {
  ProjectIR,
  blankProject,
  buildCat,
  buildClicker,
} from '@scratch-agent/ir'

import {
  validateProject,
  validateProjectJson,
} from '@scratch-agent/validate'
import { fixturePath } from '../helpers/repo-paths.js'

function codesOf(json: ProjectJson): Set<string>
{
  return new Set(
    validateProjectJson(json).diagnostics.map((d) => `${d.severity}:${d.code}`)
  )
}

function sprite(json: ProjectJson): Target
{
  const t = json.targets.find((x) => x.name === 'Sprite1')
  assert.ok(t, 'clicker has a Sprite1')
  return t
}

function firstBlock(target: Target): Block
{
  for (const entry of Object.values(target.blocks))
  {
    if (!Array.isArray(entry)) return entry
  }
  throw new Error('no object block found')
}

// a fresh standalone block to graft into a sprite for a test
function stub(opcode: string, extra: Partial<Block> = {}): Block
{
  return {
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
    ...extra,
  }
}

function procMutation(
  proccode: string,
  argumentids: string[]
): NonNullable<Block['mutation']>
{
  return {
    tagName: 'mutation',
    children: [],
    proccode,
    argumentids: JSON.stringify(argumentids),
    argumentnames: JSON.stringify(argumentids),
    argumentdefaults: JSON.stringify(argumentids.map(() => '')),
  }
}

function callMutation(
  proccode: string,
  argumentids: string[]
): NonNullable<Block['mutation']>
{
  return {
    tagName: 'mutation',
    children: [],
    proccode,
    argumentids: JSON.stringify(argumentids),
  }
}

interface Case
{
  name: string
  code: string
  mutate: (json: ProjectJson) => void
}

const cases: Case[] = [
  {
    name: 'two stages',
    code: 'error:stage-count',
    mutate: (j) => ((j.targets[1] as Target).isStage = true),
  },
  {
    name: 'stage not first',
    code: 'error:stage-count',
    mutate: (j) => j.targets.reverse(),
  },
  {
    name: 'dangling next',
    code: 'warning:dangling-next',
    mutate: (j) => (firstBlock(sprite(j)).next = 'nope'),
  },
  {
    name: 'dangling parent',
    code: 'warning:dangling-parent',
    mutate: (j) => (firstBlock(sprite(j)).parent = 'nope'),
  },
  {
    name: 'ownerless parent edge',
    code: 'warning:missing-block-owner',
    mutate: (j) =>
    {
      const s = sprite(j)
      s.blocks['hat'] = stub('event_whenflagclicked')
      s.blocks['child'] = stub('motion_movesteps', {
        parent: 'hat',
        topLevel: false,
      })
    },
  },
  {
    name: 'input child parent mismatch',
    code: 'warning:block-parent-mismatch',
    mutate: (j) =>
    {
      const s = sprite(j)
      s.blocks['owner'] = stub('control_if', {
        inputs: { SUBSTACK: [2, 'child'] },
      })
      s.blocks['other'] = stub('event_whenflagclicked')
      s.blocks['child'] = stub('motion_movesteps', {
        parent: 'other',
        topLevel: false,
      })
    },
  },
  {
    name: 'multiple block owners',
    code: 'warning:multiple-block-owners',
    mutate: (j) =>
    {
      const s = sprite(j)
      s.blocks['hat'] = stub('event_whenflagclicked', { next: 'child' })
      s.blocks['owner'] = stub('control_if', {
        inputs: { SUBSTACK: [2, 'child'] },
      })
      s.blocks['child'] = stub('motion_movesteps', {
        parent: 'hat',
        topLevel: false,
      })
    },
  },
  {
    name: 'missing variable field',
    code: 'warning:missing-variable',
    mutate: (j) =>
    {
      for (const b of Object.values(sprite(j).blocks))
      {
        if (!Array.isArray(b) && b.fields?.VARIABLE)
          b.fields.VARIABLE[1] = 'ghost'
      }
    },
  },
  {
    name: 'missing broadcast field',
    code: 'warning:missing-broadcast',
    mutate: (j) =>
    {
      sprite(j).blocks['hat'] = stub('event_whenbroadcastreceived', {
        fields: { BROADCAST_OPTION: ['msg', 'ghostbc'] },
      })
    },
  },
  {
    name: 'bad input shadow-type',
    code: 'error:bad-input-encoding',
    mutate: (j) =>
    {
      for (const b of Object.values(sprite(j).blocks))
      {
        if (Array.isArray(b)) continue
        const keys = Object.keys(b.inputs ?? {})
        if (keys[0]) (b.inputs as Record<string, unknown>)[keys[0]] = [9, null]
      }
    },
  },
  {
    name: 'bad primitive (colour)',
    code: 'error:bad-primitive',
    mutate: (j) =>
    {
      sprite(j).blocks['c'] = stub('looks_say', {
        inputs: { MESSAGE: [1, [9, 'notacolor']] },
      })
    },
  },
  {
    name: 'bad field arity',
    code: 'warning:bad-field-arity',
    mutate: (j) =>
    {
      sprite(j).blocks['f'] = stub('looks_say', { fields: { X: [] as never } })
    },
  },
  {
    name: 'mutation bad json',
    code: 'error:mutation-bad-json',
    mutate: (j) =>
    {
      sprite(j).blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'x',
          argumentids: 'NOTJSON',
          argumentnames: '[]',
          argumentdefaults: '[]',
        },
      })
    },
  },
  {
    name: 'missing procedure',
    code: 'warning:missing-procedure',
    mutate: (j) =>
    {
      sprite(j).blocks['call'] = stub('procedures_call', {
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'ghost %s',
          argumentids: '["a"]',
        },
      })
    },
  },
  {
    name: 'procedure call wrong arg id',
    code: 'warning:proc-arg-mismatch',
    mutate: (j) =>
    {
      const s = sprite(j)
      s.blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: procMutation('p %s', ['arg']),
      })
      s.blocks['call'] = stub('procedures_call', {
        mutation: callMutation('p %s', ['ghost']),
        inputs: { ghost: [1, [10, 'x']] },
      })
    },
  },
  {
    name: 'procedure call missing arg input',
    code: 'warning:proc-arg-mismatch',
    mutate: (j) =>
    {
      const s = sprite(j)
      s.blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: procMutation('p %s', ['arg']),
      })
      s.blocks['call'] = stub('procedures_call', {
        mutation: callMutation('p %s', ['arg']),
      })
    },
  },
  {
    name: 'procedure call extra arg input',
    code: 'warning:proc-arg-mismatch',
    mutate: (j) =>
    {
      const s = sprite(j)
      s.blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: procMutation('p %s', ['arg']),
      })
      s.blocks['call'] = stub('procedures_call', {
        mutation: callMutation('p %s', ['arg']),
        inputs: { arg: [1, [10, 'x']], ghost: [1, [10, 'y']] },
      })
    },
  },
  {
    name: 'proc arg mismatch',
    code: 'warning:proc-arg-mismatch',
    mutate: (j) =>
    {
      sprite(j).blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'p %s %s',
          argumentids: '["a","b"]',
          argumentnames: '["a"]',
          argumentdefaults: '["",""]',
        },
      })
    },
  },
  {
    name: 'call without proccode',
    code: 'warning:missing-procedure',
    mutate: (j) => (sprite(j).blocks['call'] = stub('procedures_call')),
  },
  {
    name: 'prototype missing argumentids',
    code: 'warning:proc-arg-mismatch',
    mutate: (j) =>
    {
      sprite(j).blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'p %s',
          argumentnames: '["a"]',
          argumentdefaults: '[""]',
        },
      })
    },
  },
  {
    name: 'proccode placeholder mismatch',
    code: 'warning:proc-arg-mismatch',
    mutate: (j) =>
    {
      sprite(j).blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'p %s %s',
          argumentids: '["a"]',
          argumentnames: '["a"]',
          argumentdefaults: '[""]',
        },
      })
    },
  },
  {
    name: 'undeclared extension',
    code: 'warning:undeclared-extension',
    mutate: (j) => (sprite(j).blocks['pen'] = stub('pen_clear')),
  },
  {
    name: 'duplicate sprite name',
    code: 'warning:duplicate-sprite-name',
    mutate: (j) => j.targets.push({ ...sprite(j) }),
  },
  {
    name: 'monitor missing sprite',
    code: 'warning:monitor-missing-sprite',
    mutate: (j) =>
    {
      j.monitors = [
        {
          id: 'm',
          mode: 'default',
          opcode: 'data_variable',
          params: {},
          spriteName: 'Nope',
          value: 0,
        },
      ]
    },
  },
  {
    name: 'monitor missing data',
    code: 'warning:monitor-missing-data',
    mutate: (j) =>
    {
      j.monitors = [
        {
          id: 'ghostvar',
          mode: 'default',
          opcode: 'data_variable',
          params: {},
          spriteName: null,
          value: 0,
        },
      ]
    },
  },
]

for (const c of cases)
{
  test(`graph: ${c.name} -> ${c.code}`, () =>
  {
    const json = buildClicker().toProjectJson()
    c.mutate(json)
    const codes = codesOf(json)
    assert.ok(
      codes.has(c.code),
      `expected ${c.code}, got ${[...codes].join(', ')}`
    )
  })
}

test('missing-asset fires when an asset is absent from the archive', () =>
{
  const json = buildClicker().toProjectJson()
  const result = validateProjectJson(json, { assetPaths: new Set() })
  const codes = result.diagnostics.map((d) => d.code)
  assert.ok(codes.includes('missing-asset'))
})

test('graph: a valid procedure call matches its prototype args', () =>
{
  const json = buildClicker().toProjectJson()
  const s = sprite(json)
  s.blocks['proto'] = stub('procedures_prototype', {
    shadow: true,
    topLevel: false,
    mutation: procMutation('p %s', ['arg']),
  })
  s.blocks['call'] = stub('procedures_call', {
    mutation: callMutation('p %s', ['arg']),
    inputs: { arg: [1, [10, 'x']] },
  })
  const codes = codesOf(json)
  assert.ok(
    !codes.has('warning:proc-arg-mismatch'),
    `got ${[...codes].join(', ')}`
  )
})

test('graph: monitor spriteName resolves a sprite named Stage', () =>
{
  const json = buildClicker().toProjectJson()
  const s = sprite(json)
  const [varId] = Object.keys(s.variables)
  assert.ok(varId)
  s.name = 'Stage'
  json.monitors = [
    {
      id: varId,
      mode: 'default',
      opcode: 'data_variable',
      params: {},
      spriteName: 'Stage',
      value: 0,
    },
  ]
  const codes = codesOf(json)
  assert.ok(
    !codes.has('warning:monitor-missing-data'),
    `got ${[...codes].join(', ')}`
  )
})

test('IR-built projects validate with zero errors', () =>
{
  for (const ir of [blankProject(), buildClicker(), buildCat()])
  {
    const { counts } = validateProject(ir)
    assert.equal(
      counts.error,
      0,
      JSON.stringify(validateProject(ir).diagnostics)
    )
  }
})

for (const name of ['fixture.sb3', 'comments.sb3', 'sprite-named-stage.sb3'])
{
  test(`fixture ${name} validates with zero errors`, async () =>
  {
    const ir = await ProjectIR.fromSb3(readFileSync(fixturePath(name)))
    const { counts, diagnostics } = validateProject(ir)
    assert.equal(counts.error, 0, JSON.stringify(diagnostics))
  })
}
