// tests/static/static.test.ts
// each static smell/bug pattern raises its diagnostic; a clean sprite raises none

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { Block, Target } from '@scratch-agent/sb3'
import { ProjectIR, blankProject } from '@scratch-agent/ir'

import { analyzeStaticProject } from '@scratch-agent/static'

// a blank project w/ one empty sprite to graft test blocks onto
function makeProject(): { ir: ProjectIR; sprite: Target }
{
  const ir = blankProject()
  ir.addSprite('Sprite1')
  const sprite = ir.toProjectJson().targets.find((t) => t.name === 'Sprite1')
  assert.ok(sprite)
  return { ir, sprite }
}

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

function codesOf(ir: ProjectIR): Set<string>
{
  return new Set(
    analyzeStaticProject(ir).diagnostics.map((d) => `${d.severity}:${d.code}`)
  )
}

interface Case
{
  name: string
  code: string
  mutate: (sprite: Target) => void
}

const cases: Case[] = [
  {
    name: 'message never received',
    code: 'warning:message-never-received',
    mutate: (s) =>
    {
      s.blocks['b'] = stub('event_broadcast', {
        inputs: { BROADCAST_INPUT: [1, [11, 'go', 'bcid']] },
      })
    },
  },
  {
    name: 'message never sent',
    code: 'warning:message-never-sent',
    mutate: (s) =>
    {
      s.blocks['h'] = stub('event_whenbroadcastreceived', {
        fields: { BROADCAST_OPTION: ['solo', 'id'] },
      })
    },
  },
  {
    name: 'unused variable',
    code: 'info:unused-variable',
    mutate: (s) => (s.variables['v'] = ['lonely', 0]),
  },
  {
    name: 'unused custom block',
    code: 'info:unused-custom-block',
    mutate: (s) =>
    {
      s.blocks['proto'] = stub('procedures_prototype', {
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'foo',
          argumentids: '[]',
          argumentnames: '[]',
          argumentdefaults: '[]',
        },
      })
    },
  },
  {
    name: 'dead code',
    code: 'info:dead-code',
    mutate: (s) =>
    {
      s.blocks['d1'] = stub('motion_movesteps', { next: 'd2' })
      s.blocks['d2'] = stub('motion_movesteps', {
        topLevel: false,
        parent: 'd1',
      })
    },
  },
  {
    name: 'empty script',
    code: 'info:empty-script',
    mutate: (s) => (s.blocks['flag'] = stub('event_whenflagclicked')),
  },
  {
    name: 'empty control body',
    code: 'info:empty-control-body',
    mutate: (s) =>
      (s.blocks['if'] = stub('control_if', {
        inputs: { SUBSTACK: [2, null] },
      })),
  },
  {
    name: 'empty else body',
    code: 'info:empty-control-body',
    mutate: (s) =>
      (s.blocks['ifelse'] = stub('control_if_else', {
        inputs: { SUBSTACK: [2, 'then'], SUBSTACK2: [2, null] },
      })),
  },
  {
    name: 'hide without show',
    code: 'warning:hide-without-show',
    mutate: (s) => (s.blocks['hide'] = stub('looks_hide')),
  },
  {
    name: 'comparing literals',
    code: 'warning:comparing-literals',
    mutate: (s) =>
    {
      s.blocks['eq'] = stub('operator_equals', {
        inputs: { OPERAND1: [1, [10, 'a']], OPERAND2: [1, [10, 'b']] },
      })
    },
  },
  {
    name: 'missing backdrop',
    code: 'warning:missing-backdrop',
    mutate: (s) =>
    {
      s.blocks['bk'] = stub('looks_switchbackdropto', {
        inputs: { BACKDROP: [1, [10, 'ghostbackdrop']] },
      })
    },
  },
  {
    name: 'ambiguous custom block signature',
    code: 'warning:ambiguous-custom-block-signature',
    mutate: (s) =>
    {
      for (const id of ['p1', 'p2'])
      {
        s.blocks[id] = stub('procedures_prototype', {
          shadow: true,
          topLevel: false,
          mutation: {
            tagName: 'mutation',
            children: [],
            proccode: 'dup',
            argumentids: '[]',
            argumentnames: '[]',
            argumentdefaults: '[]',
          },
        })
      }
    },
  },
]

for (const c of cases)
{
  test(`static: ${c.name} -> ${c.code}`, () =>
  {
    const { ir, sprite } = makeProject()
    c.mutate(sprite)
    const codes = codesOf(ir)
    assert.ok(
      codes.has(c.code),
      `expected ${c.code}, got ${[...codes].join(', ')}`
    )
  })
}

test('a clean sprite raises no static diagnostics', () =>
{
  const { ir } = makeProject()
  assert.equal(analyzeStaticProject(ir).diagnostics.length, 0)
})
