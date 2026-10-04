// packages/ir/src/edit/semantic-index/sensing-property-policy.ts
// share selected-target sensing builtins & exact name interpretation

import {
  isBlockEntry,
  primaryInputSlot,
  scratchRecordValue,
  type Block,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'
import { deepFreeze } from '../support/immutable.js'

export const STANDARD_SCALAR_FIELD_NORMALIZATION_V2 = deepFreeze({
  schemaVersion: 1,
  acceptedTuples: ['scalar', 'scalar-and-null-id'],
  semanticContent: 'scalar-value-only',
})

export function standardScalarFieldValueV2(
  field: unknown
): string | number | undefined
{
  if (
    !Array.isArray(field) ||
    (field.length !== 1 && !(field.length === 2 && field[1] === null))
  )
    return undefined
  const value: unknown = field[0]
  return typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? value
    : undefined
}

export const SENSING_PROPERTY_BUILTIN_POLICY_V1 = deepFreeze({
  schemaVersion: 1,
  stage: ['background #', 'backdrop #', 'backdrop name', 'volume'],
  sprite: [
    'x position',
    'y position',
    'direction',
    'costume #',
    'costume name',
    'size',
    'volume',
  ],
  variableScope: 'selected-target-only',
  variableSerialization: 'refuse-selected-kind-builtin-name',
})

export function sensingPropertyIsBuiltinV1(
  target: { readonly isStage: boolean },
  property: string
): boolean
{
  return (
    target.isStage
      ? SENSING_PROPERTY_BUILTIN_POLICY_V1.stage
      : SENSING_PROPERTY_BUILTIN_POLICY_V1.sprite
  ).includes(property)
}

export function sensingPropertyIsKnownBuiltinV1(property: string): boolean
{
  return (
    SENSING_PROPERTY_BUILTIN_POLICY_V1.stage.includes(property) ||
    SENSING_PROPERTY_BUILTIN_POLICY_V1.sprite.includes(property)
  )
}

export function sensingPropertyLocalVariableIdsV1(
  target: Pick<Target, 'variables'>,
  property: string
): readonly string[]
{
  return Object.entries(target.variables).flatMap(([id, variable]) =>
    variable[0] === property ? [id] : []
  )
}

export function sensingPropertyTargetCandidatesV1<
  Target extends { readonly name: string; readonly isStage: boolean },
>(targets: readonly Target[], name: string): readonly Target[]
{
  return targets.filter((target) =>
    name === '_stage_'
      ? target.isStage
      : !target.isStage && target.name === name
  )
}

export function selectedSensingPropertyTargetIndexV1(
  project: ProjectJson,
  ownerTargetIndex: number,
  block: Block
): number | null
{
  const owner = project.targets[ownerTargetIndex]
  const input = block.inputs && scratchRecordValue(block.inputs, 'OBJECT')
  if (!owner || !input) return null
  const slot = primaryInputSlot(input)
  const menu =
    typeof slot === 'string'
      ? scratchRecordValue(owner.blocks, slot)
      : undefined
  if (!isBlockEntry(menu) || menu.opcode !== 'sensing_of_object_menu')
    return null
  const field = menu.fields && scratchRecordValue(menu.fields, 'OBJECT')
  if (!field || (typeof field[0] !== 'string' && typeof field[0] !== 'number'))
    return null
  const candidates = sensingPropertyTargetCandidatesV1(
    project.targets,
    String(field[0])
  )
  return candidates.length === 1
    ? project.targets.indexOf(candidates[0]!)
    : null
}

export function sensingPropertyPairIssueV1(
  project: ProjectJson,
  ownerTargetIndex: number,
  block: Block
): string | null
{
  const property = block.fields && scratchRecordValue(block.fields, 'PROPERTY')
  if (!property || typeof property[0] !== 'string') return null
  const selected = selectedSensingPropertyTargetIndexV1(
    project,
    ownerTargetIndex,
    block
  )
  if (selected === null)
    return sensingPropertyIsKnownBuiltinV1(property[0])
      ? null
      : 'variable sensing property requires an exact selected target'
  const target = project.targets[selected]!
  if (sensingPropertyIsBuiltinV1(target, property[0])) return null
  // other-kind tokens remain representable when the selected target owns that variable
  const variables = sensingPropertyLocalVariableIdsV1(target, property[0])
  if (variables.length === 1) return null
  if (variables.length > 1)
    return 'variable sensing property is ambiguous on the selected target'
  return sensingPropertyIsKnownBuiltinV1(property[0])
    ? 'builtin sensing property does not belong to the selected target kind'
    : 'variable sensing property is absent from the selected target'
}
