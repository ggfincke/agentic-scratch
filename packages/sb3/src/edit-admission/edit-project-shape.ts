// packages/sb3/src/edit-admission/edit-project-shape.ts
// validate known Scratch project containers & charge pre-index edit counts

import type {
  Block,
  BlockField,
  BlockInput,
  Costume,
  InputPrimitive,
  Monitor,
  ProjectJson,
  ScalarVal,
  Sound,
  Target,
  VariableEntry,
} from '../json/project-json.js'
import type { EditAdmissionLimits } from './edit-admission-limits.js'
import {
  hasScratchRecordKey,
  isScratchRecord,
  scratchRecordEntries,
  scratchRecordKeys,
  scratchRecordValue,
  type ScratchRecord,
} from '../json/scratch-record.js'

export interface EditProjectCounts
{
  targets: number
  blockRecords: number
  scriptRoots: number
  declarations: number
  listItems: number
  runtimeScalarSlots: number
  comments: number
  monitors: number
  costumes: number
  sounds: number
  indexedSemanticRecords: number
}

class EditProjectShapeError extends Error
{
  readonly path: string
  readonly observed?: number
  readonly limit?: number

  constructor(
    path: string,
    message: string,
    values: { observed?: number; limit?: number } = {}
  )
  {
    super(`${path}: ${message}`)
    this.name = 'EditProjectShapeError'
    this.path = path
    this.observed = values.observed
    this.limit = values.limit
  }
}

function pointerPart(value: string | number): string
{
  return String(value).replace(/~/gu, '~0').replace(/\//gu, '~1')
}

function child(path: string, key: string | number): string
{
  return `${path}/${pointerPart(key)}`
}

function shape(path: string, message: string): never
{
  throw new EditProjectShapeError(path, message)
}

function countLimit(
  path: string,
  label: string,
  observed: number,
  limit: number
): void
{
  if (observed <= limit) return
  throw new EditProjectShapeError(path, `${label} limit exceeded`, {
    observed,
    limit,
  })
}

function record(value: unknown, path: string): ScratchRecord
{
  if (!isScratchRecord(value))
    return shape(path, 'expected own-property record')
  return value
}

function array(value: unknown, path: string): unknown[]
{
  if (!Array.isArray(value)) return shape(path, 'expected array')
  return value
}

function required(value: ScratchRecord, key: string, path: string): unknown
{
  if (!hasScratchRecordKey(value, key))
  {
    return shape(child(path, key), 'required field is missing')
  }
  return scratchRecordValue(value, key)
}

function string(value: unknown, path: string): string
{
  if (typeof value !== 'string') return shape(path, 'expected string')
  return value
}

function boolean(value: unknown, path: string): boolean
{
  if (typeof value !== 'boolean') return shape(path, 'expected boolean')
  return value
}

function number(value: unknown, path: string): number
{
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    Object.is(value, -0) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  )
  {
    return shape(path, 'expected an edit-safe finite number')
  }
  return value
}

function integer(value: unknown, path: string): number
{
  const checked = number(value, path)
  if (!Number.isSafeInteger(checked))
    return shape(path, 'expected safe integer')
  return checked
}

function nullableNumber(value: unknown, path: string): number | null
{
  return value === null ? null : number(value, path)
}

function nullableString(value: unknown, path: string): string | null
{
  return value === null ? null : string(value, path)
}

function scalar(value: unknown, path: string): ScalarVal
{
  if (typeof value === 'string' || typeof value === 'boolean') return value
  return number(value, path)
}

function optional(
  value: ScratchRecord,
  key: string,
  path: string,
  check: (entry: unknown, entryPath: string) => unknown
): void
{
  if (!hasScratchRecordKey(value, key)) return
  check(scratchRecordValue(value, key), child(path, key))
}

