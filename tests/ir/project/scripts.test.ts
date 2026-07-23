// tests/ir/project/scripts.test.ts
// the script-tree resolver terminates on cyclic block graphs (no stack overflow)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { SpriteTarget } from '@scratch-agent/sb3'
import { scriptsOf } from '@scratch-agent/ir'

test('scriptsOf does not overflow on a cyclic reporter graph', () =>
{
  // hat -> say (MESSAGE=r1); r1.OPERAND=r2; r2.OPERAND=r1 (a reporter cycle)
  const sprite: SpriteTarget = {
    isStage: false,
    name: 'S',
    variables: {},
    lists: {},
    broadcasts: {},
    comments: {},
    currentCostume: 0,
    costumes: [],
    sounds: [],
    volume: 100,
    layerOrder: 1,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around',
    blocks: {
      hat: {
        opcode: 'event_whenflagclicked',
        next: 'say',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      say: {
        opcode: 'looks_say',
        next: null,
        parent: 'hat',
        inputs: { MESSAGE: [3, 'r1', [10, '']] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      r1: {
        opcode: 'operator_not',
        next: null,
        parent: 'say',
        inputs: { OPERAND: [2, 'r2'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      r2: {
        opcode: 'operator_not',
        next: null,
        parent: 'r1',
        inputs: { OPERAND: [2, 'r1'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
    },
  }

  const scripts = scriptsOf(sprite)
  assert.equal(scripts.length, 1)
  assert.ok(scripts[0]!.blocks.length >= 1)
})
