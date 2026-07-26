// tests/ir/edit/procedure-warp.test.ts
// canonical warp decode honors both VM encodings & moves procedure fingerprints

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildClicker, decodeProcedureWarpV1 } from '@scratch-agent/ir'
import {
  procedureEntityEvidenceSetV1,
  resolveProcedureRecordV1,
} from '@scratch-agent/ir/edit'
import {
  createScratchRecord,
  defineScratchRecordValue,
  type BlockEntry,
  type BlockField,
  type BlockInput,
} from '@scratch-agent/sb3'

const PROCCODE = 'warp probe'

type WarpSource = boolean | string | null | undefined

// clicker project w/ a grafted definition+prototype pair carrying the given warp value
function projectWithWarp(warp: WarpSource)
{
  const source = buildClicker()
  const project = source.toProjectJson()
  const target = project.targets[0]!
  target.blocks = createScratchRecord<BlockEntry>(Object.entries(target.blocks))
  defineScratchRecordValue<BlockEntry>(target.blocks, 'warp-definition', {
    opcode: 'procedures_definition',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['custom_block', [1, 'warp-prototype']],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(target.blocks, 'warp-prototype', {
    opcode: 'procedures_prototype',
    next: null,
    parent: 'warp-definition',
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
  })
  return source
}

function procedureEvidence(warp: WarpSource)
{
  const evidence = procedureEntityEvidenceSetV1(projectWithWarp(warp)).find(
    (entry) => entry.proccode === PROCCODE
  )
  assert.ok(evidence, 'expected procedure evidence for the grafted prototype')
  return evidence
}

test('decodeProcedureWarpV1 mirrors the pinned VM for every encoding', () =>
{
  assert.deepEqual(decodeProcedureWarpV1(true), {
    warp: true,
    encoding: 'boolean',
  })
  assert.deepEqual(decodeProcedureWarpV1(false), {
    warp: false,
    encoding: 'boolean',
  })
  assert.deepEqual(decodeProcedureWarpV1('true'), {
    warp: true,
    encoding: 'string',
  })
  assert.deepEqual(decodeProcedureWarpV1('false'), {
    warp: false,
    encoding: 'string',
  })
  // the VM JSON.parses string warp, so "null" is falsy & "1" is truthy
  assert.deepEqual(decodeProcedureWarpV1('null'), {
    warp: false,
    encoding: 'string',
  })
  assert.deepEqual(decodeProcedureWarpV1(null), {
    warp: false,
    encoding: 'null',
  })
  assert.deepEqual(decodeProcedureWarpV1('1'), {
    warp: true,
    encoding: 'string',
  })
  assert.deepEqual(decodeProcedureWarpV1(undefined), {
    warp: null,
    encoding: 'absent',
  })
  assert.deepEqual(decodeProcedureWarpV1('not json'), {
    warp: null,
    encoding: 'malformed',
  })
  // a non-string non-boolean never reaches the VM's JSON.parse arm; the
  // decoder must not ToString-coerce it into a definite warp value
  assert.deepEqual(decodeProcedureWarpV1(1 as unknown as string), {
    warp: null,
    encoding: 'malformed',
  })
})

test('boolean-true warp resolves & fingerprints as warp-enabled', () =>
{
  // real converted projects carry boolean warp; === 'true' misread it as false
  const record = resolveProcedureRecordV1(projectWithWarp(true), 0, PROCCODE)
  assert.equal(record.warp, true)

  const booleanTrue = procedureEvidence(true)
  const stringTrue = procedureEvidence('true')
  const booleanFalse = procedureEvidence(false)

  assert.equal(booleanTrue.warp, true)
  assert.equal(stringTrue.warp, true)
  assert.equal(booleanFalse.warp, false)

  // the fingerprint tracks warp semantics, not its serialization
  assert.equal(
    booleanTrue.semanticFingerprintSha256,
    stringTrue.semanticFingerprintSha256
  )
  assert.notEqual(
    booleanTrue.semanticFingerprintSha256,
    booleanFalse.semanticFingerprintSha256
  )
})

test('literal-null warp resolves as definite non-warp', () =>
{
  const record = resolveProcedureRecordV1(projectWithWarp(null), 0, PROCCODE)
  assert.equal(record.warp, false)
  assert.equal(procedureEvidence(null).warp, false)
})