function primitive(
  value: unknown,
  path: string,
  topLevel: boolean
): InputPrimitive
{
  const parts = array(value, path)
  const kind = parts[0]
  if (![4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(kind as number))
  {
    return shape(child(path, 0), 'unsupported Scratch primitive tag')
  }
  if (typeof kind !== 'number')
  {
    return shape(child(path, 0), 'primitive tag must be numeric')
  }
  if (topLevel && kind !== 12 && kind !== 13)
  {
    return shape(path, 'top-level block-map primitive must be a reporter')
  }
  if (kind >= 4 && kind <= 8)
  {
    if (parts.length !== 2) return shape(path, 'numeric primitive arity')
    if (typeof parts[1] !== 'string') number(parts[1], child(path, 1))
    return parts as InputPrimitive
  }
  if (kind === 9)
  {
    if (parts.length !== 2) return shape(path, 'color primitive arity')
    string(parts[1], child(path, 1))
    return parts as InputPrimitive
  }
  if (kind === 10)
  {
    if (parts.length !== 2) return shape(path, 'text primitive arity')
    if (typeof parts[1] !== 'string') number(parts[1], child(path, 1))
    return parts as InputPrimitive
  }
  if (kind === 11)
  {
    if (parts.length !== 3) return shape(path, 'broadcast primitive arity')
    string(parts[1], child(path, 1))
    string(parts[2], child(path, 2))
    return parts as InputPrimitive
  }
  if (parts.length < 3 || parts.length > 5)
  {
    return shape(path, 'variable/list reporter arity')
  }
  string(parts[1], child(path, 1))
  string(parts[2], child(path, 2))
  for (let index = 3; index < parts.length; index++)
  {
    number(parts[index], child(path, index))
  }
  return parts as InputPrimitive
}

function blockInput(value: unknown, path: string): BlockInput
{
  const parts = array(value, path)
  if (parts.length < 2 || parts.length > 3)
  {
    return shape(path, 'block input must contain two or three slots')
  }
  if (parts[0] !== 1 && parts[0] !== 2 && parts[0] !== 3)
  {
    return shape(child(path, 0), 'invalid input shadow mode')
  }
  for (let index = 1; index < parts.length; index++)
  {
    const slot = parts[index]
    if (typeof slot === 'string' || slot === null) continue
    primitive(slot, child(path, index), false)
  }
  return parts as BlockInput
}

function blockField(value: unknown, path: string): BlockField
{
  const parts = array(value, path)
  if (parts.length !== 1 && parts.length !== 2)
  {
    return shape(path, 'block field must contain one or two values')
  }
  const fieldValue = parts[0]
  if (fieldValue !== null && typeof fieldValue !== 'string')
  {
    number(fieldValue, child(path, 0))
  }
  if (parts.length === 2)
  {
    nullableString(parts[1], child(path, 1))
  }
  return parts as BlockField
}

function mutation(value: unknown, path: string): void
{
  const item = record(value, path)
  if (
    string(required(item, 'tagName', path), child(path, 'tagName')) !==
    'mutation'
  )
  {
    shape(child(path, 'tagName'), 'expected literal mutation')
  }
  array(required(item, 'children', path), child(path, 'children'))
  for (const key of [
    'proccode',
    'argumentids',
    'argumentnames',
    'argumentdefaults',
  ])
  {
    optional(item, key, path, string)
  }
  for (const key of ['warp', 'hasnext'])
  {
    optional(item, key, path, (entry, entryPath) =>
    {
      if (typeof entry !== 'boolean' && typeof entry !== 'string')
      {
        shape(entryPath, 'expected boolean or string')
      }
    })
  }
}

function block(value: unknown, path: string): Block
{
  const item = record(value, path)
  string(required(item, 'opcode', path), child(path, 'opcode'))
  for (const key of ['next', 'parent'])
  {
    optional(item, key, path, nullableString)
  }
  optional(item, 'inputs', path, (entry, entryPath) =>
  {
    for (const [key, input] of scratchRecordEntries(record(entry, entryPath)))
    {
      blockInput(input, child(entryPath, key))
    }
  })
  optional(item, 'fields', path, (entry, entryPath) =>
  {
    for (const [key, field] of scratchRecordEntries(record(entry, entryPath)))
    {
      blockField(field, child(entryPath, key))
    }
  })
  optional(item, 'shadow', path, boolean)
  optional(item, 'topLevel', path, boolean)
  optional(item, 'x', path, number)
  optional(item, 'y', path, number)
  optional(item, 'comment', path, string)
  optional(item, 'mutation', path, mutation)
  return item as unknown as Block
}

function variableEntry(value: unknown, path: string): VariableEntry
{
  const parts = array(value, path)
  if (parts.length !== 2 && parts.length !== 3)
  {
    return shape(path, 'variable entry must contain two or three values')
  }
  string(parts[0], child(path, 0))
  scalar(parts[1], child(path, 1))
  if (parts.length === 3 && parts[2] !== true)
  {
    return shape(child(path, 2), 'cloud variable marker must be true')
  }
  return parts as VariableEntry
}

function costume(value: unknown, path: string): Costume
{
  const item = record(value, path)
  for (const key of ['assetId', 'name', 'dataFormat'])
  {
    string(required(item, key, path), child(path, key))
  }
  optional(item, 'md5ext', path, string)
  optional(item, 'bitmapResolution', path, integer)
  optional(item, 'rotationCenterX', path, number)
  optional(item, 'rotationCenterY', path, number)
  return item as unknown as Costume
}

function sound(value: unknown, path: string): Sound
{
  const item = record(value, path)
  for (const key of ['assetId', 'name', 'dataFormat'])
  {
    string(required(item, key, path), child(path, key))
  }
  optional(item, 'md5ext', path, string)
  optional(item, 'format', path, string)
  optional(item, 'rate', path, integer)
  optional(item, 'sampleCount', path, integer)
  return item as unknown as Sound
}

function comment(value: unknown, path: string): void
{
  const item = record(value, path)
  string(required(item, 'text', path), child(path, 'text'))
  optional(item, 'blockId', path, nullableString)
  optional(item, 'minimized', path, boolean)
  optional(item, 'x', path, nullableNumber)
  optional(item, 'y', path, nullableNumber)
  optional(item, 'width', path, number)
  optional(item, 'height', path, number)
}

function target(
  value: unknown,
  path: string,
  limits: EditAdmissionLimits,
  counts: EditProjectCounts
): Target
{
  const item = record(value, path)
  boolean(required(item, 'isStage', path), child(path, 'isStage'))
  string(required(item, 'name', path), child(path, 'name'))

  const variablesPath = child(path, 'variables')
  const variables = record(required(item, 'variables', path), variablesPath)
  for (const [key, entry] of scratchRecordEntries(variables))
  {
    variableEntry(entry, child(variablesPath, key))
    counts.declarations++
    counts.runtimeScalarSlots++
  }

  if (hasScratchRecordKey(item, 'lists'))
  {
    const listsPath = child(path, 'lists')
    const lists = record(scratchRecordValue(item, 'lists'), listsPath)
    for (const [key, entry] of scratchRecordEntries(lists))
    {
      const entryPath = child(listsPath, key)
      const parts = array(entry, entryPath)
      if (parts.length !== 2) shape(entryPath, 'list entry arity')
      string(parts[0], child(entryPath, 0))
      const items = array(parts[1], child(entryPath, 1))
      countLimit(
        child(entryPath, 1),
        'list items',
        items.length,
        limits.maxListItemsPerList
      )
      items.forEach((entryValue, index) =>
        scalar(entryValue, child(child(entryPath, 1), index))
      )
      counts.declarations++
      counts.listItems += items.length
      counts.runtimeScalarSlots += items.length
    }
  }

  if (hasScratchRecordKey(item, 'broadcasts'))
  {
    const broadcastsPath = child(path, 'broadcasts')
    for (const [key, entry] of scratchRecordEntries(
      record(scratchRecordValue(item, 'broadcasts'), broadcastsPath)
    ))
    {
      string(entry, child(broadcastsPath, key))
      counts.declarations++
    }
  }

  const blocksPath = child(path, 'blocks')
  const blocks = record(required(item, 'blocks', path), blocksPath)
  for (const [key, entry] of scratchRecordEntries(blocks))
  {
    const entryPath = child(blocksPath, key)
    counts.blockRecords++
    if (Array.isArray(entry))
    {
      primitive(entry, entryPath, true)
      counts.scriptRoots++
    }
    else
    {
      const checked = block(entry, entryPath)
      if (checked.topLevel === true) counts.scriptRoots++
    }
  }

  if (hasScratchRecordKey(item, 'comments'))
  {
    const commentsPath = child(path, 'comments')
    for (const [key, entry] of scratchRecordEntries(
      record(scratchRecordValue(item, 'comments'), commentsPath)
    ))
    {
      comment(entry, child(commentsPath, key))
      counts.comments++
    }
  }

  const costumesPath = child(path, 'costumes')
  const costumes = array(required(item, 'costumes', path), costumesPath)
  countLimit(
    costumesPath,
    'costumes per target',
    costumes.length,
    limits.maxCostumesPerTarget
  )
  costumes.forEach((entry, index) => costume(entry, child(costumesPath, index)))
  counts.costumes += costumes.length

  const soundsPath = child(path, 'sounds')
  const sounds = array(required(item, 'sounds', path), soundsPath)
  countLimit(
    soundsPath,
    'sounds per target',
    sounds.length,
    limits.maxSoundsPerTarget
  )
  sounds.forEach((entry, index) => sound(entry, child(soundsPath, index)))
  counts.sounds += sounds.length

  optional(item, 'currentCostume', path, integer)
  optional(item, 'volume', path, number)
  optional(item, 'layerOrder', path, integer)
  optional(item, 'tempo', path, number)
  optional(item, 'videoTransparency', path, number)
  optional(item, 'videoState', path, string)
  optional(item, 'textToSpeechLanguage', path, nullableString)
  optional(item, 'visible', path, boolean)
  optional(item, 'x', path, number)
  optional(item, 'y', path, number)
  optional(item, 'size', path, number)
  optional(item, 'direction', path, number)
  optional(item, 'draggable', path, boolean)
  optional(item, 'rotationStyle', path, string)
  return item as unknown as Target
}

function monitor(
  value: unknown,
  path: string,
  limits: EditAdmissionLimits,
  counts: EditProjectCounts
): Monitor
{
  const item = record(value, path)
  for (const key of ['id', 'mode', 'opcode'])
  {
    string(required(item, key, path), child(path, key))
  }
  nullableString(required(item, 'spriteName', path), child(path, 'spriteName'))
  const paramsPath = child(path, 'params')
  const params = record(required(item, 'params', path), paramsPath)
  const paramKeys = scratchRecordKeys(params)
  countLimit(
    paramsPath,
    'monitor params',
    paramKeys.length,
    limits.maxMonitorParamsPerMonitor
  )
  for (const key of paramKeys)
  {
    scalar(scratchRecordValue(params, key), child(paramsPath, key))
    counts.runtimeScalarSlots++
  }
  const monitorValue = required(item, 'value', path)
  if (Array.isArray(monitorValue))
  {
    countLimit(
      child(path, 'value'),
      'monitor list snapshot items',
      monitorValue.length,
      limits.maxMonitorListSnapshotItemsPerMonitor
    )
    monitorValue.forEach((entry, index) =>
      scalar(entry, child(child(path, 'value'), index))
    )
    counts.runtimeScalarSlots += monitorValue.length
  }
  else if (monitorValue !== null)
  {
    scalar(monitorValue, child(path, 'value'))
    counts.runtimeScalarSlots++
  }
  optional(item, 'width', path, number)
  optional(item, 'height', path, number)
  optional(item, 'x', path, nullableNumber)
  optional(item, 'y', path, nullableNumber)
  optional(item, 'visible', path, boolean)
  optional(item, 'sliderMin', path, number)
  optional(item, 'sliderMax', path, number)
  optional(item, 'isDiscrete', path, boolean)
  return item as unknown as Monitor
}

export function validateEditProjectShape(
  value: unknown,
  limits: EditAdmissionLimits
): { project: ProjectJson; counts: EditProjectCounts }
{
  const root = record(value, '$')
  const targetsPath = '$/targets'
  const targets = array(required(root, 'targets', '$'), targetsPath)
  const counts: EditProjectCounts = {
    targets: targets.length,
    blockRecords: 0,
    scriptRoots: 0,
    declarations: 0,
    listItems: 0,
    runtimeScalarSlots: 0,
    comments: 0,
    monitors: 0,
    costumes: 0,
    sounds: 0,
    indexedSemanticRecords: 0,
  }
  countLimit(targetsPath, 'targets', targets.length, limits.maxTargets)
  targets.forEach((entry, index) =>
    target(entry, child(targetsPath, index), limits, counts)
  )

  if (hasScratchRecordKey(root, 'monitors'))
  {
    const monitorsPath = '$/monitors'
    const monitors = array(scratchRecordValue(root, 'monitors'), monitorsPath)
    countLimit(
      monitorsPath,
      'monitor records',
      monitors.length,
      limits.maxMonitorRecords
    )
    monitors.forEach((entry, index) =>
      monitor(entry, child(monitorsPath, index), limits, counts)
    )
    counts.monitors = monitors.length
  }
  if (hasScratchRecordKey(root, 'extensions'))
  {
    const extensionsPath = '$/extensions'
    array(scratchRecordValue(root, 'extensions'), extensionsPath).forEach(
      (entry, index) => string(entry, child(extensionsPath, index))
    )
  }
  const metaPath = '$/meta'
  const meta = record(required(root, 'meta', '$'), metaPath)
  string(required(meta, 'semver', metaPath), child(metaPath, 'semver'))
  for (const key of ['vm', 'agent', 'origin'])
  {
    optional(meta, key, metaPath, string)
  }

  countLimit(
    '$/targets',
    'block records',
    counts.blockRecords,
    limits.maxBlockRecords
  )
  countLimit(
    '$/targets',
    'script roots',
    counts.scriptRoots,
    limits.maxScriptRoots
  )
  countLimit(
    '$/targets',
    'declaration records',
    counts.declarations,
    limits.maxDeclarationRecords
  )
  countLimit(
    '$/targets',
    'comment records',
    counts.comments,
    limits.maxCommentRecords
  )
  countLimit(
    '$/targets',
    'costume records',
    counts.costumes,
    limits.maxCostumeRecords
  )
  countLimit(
    '$/targets',
    'sound records',
    counts.sounds,
    limits.maxSoundRecords
  )
  countLimit(
    '$',
    'runtime scalar slots',
    counts.runtimeScalarSlots,
    limits.maxRuntimeScalarSlots
  )
  counts.indexedSemanticRecords =
    counts.targets +
    counts.declarations +
    counts.blockRecords +
    counts.scriptRoots +
    counts.comments +
    counts.monitors +
    counts.costumes +
    counts.sounds
  countLimit(
    '$',
    'indexed semantic records',
    counts.indexedSemanticRecords,
    limits.maxIndexedSemanticRecords
  )
  return { project: root as unknown as ProjectJson, counts }
}
