// packages/eval/src/development/selected-state.ts
// compare bounded semantic state using declared clone keys instead of runtime object ids

import { createHash } from 'node:crypto'
import type { ProfileRuntimeFrameV1 } from '@scratch-agent/runner'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

export interface DevelopmentStateDivergenceV1
{
  tick: number
  path: string
  expected: unknown
  observed: unknown
}

export interface DevelopmentStateComparisonV1
{
  disposition: 'matched' | 'diverged' | 'unavailable'
  expectedSha256: string | null
  observedSha256: string | null
  firstDivergence: DevelopmentStateDivergenceV1 | null
  issues: readonly string[]
}

export interface DevelopmentStateComparisonOptionsV1
{
  excludeSystemTimer?: boolean
}

function finite(value: unknown, name: string): number
{
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`selected ${name} is unavailable or non-finite`)
  return Object.is(value, -0) ? 0 : value
}

function count(value: unknown, name: string): number
{
  const number = finite(value, name)
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000)
    throw new Error(`selected ${name} exceeds its bounded count`)
  return number
}

function boundedText(value: unknown, name: string): string
{
  if (typeof value !== 'string' || value.length > 1024)
    throw new Error(
      `selected ${name} is unavailable or exceeds its string bound`
    )
  return value
}

function boolean(value: unknown, name: string): boolean
{
  if (typeof value !== 'boolean')
    throw new Error(`selected ${name} is unavailable`)
  return value
}

export function projectDevelopmentSelectedStateV1(
  frame: ProfileRuntimeFrameV1,
  options: DevelopmentStateComparisonOptionsV1 = {}
): unknown
{
  if (!frame || !Array.isArray(frame.targets) || frame.targets.length > 32)
    throw new Error(
      'selected target state is unavailable or exceeds its instance bound'
    )
  if (
    !Array.isArray(frame.issues) ||
    frame.issues.length > 128 ||
    frame.issues.length > 0
  )
    throw new Error(
      `selected state is unavailable: ${(frame.issues ?? []).join('; ')}`
    )
  const targets: Record<string, unknown> = Object.create(null)
  for (const target of frame.targets)
  {
    const targetIndex = count(target.targetIndex, 'target index')
    let key = `${targetIndex}/original`
    if (target.instance === 'clone')
    {
      if (target.cloneIdentity !== 'declared' || target.cloneKey === null)
        throw new Error(
          `clone association ${target.cloneIdentity} on target ${targetIndex} is unavailable`
        )
      if (typeof target.cloneKey === 'string')
      {
        if (boundedText(target.cloneKey, 'clone key').length === 0)
          throw new Error('a declared clone key cannot be empty')
      }
      else if (typeof target.cloneKey === 'number')
        finite(target.cloneKey, 'clone key')
      else boolean(target.cloneKey, 'clone key')
      key = `${targetIndex}/clone/${JSON.stringify([typeof target.cloneKey, target.cloneKey])}`
    }
    else if (
      target.instance !== 'original' ||
      target.cloneIdentity !== 'original'
    )
      throw new Error('selected runtime instance has no supported association')
    if (Object.hasOwn(targets, key))
      throw new Error(`duplicate selected runtime association ${key}`)
    if (
      !target.variables ||
      !target.lists ||
      Object.keys(target.variables).length > 64 ||
      Object.keys(target.lists).length > 64
    )
      throw new Error('selected declarations exceed their bounded projection')
    const effects: Record<string, number> = Object.create(null)
    if (!target.effects || Object.keys(target.effects).length > 32)
      throw new Error('selected effects are unavailable or exceed their bound')
    for (const [name, value] of Object.entries(target.effects))
      effects[boundedText(name, 'effect name')] = finite(value, 'effect')
    for (const [id, value] of Object.entries(target.lists))
    {
      boundedText(id, 'list id')
      const list = value as { items?: unknown; length?: unknown } | null
      if (
        !list ||
        !Array.isArray(list.items) ||
        list.items.length > 128 ||
        count(list.length, 'list length') < list.items.length
      )
        throw new Error(
          'selected list prefix is unavailable or exceeds its bound'
        )
    }
    targets[key] = {
      targetIndex,
      name: boundedText(target.name, 'target name'),
      instance: target.instance,
      cloneKey:
        typeof target.cloneKey === 'number'
          ? finite(target.cloneKey, 'clone key')
          : target.cloneKey,
      x: finite(target.x, 'x'),
      y: finite(target.y, 'y'),
      direction: finite(target.direction, 'direction'),
      size: finite(target.size, 'size'),
      volume: finite(target.volume, 'volume'),
      rotationStyle: boundedText(target.rotationStyle, 'rotation style'),
      draggable: boolean(target.draggable, 'draggable'),
      visible: boolean(target.visible, 'visible'),
      effects,
      costumeIndexOneBased: count(target.costumeIndexOneBased, 'costume index'),
      costumeName: boundedText(target.costumeName, 'costume name'),
      variables: target.variables,
      lists: target.lists,
    }
  }
  if (
    !frame.cloneCounts ||
    !Array.isArray(frame.cloneCounts.byTarget) ||
    frame.cloneCounts.byTarget.length > 1024
  )
    throw new Error('selected clone counts are unavailable')
  const byTarget = frame.cloneCounts.byTarget
    .map((entry) => ({
      targetIndex: count(entry.targetIndex, 'clone count target'),
      count: count(entry.count, 'target clone count'),
    }))
    .sort((left, right) => left.targetIndex - right.targetIndex)
  if (
    new Set(byTarget.map((entry) => entry.targetIndex)).size !== byTarget.length
  )
    throw new Error('selected clone counts contain duplicate targets')
  const projected = {
    tick: count(frame.tick, 'tick'),
    ...(options.excludeSystemTimer
      ? {}
      : { timer: finite(frame.timer, 'timer') }),
    cloneCounts: {
      total: count(frame.cloneCounts.total, 'clone count'),
      byTarget,
    },
    targets,
  }
  canonicalJsonBytesV1(projected)
  return projected
}

