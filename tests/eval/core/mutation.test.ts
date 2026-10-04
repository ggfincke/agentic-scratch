// tests/eval/core/mutation.test.ts
// mutation testing kills a deliberately-injected bug -> the suite's oracles have real power (exit #3)

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runMutationForCase, runTest, stateGameCase } from '@scratch-agent/eval'
import { buildStateGame, deletableStatementIds } from '@scratch-agent/ir'
import { loadModelsFromText } from '@scratch-agent/model'
import { enumerateSites, iterateMutants, mutants } from '@scratch-agent/mutate'
import type { Block, Target } from '@scratch-agent/sb3'
import { validateProject } from '@scratch-agent/validate'

function requiredBlock(target: Target, id: string): Block
{
  const entry = target.blocks[id]
  assert.ok(entry && !Array.isArray(entry), `expected block ${id}`)
  return entry
}

test('mutation reveals the deliberate score-increment bug', async () =>
{
  const base = await runTest(stateGameCase)
  assert.ok(base.ok, 'base case must pass on the un-mutated project')

  const { report, invalid } = await runMutationForCase(stateGameCase)
  assert.equal(invalid.length, 0, 'the operators produce loadable mutants')
  assert.ok(report.total >= 10, `expected many mutants, got ${report.total}`)

  // zeroing the score increment must be caught (the headline deliberate bug)
  const scoreBug = report.outcomes.find(
    (o) =>
      o.record.sprite === 'Hero' &&
      /data_changevariableby\.VALUE: 1 -> 0/.test(o.record.description)
  )
  assert.ok(scoreBug, 'the score-increment mutation exists')
  assert.equal(scoreBug!.killed, true, 'the score bug is killed by the oracles')

  // deleting the increment entirely is also caught
  const deleteBug = report.outcomes.find(
    (o) => o.record.sprite === 'Hero' && o.record.operator === 'delete'
  )
  assert.equal(deleteBug!.killed, true, 'deleting the increment is caught')

  // survivors exist -> the report surfaces oracle gaps rather than a hollow 100%
  assert.ok(report.killed > 0 && report.survived > 0)
})

