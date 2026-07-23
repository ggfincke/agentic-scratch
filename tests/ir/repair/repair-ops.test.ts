// tests/ir/repair/repair-ops.test.ts
// protect repair transaction isolation, impact accounting, & preservation

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  applySemanticPatch,
  blockRef,
  buildStateGame,
  checkPreservation,
  cloneProjectForRepair,
  computeProjectDelta,
  createPreservationManifest,
  projectArtifactSha256,
  variableRef,
} from '@scratch-agent/ir'
import type { Block, ProjectJson } from '@scratch-agent/sb3'
import { validateProject } from '@scratch-agent/validate'

import type { SemanticPatch } from '@scratch-agent/ir'

function stateGameRefs(): {
  project: ReturnType<typeof buildStateGame>
  heroIndex: number
  scoreChangeId: string
  flagHatId: string
  scoreId: string
}
{
  const project = buildStateGame()
  const heroIndex = project.json.targets.findIndex(
    (target) => target.name === 'Hero'
  )
  const hero = project.json.targets[heroIndex]!
  const scoreChangeId = Object.entries(hero.blocks).find(
    ([, entry]) =>
      !Array.isArray(entry) &&
      entry.opcode === 'data_changevariableby' &&
      entry.fields?.VARIABLE?.[0] === 'score'
  )?.[0]
  const stage = project.json.targets[0]!
  const flagHatId = Object.entries(stage.blocks).find(
    ([, entry]) =>
      !Array.isArray(entry) && entry.opcode === 'event_whenflagclicked'
  )?.[0]
  const scoreId = Object.entries(stage.variables).find(
    ([, entry]) => entry[0] === 'score'
  )?.[0]
  assert.ok(scoreChangeId)
  assert.ok(flagHatId)
  assert.ok(scoreId)
  return { project, heroIndex, scoreChangeId, flagHatId, scoreId }
}

function literalPatch(
  project: ReturnType<typeof buildStateGame>,
  heroIndex: number,
  scoreChangeId: string,
  baseArtifactSha256: string,
  opId = 'score-zero'
): object
{
  return {
    schemaVersion: 1,
    baseArtifactSha256,
    operations: [
      {
        kind: 'replaceLiteral',
        opId,
        block: blockRef(project, heroIndex, scoreChangeId),
        inputName: 'VALUE',
        expectedOpcode: 'data_changevariableby',
        from: { kind: 'number', value: '1' },
        to: { kind: 'number', value: '0' },
      },
    ],
  }
}