function sha256(value: unknown): string
{
  return createHash('sha256').update(canonicalJsonBytesV1(value)).digest('hex')
}

function difference(
  expected: unknown,
  observed: unknown,
  path: string
): Omit<DevelopmentStateDivergenceV1, 'tick'> | null
{
  if (Object.is(expected, observed)) return null
  if (Array.isArray(expected) && Array.isArray(observed))
  {
    if (expected.length !== observed.length)
      return {
        path: `${path}.length`,
        expected: expected.length,
        observed: observed.length,
      }
    for (let index = 0; index < expected.length; index++)
    {
      const result = difference(
        expected[index],
        observed[index],
        `${path}[${index}]`
      )
      if (result) return result
    }
    return null
  }
  if (
    expected &&
    observed &&
    typeof expected === 'object' &&
    typeof observed === 'object' &&
    !Array.isArray(expected) &&
    !Array.isArray(observed)
  )
  {
    const left = expected as Record<string, unknown>
    const right = observed as Record<string, unknown>
    for (const key of [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort())
    {
      const nextPath = `${path}[${JSON.stringify(key)}]`
      if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key))
        return {
          path: nextPath,
          expected: left[key] ?? null,
          observed: right[key] ?? null,
        }
      const result = difference(left[key], right[key], nextPath)
      if (result) return result
    }
    return null
  }
  return { path, expected, observed }
}

export function compareDevelopmentSelectedStateV1(
  expected: ProfileRuntimeFrameV1,
  observed: ProfileRuntimeFrameV1,
  options: DevelopmentStateComparisonOptionsV1 = {}
): DevelopmentStateComparisonV1
{
  try
  {
    const left = projectDevelopmentSelectedStateV1(expected, options)
    const right = projectDevelopmentSelectedStateV1(observed, options)
    const first = difference(left, right, '$')
    return {
      disposition: first ? 'diverged' : 'matched',
      expectedSha256: sha256(left),
      observedSha256: sha256(right),
      firstDivergence: first ? { tick: expected.tick, ...first } : null,
      issues: [],
    }
  }
  catch (error)
  {
    return {
      disposition: 'unavailable',
      expectedSha256: null,
      observedSha256: null,
      firstDivergence: null,
      issues: [
        error instanceof Error
          ? error.message
          : 'selected state is unavailable',
      ],
    }
  }
}