test('mutation scoring binds authoritative bytes and complete safe operators', async (t) =>
{
  await t.test(
    'fixed artifact bytes cannot replace mutant projects',
    async () =>
    {
      const artifactBytes = await stateGameCase.project.toSb3()
      await assert.rejects(
        () => runMutationForCase(stateGameCase, { artifactBytes }),
        /mutation runs cannot use artifactBytes/u
      )
    }
  )

  await t.test(
    'non-project failures abort without producing a score',
    async () =>
    {
      const model = loadModelsFromText(
        JSON.stringify([
          {
            id: 'touching',
            usage: 'program',
            startNodeId: 'start',
            nodes: [{ id: 'start' }, { id: 'done' }],
            edges: [
              {
                id: 'touch',
                from: 'start',
                to: 'done',
                conditions: [
                  { name: 'SpriteTouching', args: ['Hero', 'Hero'] },
                ],
              },
            ],
          },
        ])
      )
      const originalClone = globalThis.structuredClone
      let snapshot: unknown
      let snapshotCopies = 0
      let candidateCopies = 0
      globalThis.structuredClone = ((value, options) =>
      {
        const cloned = originalClone(value, options)
        if (value === stateGameCase.project.json)
        {
          snapshot = cloned
          snapshotCopies++
        }
        else if (value === snapshot) candidateCopies++
        return cloned
      }) as typeof structuredClone
      try
      {
        await assert.rejects(
          () => runMutationForCase({ ...stateGameCase, model }),
          /runner\.vm\.observer-failed is infrastructure-owned/u
        )
        assert.equal(snapshotCopies, 1)
        assert.equal(candidateCopies, 1)
      }
      finally
      {
        globalThis.structuredClone = originalClone
      }
    }
  )

  await t.test(
    'incomplete end models abort without killing a mutant',
    async () =>
    {
      const model = loadModelsFromText(
        JSON.stringify([
          {
            id: 'bounded-end-cycle',
            usage: 'end',
            startNodeId: 'first',
            nodes: [{ id: 'first' }, { id: 'second' }],
            edges: [
              { id: 'forward', from: 'first', to: 'second' },
              { id: 'back', from: 'second', to: 'first' },
            ],
          },
        ])
      )
      await assert.rejects(
        () => runMutationForCase({ ...stateGameCase, model }),
        /model\.evaluation\.limit-exceeded is unsupported-owned/u
      )
    }
  )

  await t.test('delete sites exactly cover every deletable statement', () =>
  {
    const targets = stateGameCase.project.json.targets
    const expected = new Set<string>()
    const substackHeads = new Set<string>()
    for (const [targetIndex, target] of targets.entries())
    {
      const deletable = deletableStatementIds(
        target,
        Object.keys(target.blocks)
      )
      for (const id of deletable) expected.add(`${targetIndex}:${id}`)
      for (const entry of Object.values(target.blocks))
      {
        if (Array.isArray(entry)) continue
        for (const [name, input] of Object.entries(entry.inputs ?? {}))
        {
          if (!name.startsWith('SUBSTACK')) continue
          for (const slot of input.slice(1))
          {
            if (typeof slot === 'string' && deletable.has(slot))
              substackHeads.add(`${targetIndex}:${slot}`)
          }
        }
      }
    }

    const actual = enumerateSites(targets)
      .filter((site) => site.operator === 'delete')
      .map((site) => `${site.targetIndex}:${site.blockId}`)
    assert.ok(substackHeads.size > 0, 'fixture has deletable substack heads')
    assert.deepEqual(actual.slice().sort(), [...expected].sort())
    assert.equal(new Set(actual).size, actual.length)

    const project = buildStateGame()
    const expectedMutants = mutants(project)
    const sequence = iterateMutants(project)
    const originalAsset = project.assets[0]!
    assert.ok(originalAsset)
    project.json.targets[0]!.name = 'changed-after-iteration-binding'
    project.assets.length = 0
    const first = sequence.next()
    assert.equal(first.done, false)
    assert.deepEqual(first.value.record, expectedMutants[0]!.record)
    assert.deepEqual(first.value.project.json, expectedMutants[0]!.project.json)
    assert.equal(first.value.project.assets[0]!.bytes, originalAsset.bytes)
    first.value.project.json.targets[0]!.name = 'changed-yielded-candidate'
    first.value.project.assets.length = 0
    const remaining = [...sequence]
    assert.deepEqual(
      remaining.map(({ record, project }) => ({ record, json: project.json })),
      expectedMutants
        .slice(1)
        .map(({ record, project }) => ({ record, json: project.json }))
    )
    assert.ok(
      remaining.every(
        ({ project }) => project.assets[0]!.bytes === originalAsset.bytes
      )
    )
  })

  await t.test(
    'negation preserves an occupied reporter under a fresh id',
    async () =>
    {
      const project = buildStateGame()
      const stage = project.json.targets.find((target) => target.isStage)
      assert.ok(stage)
      const ownerPair = Object.entries(stage.blocks).find(
        ([, entry]) =>
          !Array.isArray(entry) &&
          entry.opcode === 'control_if' &&
          typeof entry.inputs?.CONDITION?.[1] === 'string'
      )
      assert.ok(ownerPair)
      const [ownerId, owner] = ownerPair
      assert.ok(!Array.isArray(owner))
      const condition = owner.inputs?.CONDITION
      assert.ok(condition)
      const originalReporterId = condition[1]
      assert.equal(typeof originalReporterId, 'string')
      if (typeof originalReporterId !== 'string')
        throw new Error('condition reporter must be a block id')

      const reporter = requiredBlock(stage, originalReporterId)
      const reporterOpcode = reporter.opcode
      const occupiedId = `${ownerId}~not`
      assert.equal(Object.hasOwn(stage.blocks, occupiedId), false)
      for (const entry of Object.values(stage.blocks))
      {
        if (!Array.isArray(entry) && entry.parent === originalReporterId)
          entry.parent = occupiedId
      }
      delete stage.blocks[originalReporterId]
      stage.blocks[occupiedId] = reporter
      condition[1] = occupiedId

      const baseValidation = validateProject(project)
      assert.equal(baseValidation.counts.error, 0)
      assert.equal(baseValidation.counts.warning, 0)

      const negated = mutants(project).find(
        ({ record }) =>
          record.sprite === stage.name &&
          record.blockId === ownerId &&
          record.operator === 'negate'
      )
      assert.ok(negated)
      const negatedStage = negated.project.json.targets.find(
        (target) => target.name === stage.name
      )
      assert.ok(negatedStage)
      const freshId = `${occupiedId}~1`
      const negatedOwner = requiredBlock(negatedStage, ownerId)
      const wrapper = requiredBlock(negatedStage, freshId)
      const preservedReporter = requiredBlock(negatedStage, occupiedId)
      assert.deepEqual(negatedOwner.inputs?.CONDITION, [2, freshId])
      assert.equal(wrapper.opcode, 'operator_not')
      assert.equal(wrapper.parent, ownerId)
      assert.deepEqual(wrapper.inputs?.OPERAND, [2, occupiedId])
      assert.equal(preservedReporter.opcode, reporterOpcode)
      assert.equal(preservedReporter.parent, freshId)

      const validation = validateProject(negated.project)
      assert.equal(validation.counts.error, 0)
      assert.equal(validation.counts.warning, 0)

      const { report } = await runMutationForCase({
        ...stateGameCase,
        project,
      })
      const outcome = report.outcomes.find(
        ({ record }) =>
          record.sprite === stage.name &&
          record.blockId === ownerId &&
          record.operator === 'negate'
      )
      assert.ok(outcome)
      assert.equal(outcome.killed, false)
    }
  )
})
