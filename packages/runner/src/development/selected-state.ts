// packages/runner/src/development/selected-state.ts
// validate bounded selectors & resolve declared numeric probes without Scratch coercion

import type {
  ProfileStateProbeV1,
  ProfileRuntimeFrameV1,
  ProfileNumericSelectorV1,
  ProfileNumericProbeResultV1,
} from './profile-browser-types.js'

export const SELECTED_STATE_PROBE_LIMITS_V1 = Object.freeze({
  maxTargets: 32,
  maxListItems: 32,
  maxDeclarationSelectors: 64,
  maxTargetIndex: 999,
  maxIdentifierLength: 256,
})

export class SelectedStateProbeValidationErrorV1 extends Error
{
  constructor(
    readonly kind: 'shape' | 'policy',
    message: string
  )
  {
    super(message)
    this.name = 'SelectedStateProbeValidationErrorV1'
  }
}

function object(value: unknown, keys: readonly string[]): void
{
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new SelectedStateProbeValidationErrorV1(
      'shape',
      'object contains unsupported fields or an invalid shape'
    )
}

function text(value: unknown, role: string): void
{
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > SELECTED_STATE_PROBE_LIMITS_V1.maxIdentifierLength ||
    value.includes('\0')
  )
    throw new SelectedStateProbeValidationErrorV1(
      'policy',
      `${role} must be a nonempty bounded string`
    )
}
export function validateSelectedStateProbeV1(
  input: ProfileStateProbeV1
): ProfileStateProbeV1
{
  object(input, ['targets', 'maxListItems'])
  const maximum =
    input.maxListItems === undefined
      ? SELECTED_STATE_PROBE_LIMITS_V1.maxListItems
      : input.maxListItems
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    maximum > SELECTED_STATE_PROBE_LIMITS_V1.maxListItems
  )
    throw new SelectedStateProbeValidationErrorV1(
      'policy',
      'selected lists allow at most 32 items'
    )
  if (
    input.targets !== undefined &&
    (!Array.isArray(input.targets) ||
      input.targets.length > SELECTED_STATE_PROBE_LIMITS_V1.maxTargets)
  )
    throw new SelectedStateProbeValidationErrorV1(
      'policy',
      'selected state allows at most 32 target selectors'
    )
  const indexes = new Set<number>()
  let slots = 0
  for (const target of input.targets ?? [])
  {
    object(target, [
      'targetIndex',
      'variableIds',
      'listIds',
      'includeClones',
      'cloneKeyVariableId',
    ])
    if (
      !Number.isSafeInteger(target.targetIndex) ||
      target.targetIndex < 0 ||
      target.targetIndex > SELECTED_STATE_PROBE_LIMITS_V1.maxTargetIndex ||
      indexes.has(target.targetIndex)
    )
      throw new SelectedStateProbeValidationErrorV1(
        'policy',
        'invalid or duplicate selected target'
      )
    indexes.add(target.targetIndex)
    if (
      target.includeClones !== undefined &&
      typeof target.includeClones !== 'boolean'
    )
      throw new SelectedStateProbeValidationErrorV1(
        'policy',
        'includeClones must be boolean'
      )
    for (const key of ['variableIds', 'listIds'] as const)
    {
      const values = target[key] === undefined ? [] : target[key]
      if (
        !Array.isArray(values) ||
        values.length >
          SELECTED_STATE_PROBE_LIMITS_V1.maxDeclarationSelectors ||
        new Set(values).size !== values.length
      )
        throw new SelectedStateProbeValidationErrorV1(
          'policy',
          'invalid or duplicate selected declaration'
        )
      for (const value of values) text(value, 'declaration ID')
      slots += values.length
    }
    if (target.cloneKeyVariableId !== undefined)
    {
      text(target.cloneKeyVariableId, 'declared clone key')
      if (target.includeClones !== true)
        throw new SelectedStateProbeValidationErrorV1(
          'policy',
          'a clone key requires includeClones:true'
        )
    }
  }
  if (slots > SELECTED_STATE_PROBE_LIMITS_V1.maxDeclarationSelectors)
    throw new SelectedStateProbeValidationErrorV1(
      'policy',
      'selected state allows at most 64 declaration selectors'
    )
  return structuredClone(input)
}

export const validateProfileStateProbeV1 = validateSelectedStateProbeV1

export function resolveProfileNumericProbeV1(
  frame: ProfileRuntimeFrameV1,
  selector: ProfileNumericSelectorV1
): ProfileNumericProbeResultV1
{
  const unavailable = (issue: string): ProfileNumericProbeResultV1 => ({
    status: 'unavailable',
    value: null,
    issue,
  })
  if (
    !selector ||
    typeof selector !== 'object' ||
    !Number.isSafeInteger(selector.targetIndex) ||
    selector.targetIndex < 0 ||
    Object.keys(selector).some(
      (key) => !['targetIndex', 'instance', 'property'].includes(key)
    )
  )
    return unavailable('invalid numeric probe selector')
  const instance = selector.instance ?? 'original'
  let matches = frame.targets.filter(
    (row) => row.targetIndex === selector.targetIndex
  )
  if (instance === 'original')
    matches = matches.filter((row) => row.instance === 'original')
  else
  {
    if (
      !instance ||
      typeof instance !== 'object' ||
      Object.keys(instance).length !== 1 ||
      !Object.hasOwn(instance, 'cloneKey')
    )
      return unavailable('invalid clone selector')
    const key = instance.cloneKey
    if (!(
      typeof key === 'boolean' ||
      (typeof key === 'number' && Number.isFinite(key)) ||
      (typeof key === 'string' && key.length > 0 && key.length <= 256)
    ))
      return unavailable('invalid declared clone key')
    matches = matches.filter(
      (row) => row.instance === 'clone' && row.cloneKey === key
    )
    if (
      matches.some((row) => row.cloneIdentity === 'ambiguous') ||
      matches.length > 1
    )
      return {
        status: 'ambiguous',
        value: null,
        issue: 'declared clone key is ambiguous',
      }
    matches = matches.filter((row) => row.cloneIdentity === 'declared')
  }
  if (matches.length === 0)
    return unavailable('selected runtime instance is unavailable')
  if (matches.length > 1)
    return {
      status: 'ambiguous',
      value: null,
      issue: 'selected runtime instance is ambiguous',
    }
  const row = matches[0]!
  let value: unknown
  if (typeof selector.property === 'string')
  {
    if (
      ![
        'x',
        'y',
        'direction',
        'size',
        'volume',
        'costumeIndexOneBased',
      ].includes(selector.property)
    )
      return unavailable('unsupported numeric property')
    value = row[selector.property]
  }
  else
  {
    if (
      !selector.property ||
      typeof selector.property !== 'object' ||
      Object.keys(selector.property).length !== 1 ||
      typeof selector.property.variableId !== 'string'
    )
      return unavailable('invalid variable selector')
    const scalar = row.variables[selector.property.variableId]
    if (
      scalar &&
      !Array.isArray(scalar) &&
      'scalarKind' in scalar &&
      scalar.scalarKind === 'number' &&
      scalar.value &&
      typeof scalar.value === 'object' &&
      'numberKind' in scalar.value &&
      (scalar.value.numberKind === 'finite' ||
        scalar.value.numberKind === 'negativeZero')
    )
      value = scalar.value.numberKind === 'finite' ? scalar.value.value : -0
  }
  if (typeof value !== 'number' || !Number.isFinite(value))
    return unavailable('selected value is not a finite number')
  return { status: 'available', value, issue: null }
}
