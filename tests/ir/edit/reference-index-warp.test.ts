// tests/ir/edit/reference-index-warp.test.ts
// procedure index exposes canonical warp semantics & source encodings

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClicker } from '@scratch-agent/ir'
import { buildSemanticReferenceIndex } from '@scratch-agent/ir/edit'
import {
  createScratchRecord,
  defineScratchRecordValue,
  type BlockEntry,
  type BlockField,
  type BlockInput,
} from '@scratch-agent/sb3'

const PROCCODE = 'indexed warp probe'

type WarpSource = boolean | string | null | undefined

function projectWithWarp(warp: WarpSource)
{
  const source = buildClicker()
  const project = source.toProjectJson()
  const target = project.targets[0]!
  target.blocks = createScratchRecord<BlockEntry>(Object.entries(target.blocks))
  defineScratchRecordValue<BlockEntry>(
    target.blocks,
    'indexed-warp-definition',
    {
      opcode: 'procedures_definition',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>([
        ['custom_block', [1, 'indexed-warp-prototype']],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    }
  )
  defineScratchRecordValue<BlockEntry>(
    target.blocks,
    'indexed-warp-prototype',
    {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'indexed-warp-definition',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: PROCCODE,
        argumentids: '[]',
        argumentnames: '[]',
        argumentdefaults: '[]',
        ...(warp === undefined ? {} : { warp }),
      },
    }
  )
  return source
}

const cases = [
  {
    name: 'boolean true',
    warp: true,
    expected: { warp: true, warpEncoding: 'boolean' },
  },
  {
    name: 'string true',
    warp: 'true',
    expected: { warp: true, warpEncoding: 'string' },
  },
  {
    name: 'string null',
    warp: 'null',
    expected: { warp: false, warpEncoding: 'string' },
  },
  {
    name: 'literal null',
    warp: null,
    expected: { warp: false, warpEncoding: 'null' },
  },
  {
    name: 'omitted',
    warp: undefined,
    expected: { warp: null, warpEncoding: 'absent' },
  },
  {
    name: 'malformed string',
    warp: 'not json',
    expected: { warp: null, warpEncoding: 'malformed' },
  },
] as const

for (const { name, warp, expected } of cases)
{
  test(`procedure index decodes ${name} warp`, () =>
  {
    const procedure = buildSemanticReferenceIndex(
      projectWithWarp(warp)
    ).procedures.find((entry) => entry.proccode === PROCCODE)
    assert.ok(procedure, 'expected the grafted procedure in the index')
    assert.deepEqual(
      {
        warp: procedure.warp,
        warpEncoding: procedure.warpEncoding,
      },
      expected
    )
  })
}

function competingProcedureProject(runtimeWarp: boolean)
{
  const source = buildClicker()
  const target = source.toProjectJson().targets[0]!
  target.blocks = createScratchRecord<BlockEntry>(Object.entries(target.blocks))
  const prototype = (
    blockId: string,
    parent: string | null,
    warp: boolean
  ): void =>
  {
    defineScratchRecordValue<BlockEntry>(target.blocks, blockId, {
      opcode: 'procedures_prototype',
      next: null,
      parent,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: PROCCODE,
        argumentids: '[]',
        argumentnames: '[]',
        argumentdefaults: '[]',
        warp,
      },
    })
  }
  const definition = (blockId: string, prototypeId: string): void =>
  {
    defineScratchRecordValue<BlockEntry>(target.blocks, blockId, {
      opcode: 'procedures_definition',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>([
        ['custom_block', [1, prototypeId]],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    })
  }

  // raw prototype order, lexical definition order, & VM definition order disagree
  prototype('orphan-prototype', null, !runtimeWarp)
  definition('z-runtime-definition', 'z-runtime-prototype')
  prototype('z-runtime-prototype', 'z-runtime-definition', runtimeWarp)
  definition('a-later-definition', 'a-later-prototype')
  prototype('a-later-prototype', 'a-later-definition', !runtimeWarp)
  return source
}

for (const runtimeWarp of [true, false] as const)
{
  test(`procedure index follows the VM-effective ${runtimeWarp} definition`, () =>
  {
    const procedure = buildSemanticReferenceIndex(
      competingProcedureProject(runtimeWarp)
    ).procedures.find((entry) => entry.proccode === PROCCODE)
    assert.ok(procedure, 'expected competing procedure records in the index')
    assert.equal(procedure.prototypeSourceOrder[0]?.blockId, 'orphan-prototype')
    assert.equal(procedure.definitions[0]?.blockId, 'a-later-definition')
    assert.equal(procedure.runtimeDefinition?.blockId, 'z-runtime-definition')
    assert.equal(procedure.runtimePrototype?.blockId, 'z-runtime-prototype')
    assert.equal(procedure.warp, runtimeWarp)
    assert.equal(procedure.warpEncoding, 'boolean')
  })
}