test('repair transactions isolate rollback, enforce impact & prove preservation', async () =>
{
  const { project, heroIndex, scoreChangeId, flagHatId, scoreId } =
    stateGameRefs()
  const baselineJson = JSON.stringify(project.json)
  const baselineAssets = project.assets.map((asset) =>
    Uint8Array.from(asset.bytes)
  )
  const baseArtifactSha256 = await projectArtifactSha256(project)

  const applied = await applySemanticPatch(
    project,
    literalPatch(project, heroIndex, scoreChangeId, baseArtifactSha256),
    {
      intentLimits: {
        maxOpsPerProposal: 1,
        maxNewBlocksPerProposal: 0,
        allowedOpKinds: ['replaceLiteral'],
      },
      impactLimits: {
        maxTouchedTargets: 1,
        maxTouchedScripts: 1,
        maxChangedAuthoredBlocks: 1,
        maxChangedBlockRecords: 1,
      },
    }
  )
  assert.equal(applied.ok, true)
  if (!applied.ok) return
  assert.deepEqual(applied.delta.summary, {
    touchedTargets: 1,
    touchedScripts: 1,
    addedBlocks: 0,
    removedBlocks: 0,
    changedBlockRecords: 1,
    changedAuthoredBlocks: 1,
    graphLinkOnlyBlocks: 0,
    changedDeclarations: 0,
    changedGameplayProperties: 0,
    changedExistingEditorLayout: 0,
    changedAssets: 0,
    changedProjectMetadata: 0,
    changedUnknownFields: 0,
  })
  assert.equal(applied.preservation.preserved, true)
  assert.equal(validateProject(applied.candidate).counts.error, 0)
  assert.equal(JSON.stringify(project.json), baselineJson)
  assert.notEqual(applied.candidate.json, project.json)
  for (const [index, bytes] of baselineAssets.entries())
  {
    assert.deepEqual(
      Array.from(project.assets[index]!.bytes),
      Array.from(bytes)
    )
    assert.deepEqual(
      Array.from(applied.candidate.assets[index]!.bytes),
      Array.from(bytes)
    )
    assert.notEqual(
      applied.candidate.assets[index]!.bytes,
      project.assets[index]!.bytes
    )
  }

  const exactAttributionCandidate = cloneProjectForRepair(project)
  const exactBlock = exactAttributionCandidate.json.targets[heroIndex]!.blocks[
    scoreChangeId
  ] as Block
  exactBlock.opcode = 'data_setvariableto'
  const exactLiteral = exactBlock.inputs!.VALUE![1]
  assert.ok(Array.isArray(exactLiteral))
  exactLiteral[1] = '2'
  const exactDelta = computeProjectDelta(project, exactAttributionCandidate, [
    {
      operationId: 'opcode-only',
      blocks: [
        {
          targetIndex: heroIndex,
          blockId: scoreChangeId,
          relativePaths: ['/opcode'],
        },
      ],
    },
    {
      operationId: 'literal-only',
      blocks: [
        {
          targetIndex: heroIndex,
          blockId: scoreChangeId,
          relativePaths: ['/inputs/VALUE/1'],
        },
      ],
    },
  ])
  const exactChanges = exactDelta.targets
    .flatMap((target) => target.blockChanges)
    .find((block) => block.blockId === scoreChangeId)?.changes
  assert.ok(exactChanges)
  assert.deepEqual(
    exactChanges.find((change) => change.path.endsWith('/opcode'))
      ?.operationIds,
    ['opcode-only']
  )
  assert.deepEqual(
    exactChanges.find((change) => change.path.includes('/inputs/VALUE/1/1'))
      ?.operationIds,
    ['literal-only']
  )

  const rollback = await applySemanticPatch(
    project,
    {
      schemaVersion: 1,
      baseArtifactSha256,
      operations: [
        ...(
          literalPatch(
            project,
            heroIndex,
            scoreChangeId,
            baseArtifactSha256,
            'first'
          ) as { operations: object[] }
        ).operations,
        {
          kind: 'replaceLiteral',
          opId: 'later-failure',
          block: blockRef(project, heroIndex, scoreChangeId),
          inputName: 'VALUE',
          expectedOpcode: 'data_changevariableby',
          from: { kind: 'number', value: '1' },
          to: { kind: 'number', value: '2' },
        },
      ],
    },
    {
      intentLimits: {
        maxOpsPerProposal: 2,
        maxNewBlocksPerProposal: 0,
        allowedOpKinds: ['replaceLiteral'],
      },
    }
  )
  assert.equal(rollback.ok, false)
  if (rollback.ok) return
  assert.equal(rollback.violations[0]?.opId, 'later-failure')
  assert.equal(JSON.stringify(project.json), baselineJson)

  const insertion = {
    schemaVersion: 1,
    baseArtifactSha256,
    operations: [
      {
        kind: 'insertStatementsAfter',
        opId: 'insert-reset',
        anchor: blockRef(project, 0, flagHatId),
        expectedOpcode: 'event_whenflagclicked',
        statements: [
          {
            opcode: 'data_setvariableto',
            fields: { VARIABLE: variableRef(project, 0, scoreId) },
            inputs: { VALUE: { kind: 'number', value: 0 } },
          },
        ],
      },
    ],
  }
  const nestedInsertion = structuredClone(insertion) as SemanticPatch
  const nestedOperation = nestedInsertion.operations[0]
  assert.equal(nestedOperation?.kind, 'insertStatementsAfter')
  if (!nestedOperation || nestedOperation.kind !== 'insertStatementsAfter')
    return
  nestedOperation.statements = [
    {
      opcode: 'control_if',
      fields: {},
      inputs: {
        CONDITION: {
          kind: 'boolean',
          block: {
            opcode: 'operator_gt',
            fields: {},
            inputs: {
              OPERAND1: { kind: 'number', value: 1 },
              OPERAND2: { kind: 'number', value: 0 },
            },
          },
        },
        SUBSTACK: {
          kind: 'substack',
          blocks: nestedOperation.statements,
        },
      },
    },
  ]
  const intentRejected = await applySemanticPatch(project, nestedInsertion, {
    intentLimits: {
      maxOpsPerProposal: 1,
      maxNewBlocksPerProposal: 2,
      allowedOpKinds: ['insertStatementsAfter'],
    },
  })
  assert.equal(intentRejected.ok, false)
  if (intentRejected.ok) return
  assert.ok(
    intentRejected.violations.some(
      (violation) => violation.code === 'intent-budget'
    )
  )

  const impactRejected = await applySemanticPatch(project, insertion, {
    intentLimits: {
      maxOpsPerProposal: 1,
      maxNewBlocksPerProposal: 1,
      allowedOpKinds: ['insertStatementsAfter'],
    },
    impactLimits: {
      maxTouchedTargets: 1,
      maxTouchedScripts: 1,
      maxChangedAuthoredBlocks: 1,
      maxChangedBlockRecords: 2,
    },
  })
  assert.equal(impactRejected.ok, false)
  if (impactRejected.ok) return
  assert.equal(impactRejected.applied, true)
  if (!impactRejected.applied) return
  assert.ok(impactRejected.delta)
  if (!impactRejected.delta) return
  assert.ok(
    impactRejected.violations.some(
      (violation) => violation.code === 'impact-budget'
    )
  )
  assert.equal(impactRejected.delta.summary.changedBlockRecords, 3)
  assert.ok(impactRejected.candidateBytes.byteLength > 0)
  assert.equal(
    createHash('sha256').update(impactRejected.candidateBytes).digest('hex'),
    impactRejected.candidateArtifactSha256
  )
  assert.notEqual(impactRejected.candidateArtifactSha256, baseArtifactSha256)
  assert.equal(JSON.stringify(project.json), baselineJson)
  for (const [index, bytes] of baselineAssets.entries())
  {
    assert.deepEqual(
      Array.from(project.assets[index]!.bytes),
      Array.from(bytes)
    )
  }

  const overRewrite = cloneProjectForRepair(project)
  const topId = Object.entries(
    overRewrite.json.targets[heroIndex]!.blocks
  ).find(([, entry]) => !Array.isArray(entry) && entry.topLevel === true)?.[0]
  assert.ok(topId)
  const top = overRewrite.json.targets[heroIndex]!.blocks[topId] as Block
  top.x = (top.x ?? 0) + 20
  top.comment = 'tampered-comment-link'
  overRewrite.assets[0]!.bytes[0] = overRewrite.assets[0]!.bytes[0]! ^ 0xff
  const root = overRewrite.json as ProjectJson & Record<string, unknown>
  for (let index = 0; index < 105; index++) root[`unknown${index}`] = index
  const delta = computeProjectDelta(project, overRewrite, [
    {
      operationId: 'broad-edit',
      blocks: [{ targetIndex: heroIndex, blockId: topId }],
      assetPaths: [overRewrite.assets[0]!.path],
    },
  ])
  assert.equal(delta.complete, true)
  assert.ok(delta.summary.changedExistingEditorLayout > 0)
  assert.ok(delta.summary.changedAssets > 0)
  assert.ok(delta.summary.changedUnknownFields >= 105)
  assert.ok(delta.protectedChanges.some((change) => change.class === 'asset'))
  assert.ok(
    delta.protectedChanges.some(
      (change) => change.class === 'existing-editor-layout'
    )
  )
  assert.ok(delta.protectedChanges.some((change) => change.class === 'unknown'))
  const preservation = checkPreservation(
    createPreservationManifest(project),
    overRewrite
  )
  assert.equal(preservation.preserved, false)
  assert.ok(
    preservation.violations.some(
      (violation) => violation.code === 'asset-changed'
    )
  )
  assert.ok(
    preservation.violations.some(
      (violation) => violation.code === 'existing-script-layout-changed'
    )
  )
  assert.ok(
    preservation.violations.some(
      (violation) => violation.code === 'comments-changed'
    )
  )
  assert.ok(
    preservation.violations.some(
      (violation) => violation.code === 'unknown-fields-changed'
    )
  )
  const commentOnlyProtection = checkPreservation(
    createPreservationManifest(project),
    overRewrite,
    {
      allowAssetChanges: true,
      allowExistingEditorLayoutChanges: true,
    }
  )
  assert.ok(
    commentOnlyProtection.violations.some(
      (violation) =>
        violation.code === 'comments-changed' && violation.mandatory
    )
  )
})
