// tests/repair/contracts.test.ts
// keep proposal schema, parsing, & execution aligned for closed repair values

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  applySemanticPatch,
  buildClicker,
  projectArtifactSha256,
  ROTATION_STYLES,
  targetRef,
  type RotationStyle,
} from '@scratch-agent/ir'

import {
  parseRepairProposal,
  proposalSchema,
} from '@scratch-agent/repair'

function rotationProposal(
  baseArtifactSha256: string,
  target: ReturnType<typeof targetRef>,
  from: string,
  to: string
): object
{
  return {
    schemaVersion: 1,
    requestId: `rotation-${to}`,
    baseArtifactSha256,
    rationale: 'exercise the closed rotation style contract',
    expectedEffect: `set rotation style to ${to}`,
    operations: [
      {
        kind: 'setTargetProperty',
        opId: 'set-rotation-style',
        target,
        property: 'rotationStyle',
        from,
        to,
      },
    ],
  }
}

function spriteAt(project: ReturnType<typeof buildClicker>, index: number)
{
  const target = project.json.targets[index]
  assert.ok(target)
  assert.equal(target.isStage, false)
  if (target.isStage) throw new Error('expected sprite target')
  return target
}

test('rotation style schema, parser, & executor share one closed domain', async () =>
{
  const schema = proposalSchema(['setTargetProperty'], 1, 0, [
    'rotationStyle',
  ]) as {
    properties: {
      operations: {
        items: {
          oneOf: Array<{
            oneOf: Array<{
              properties: {
                property: { const: string }
                from: { enum: string[] }
                to: { enum: string[] }
              }
            }>
          }>
        }
      }
    }
  }
  const rotationSchema = schema.properties.operations.items.oneOf[0]!.oneOf[0]!
  assert.equal(rotationSchema.properties.property.const, 'rotationStyle')
  assert.deepEqual(rotationSchema.properties.from.enum, ROTATION_STYLES)
  assert.deepEqual(rotationSchema.properties.to.enum, ROTATION_STYLES)

  const transitions: Array<[RotationStyle, RotationStyle]> = [
    ['all around', 'left-right'],
    ['left-right', "don't rotate"],
    ["don't rotate", 'all around'],
  ]
  for (const [from, to] of transitions)
  {
    const project = buildClicker()
    const spriteIndex = project.json.targets.findIndex(
      (target) => !target.isStage
    )
    assert.ok(spriteIndex >= 0)
    const sprite = spriteAt(project, spriteIndex)
    sprite.rotationStyle = from
    const baseArtifactSha256 = await projectArtifactSha256(project)
    const proposal = rotationProposal(
      baseArtifactSha256,
      targetRef(project, spriteIndex),
      from,
      to
    )
    const parsed = parseRepairProposal(proposal)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) continue

    const applied = await applySemanticPatch(project, parsed.patch, {
      intentLimits: {
        maxOpsPerProposal: 1,
        maxNewBlocksPerProposal: 0,
        allowedOpKinds: ['setTargetProperty'],
      },
      preservation: { allowedTargetProperties: ['rotationStyle'] },
    })
    assert.equal(applied.ok, true)
    if (!applied.ok) continue
    assert.equal(spriteAt(applied.candidate, spriteIndex).rotationStyle, to)
  }

  const project = buildClicker()
  const spriteIndex = project.json.targets.findIndex(
    (target) => !target.isStage
  )
  assert.ok(spriteIndex >= 0)
  const invalid = rotationProposal(
    await projectArtifactSha256(project),
    targetRef(project, spriteIndex),
    spriteAt(project, spriteIndex).rotationStyle ?? 'all around',
    'sideways'
  )
  assert.equal(parseRepairProposal(invalid).ok, false)
  const invalidRecord = invalid as {
    baseArtifactSha256: string
    operations: unknown[]
  }
  const rejected = await applySemanticPatch(project, {
    schemaVersion: 1,
    baseArtifactSha256: invalidRecord.baseArtifactSha256,
    operations: invalidRecord.operations,
  })
  assert.equal(rejected.ok, false)
  if (!rejected.ok)
  {
    assert.equal(rejected.applied, false)
    assert.equal(rejected.violations[0]?.code, 'invalid-payload')
  }
})

test('target property schema & parser share stage applicability', async () =>
{
  const schema = proposalSchema(['setTargetProperty'], 1, 0, [
    'x',
    'volume',
  ]) as {
    properties: {
      operations: {
        items: {
          oneOf: Array<{
            oneOf: Array<{
              properties: {
                property: { const: string }
                target: {
                  $ref?: string
                  allOf?: Array<{
                    properties?: { isStage: { const: boolean } }
                  }>
                }
              }
            }>
          }>
        }
      }
    }
  }
  const propertySchemas = schema.properties.operations.items.oneOf[0]!.oneOf
  const xSchema = propertySchemas.find(
    (entry) => entry.properties.property.const === 'x'
  )!
  const volumeSchema = propertySchemas.find(
    (entry) => entry.properties.property.const === 'volume'
  )!
  assert.equal(
    xSchema.properties.target.allOf?.[1]?.properties?.isStage.const,
    false
  )
  assert.equal(volumeSchema.properties.target.$ref, '#/$defs/targetRef')

  const project = buildClicker()
  const stageIndex = project.json.targets.findIndex((target) => target.isStage)
  assert.ok(stageIndex >= 0)
  const stage = project.json.targets[stageIndex]!
  const baseProposal = {
    schemaVersion: 1,
    baseArtifactSha256: await projectArtifactSha256(project),
    rationale: 'exercise target applicability',
    expectedEffect: 'change a target property',
  }
  const stageTarget = targetRef(project, stageIndex)
  const stageX = {
    ...baseProposal,
    requestId: 'stage-x',
    operations: [
      {
        kind: 'setTargetProperty',
        opId: 'set-stage-x',
        target: stageTarget,
        property: 'x',
        from: 0,
        to: 1,
      },
    ],
  }
  assert.equal(parseRepairProposal(stageX).ok, false)

  const stageVolume = {
    ...baseProposal,
    requestId: 'stage-volume',
    operations: [
      {
        kind: 'setTargetProperty',
        opId: 'set-stage-volume',
        target: stageTarget,
        property: 'volume',
        from: stage.volume,
        to: stage.volume,
      },
    ],
  }
  assert.equal(parseRepairProposal(stageVolume).ok, true)
})
