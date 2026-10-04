// packages/ir/src/authoring/workspace-validation.ts
// validate bounded logical sources before any workspace graph construction

import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  scanStrictJson,
} from '@scratch-agent/sb3'
import { canonicalProcedureSignatureV1 } from '../edit/operations/procedure-operations.js'
import { editEvidenceCanonicalSha256V1 } from '../edit/operations/target-operations.js'
import type { AnimationClipV2 } from './animation-clips.js'
import type {
  ScratchWorkspaceManifestV2,
  WorkspaceAssetV2,
  WorkspaceProcedureFileV2,
  WorkspaceScriptFileV2,
  WorkspaceSourceFileV2,
} from './workspace-types.js'

export class WorkspaceSourceErrorV2 extends Error
{
  constructor(
    readonly code: string,
    message: string
  )
  {
    super(message)
    this.name = 'WorkspaceSourceErrorV2'
  }
}

export function workspaceSourceFailureV2(path: string, message: string): never
{
  throw new WorkspaceSourceErrorV2(
    'WORKSPACE_SOURCE_INVALID',
    `${path}: ${message}`
  )
}

function object(
  value: unknown,
  path: string,
  keys: readonly string[]
): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    workspaceSourceFailureV2(path, 'expected an object')
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      workspaceSourceFailureV2(path, `unknown property ${key}`)
  return value as Record<string, unknown>
}

function array(value: unknown, path: string, maximum = 4096): unknown[]
{
  if (!Array.isArray(value) || value.length > maximum)
    workspaceSourceFailureV2(
      path,
      `expected an array with at most ${maximum} entries`
    )
  return value
}

function text(value: unknown, path: string, maximum = 256): string
{
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum ||
    value.includes('\0')
  )
    workspaceSourceFailureV2(
      path,
      `expected a nonempty string of at most ${maximum} characters`
    )
  return value
}

function identity(value: unknown, path: string): string
{
  const result = text(value, path, 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result))
    workspaceSourceFailureV2(
      path,
      'logical IDs must use letters, digits, dots, colons, dashes or underscores'
    )
  return result
}

function choice(
  value: unknown,
  path: string,
  choices: readonly unknown[]
): void
{
  if (!choices.includes(value))
    workspaceSourceFailureV2(path, `expected one of ${choices.join(', ')}`)
}

function number(
  value: unknown,
  path: string,
  integer = false,
  minimum = -1_000_000,
  maximum = 1_000_000
): void
{
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  )
    workspaceSourceFailureV2(path, 'numeric value is outside its finite bounds')
}

function scalar(value: unknown, path: string): void
{
  if (typeof value === 'number')
    number(value, path, false, -Number.MAX_VALUE, Number.MAX_VALUE)
  else if (typeof value !== 'boolean' && typeof value !== 'string')
    workspaceSourceFailureV2(
      path,
      'expected a string, finite number or boolean'
    )
  else if (typeof value === 'string' && value.length > 1024 * 1024)
    workspaceSourceFailureV2(path, 'scalar string exceeds one MiB')
}

function hash(value: unknown, path: string): void
{
  if (typeof value !== 'string' || !/^[a-f\d]{64}$/.test(value))
    workspaceSourceFailureV2(path, 'expected a lowercase SHA-256')
}

export function workspaceRelativePathV2(value: unknown, path = 'path'): string
{
  const result = text(value, path, 4096)
  if (
    result.startsWith('/') ||
    result.includes('\\') ||
    result
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..') ||
    /^[A-Za-z]:/.test(result)
  )
    workspaceSourceFailureV2(
      path,
      'expected a normalized relative path without traversal'
    )
  return result
}

function pivot(value: unknown, path: string): void
{
  const v = object(value, path, ['x', 'y'])
  number(v.x, `${path}/x`)
  number(v.y, `${path}/y`)
}

function rectangle(value: unknown, path: string): void
{
  const v = object(value, path, ['x', 'y', 'width', 'height'])
  for (const key of ['x', 'y', 'width', 'height'])
    number(
      v[key],
      `${path}/${key}`,
      true,
      key === 'width' || key === 'height' ? 1 : 0,
      4096
    )
}

function transforms(value: unknown, path: string): void
{
  for (const [i, item] of array(value, path, 16).entries())
  {
    const p = `${path}/${i}`
    const v = object(item, p, [
      'kind',
      'x',
      'y',
      'width',
      'height',
      'horizontal',
      'vertical',
      'mappings',
    ])
    if (v.kind === 'crop')
      rectangle(
        Object.fromEntries(Object.entries(v).filter(([key]) => key !== 'kind')),
        p
      )
    else if (v.kind === 'resizeNearest')
    {
      object(v, p, ['kind', 'width', 'height'])
      number(v.width, `${p}/width`, true, 1, 4096)
      number(v.height, `${p}/height`, true, 1, 4096)
    }
    else if (v.kind === 'flip')
    {
      object(v, p, ['kind', 'horizontal', 'vertical'])
      choice(v.horizontal, `${p}/horizontal`, [true, false])
      choice(v.vertical, `${p}/vertical`, [true, false])
    }
    else if (v.kind === 'paletteMap')
    {
      object(v, p, ['kind', 'mappings'])
      for (const [j, mapping] of array(
        v.mappings,
        `${p}/mappings`,
        256
      ).entries())
      {
        const row = object(mapping, `${p}/mappings/${j}`, ['from', 'to'])
        for (const key of ['from', 'to'])
        {
          const channels = array(row[key], `${p}/${key}`, 3)
          if (channels.length !== 3)
            workspaceSourceFailureV2(
              p,
              'palette entries must have three channels'
            )
          channels.forEach((channel) => number(channel, p, true, 0, 255))
        }
      }
    }
    else workspaceSourceFailureV2(p, 'unsupported PNG transform')
  }
}

function asset(value: unknown, path: string): void
{
  const v = object(value, path, [
    'id',
    'kind',
    'source',
    'slice',
    'pivot',
    'transforms',
    'slicing',
    'frames',
    'format',
    'sampleRate',
    'channels',
  ])
  identity(v.id, `${path}/id`)
  const source = object(v.source, `${path}/source`, ['path', 'expectedSha256'])
  workspaceRelativePathV2(source.path, `${path}/source/path`)
  if (source.expectedSha256 !== undefined)
    hash(source.expectedSha256, `${path}/source/expectedSha256`)
  if (v.kind === 'costume')
  {
    object(v, path, ['id', 'kind', 'source', 'slice', 'pivot', 'transforms'])
    if (v.slice !== undefined) rectangle(v.slice, `${path}/slice`)
    if (v.pivot !== undefined) pivot(v.pivot, `${path}/pivot`)
    if (v.transforms !== undefined)
      transforms(v.transforms, `${path}/transforms`)
  }
  else if (v.kind === 'costumeSheet')
  {
    object(v, path, ['id', 'kind', 'source', 'slicing', 'frames'])
    const slicing = object(v.slicing, `${path}/slicing`, [
      'kind',
      'rectangles',
      'cellWidth',
      'cellHeight',
      'columns',
      'rows',
      'startX',
      'startY',
      'spacingX',
      'spacingY',
    ])
    if (slicing.kind === 'rectangles')
    {
      object(slicing, `${path}/slicing`, ['kind', 'rectangles'])
      array(slicing.rectangles, `${path}/slicing/rectangles`).forEach(
        (entry, i) => rectangle(entry, `${path}/slicing/rectangles/${i}`)
      )
    }
    else if (slicing.kind === 'grid')
    {
      object(slicing, `${path}/slicing`, [
        'kind',
        'cellWidth',
        'cellHeight',
        'columns',
        'rows',
        'startX',
        'startY',
        'spacingX',
        'spacingY',
      ])
      for (const key of ['cellWidth', 'cellHeight', 'columns', 'rows'])
        number(slicing[key], `${path}/slicing/${key}`, true, 1, 4096)
      for (const key of ['startX', 'startY', 'spacingX', 'spacingY'])
        if (slicing[key] !== undefined)
          number(slicing[key], `${path}/slicing/${key}`, true, 0, 4096)
    }
    else workspaceSourceFailureV2(path, 'unsupported sheet slicing')
    for (const [i, frame] of array(v.frames, `${path}/frames`).entries())
    {
      const p = `${path}/frames/${i}`
      const f = object(frame, p, ['id', 'pivot', 'transforms'])
      identity(f.id, `${p}/id`)
      if (f.pivot !== undefined) pivot(f.pivot, `${p}/pivot`)
      if (f.transforms !== undefined)
        transforms(f.transforms, `${p}/transforms`)
    }
    if ((v.frames as unknown[]).length === 0)
      workspaceSourceFailureV2(path, 'sheet must declare its frames')
  }
  else if (v.kind === 'sound')
  {
    object(v, path, [
      'id',
      'kind',
      'source',
      'format',
      'sampleRate',
      'channels',
    ])
    choice(v.format, `${path}/format`, ['wav', 'mp3'])
    if (v.sampleRate !== undefined)
      number(v.sampleRate, `${path}/sampleRate`, true, 8000, 192000)
    if (v.channels !== undefined) choice(v.channels, `${path}/channels`, [1, 2])
  }
  else workspaceSourceFailureV2(path, 'unsupported asset kind')
}

function clip(value: unknown, path: string): void
{
  const v = object(value, path, ['targetId', 'id', 'name', 'loop', 'frames'])
  identity(v.targetId, `${path}/targetId`)
  identity(v.id, `${path}/id`)
  text(v.name, `${path}/name`)
  choice(v.loop, `${path}/loop`, [true, false])
  const frames = array(v.frames, `${path}/frames`)
  if (frames.length === 0)
    workspaceSourceFailureV2(path, 'clip must have frames')
  for (const [i, frame] of frames.entries())
  {
    const f = object(frame, `${path}/frames/${i}`, [
      'logicalAssetId',
      'durationMs',
    ])
    identity(f.logicalAssetId, `${path}/frames/${i}/logicalAssetId`)
    number(f.durationMs, `${path}/frames/${i}/durationMs`, true, 1, 60000)
  }
}

function binding(value: unknown, path: string): void
{
  hash(
    object(value, path, ['expectedSemanticFingerprintSha256'])
      .expectedSemanticFingerprintSha256,
    `${path}/expectedSemanticFingerprintSha256`
  )
}

function uniqueIds(
  rows: readonly unknown[],
  path: string,
  seen = new Set<string>()
): void
{
  for (const row of rows)
  {
    const id = (row as { id: string }).id
    if (seen.has(id))
      workspaceSourceFailureV2(path, `duplicate logical ID ${id}`)
    seen.add(id)
  }
}

function decode(value: unknown): unknown
{
  const limits = DEFAULT_EDIT_ADMISSION_LIMITS
  const scanned = scanStrictJson(
    value instanceof Uint8Array || typeof value === 'string'
      ? value
      : JSON.stringify(value),
    {
      maxDepth: limits.maxJsonDepth,
      maxMembersPerContainer: limits.maxMembersPerContainer,
      maxNodes: limits.maxJsonNodes,
    }
  )
  if (scanned.metrics.utf8Bytes > 10 * 1024 * 1024)
    workspaceSourceFailureV2('source', 'JSON source exceeds ten MiB')
  return scanned.value
}

export function parseScratchWorkspaceManifestV2(
  value: unknown
): ScratchWorkspaceManifestV2
{
  const v = object(decode(value), 'workspace', [
    'schemaVersion',
    'baseline',
    'targets',
    'assets',
    'clips',
    'assetManifestPaths',
    'clipManifestPaths',
    'runtimeTargets',
    'scenarios',
    'assertions',
    'output',
  ])
  choice(v.schemaVersion, 'workspace/schemaVersion', [2])
  const baseline = object(v.baseline, 'workspace/baseline', [
    'kind',
    'path',
    'expectedArtifactSha256',
  ])
  if (baseline.kind === 'greenfield')
    object(baseline, 'workspace/baseline', ['kind'])
  else if (baseline.kind === 'selectedProject')
  {
    workspaceRelativePathV2(baseline.path, 'workspace/baseline/path')
    hash(
      baseline.expectedArtifactSha256,
      'workspace/baseline/expectedArtifactSha256'
    )
  }
  else
    workspaceSourceFailureV2('workspace/baseline', 'unsupported baseline kind')
  const targets = array(v.targets, 'workspace/targets', 256)
  const declarationIds = new Set<string>()
  const procedureIds = new Set<string>()
  const scriptIds = new Set<string>()
  for (const [i, target] of targets.entries())
  {
    const path = `workspace/targets/${i}`
    const t = object(target, path, [
      'id',
      'kind',
      'name',
      'existing',
      'logicMode',
      'declarations',
      'costumes',
      'sounds',
      'procedures',
      'scripts',
      'properties',
      'currentCostume',
    ])
    identity(t.id, `${path}/id`)
    choice(t.kind, `${path}/kind`, ['stage', 'sprite'])
    text(t.name, `${path}/name`)
    if (t.existing !== undefined) binding(t.existing, `${path}/existing`)
    if (t.logicMode !== undefined)
      choice(t.logicMode, `${path}/logicMode`, ['append', 'replace'])
    const declarations = array(t.declarations ?? [], `${path}/declarations`)
    for (const [j, declaration] of declarations.entries())
    {
      const p = `${path}/declarations/${j}`
      const d = object(declaration, p, [
        'id',
        'kind',
        'name',
        'initialValue',
        'initialItems',
        'existing',
      ])
      identity(d.id, `${p}/id`)
      text(d.name, `${p}/name`)
      choice(d.kind, `${p}/kind`, ['variable', 'list', 'broadcast'])
      if (d.existing !== undefined) binding(d.existing, `${p}/existing`)
      if (d.kind === 'variable')
      {
        object(d, p, ['id', 'kind', 'name', 'initialValue', 'existing'])
        if (d.initialValue !== undefined)
          scalar(d.initialValue, `${p}/initialValue`)
      }
      else if (d.kind === 'list')
      {
        object(d, p, ['id', 'kind', 'name', 'initialItems', 'existing'])
        array(d.initialItems ?? [], `${p}/initialItems`, 25000).forEach(
          (item) => scalar(item, p)
        )
      }
      else object(d, p, ['id', 'kind', 'name', 'existing'])
    }
    uniqueIds(declarations, `${path}/declarations`, declarationIds)
    for (const key of ['costumes', 'sounds'])
      for (const [j, entry] of array(
        t[key] ?? [],
        `${path}/${key}`,
        key === 'costumes' ? 1024 : 512
      ).entries())
      {
        const p = `${path}/${key}/${j}`
        const m = object(
          entry,
          p,
          key === 'costumes'
            ? ['assetId', 'name', 'pivot']
            : ['assetId', 'name']
        )
        identity(m.assetId, `${p}/assetId`)
        text(m.name, `${p}/name`)
        if (m.pivot !== undefined) pivot(m.pivot, `${p}/pivot`)
      }
    for (const key of ['procedures', 'scripts'])
    {
      const rows = array(t[key] ?? [], `${path}/${key}`)
      rows.forEach((row, j) =>
      {
        const p = `${path}/${key}/${j}`
        const r = object(row, p, ['id', 'path'])
        identity(r.id, `${p}/id`)
        workspaceRelativePathV2(r.path, `${p}/path`)
      })
      uniqueIds(
        rows,
        `${path}/${key}`,
        key === 'scripts' ? scriptIds : procedureIds
      )
    }
    if (t.currentCostume !== undefined)
      text(t.currentCostume, `${path}/currentCostume`)
    if (t.properties !== undefined)
    {
      const properties = object(
        t.properties,
        `${path}/properties`,
        t.kind === 'stage'
          ? ['volume', 'tempo', 'videoTransparency', 'videoState']
          : [
              'volume',
              'visible',
              'x',
              'y',
              'size',
              'direction',
              'draggable',
              'rotationStyle',
            ]
      )
      for (const [key, property] of Object.entries(properties))
      {
        const p = `${path}/properties/${key}`
        if (key === 'visible' || key === 'draggable')
          choice(property, p, [true, false])
        else if (key === 'rotationStyle')
          choice(property, p, ['all around', 'left-right', "don't rotate"])
        else if (key === 'videoState')
          choice(property, p, ['on', 'off', 'on-flipped'])
        else
          number(
            property,
            p,
            false,
            ['volume', 'videoTransparency'].includes(key)
              ? 0
              : key === 'size' || key === 'tempo'
                ? 0.001
                : -1_000_000,
            ['volume', 'videoTransparency'].includes(key) ? 100 : 1_000_000
          )
      }
    }
  }
  uniqueIds(targets, 'workspace/targets')
  if (
    targets.filter((t) => (t as { kind: string }).kind === 'stage').length !== 1
  )
    workspaceSourceFailureV2('workspace/targets', 'declare exactly one stage')
  const assets = array(v.assets ?? [], 'workspace/assets')
  assets.forEach((a, i) => asset(a, `workspace/assets/${i}`))
  uniqueIds(assets, 'workspace/assets')
  const assetIdentities = new Set<string>()
  let preparedAssetCount = 0
  for (const row of assets as WorkspaceAssetV2[])
  {
    const ids =
      row.kind === 'costumeSheet'
        ? [row.id, ...row.frames.map((frame) => frame.id)]
        : [row.id]
    for (const id of ids)
    {
      if (assetIdentities.has(id))
        workspaceSourceFailureV2(
          'workspace/assets',
          `duplicate asset or sheet frame ID ${id}`
        )
      assetIdentities.add(id)
    }
    preparedAssetCount += row.kind === 'costumeSheet' ? row.frames.length : 1
  }
  if (preparedAssetCount > 4096)
    workspaceSourceFailureV2(
      'workspace/assets',
      'prepared asset count exceeds 4096'
    )
  const clips = array(v.clips ?? [], 'workspace/clips', 128)
  clips.forEach((c, i) => clip(c, `workspace/clips/${i}`))
  if (
    (clips as (AnimationClipV2 & { targetId: string })[]).reduce(
      (sum, clip) => sum + clip.frames.length,
      0
    ) > 4096
  )
    workspaceSourceFailureV2(
      'workspace/clips',
      'total animation frame references exceed 4096'
    )
  for (const key of ['assetManifestPaths', 'clipManifestPaths'])
  {
    const paths = array(v[key] ?? [], `workspace/${key}`)
    paths.forEach((p) => workspaceRelativePathV2(p, `workspace/${key}`))
    if (new Set(paths).size !== paths.length)
      workspaceSourceFailureV2(`workspace/${key}`, 'duplicate manifest path')
  }
  const runtimeTargets = array(
    v.runtimeTargets ?? [],
    'workspace/runtimeTargets',
    8
  )
  for (const [i, profile] of runtimeTargets.entries())
  {
    const p = `workspace/runtimeTargets/${i}`
    const r = object(profile, p, [
      'schemaVersion',
      'runtime',
      'scheduler',
      'tickRate',
    ])
    choice(r.schemaVersion, `${p}/schemaVersion`, [1])
    choice(r.runtime, `${p}/runtime`, ['scratch-official', 'turbowarp'])
    choice(r.scheduler, `${p}/scheduler`, ['deterministic', 'natural'])
    choice(r.tickRate, `${p}/tickRate`, [30, 60])
  }
  if (
    new Set(runtimeTargets.map((p) => editEvidenceCanonicalSha256V1(p)))
      .size !== runtimeTargets.length
  )
    workspaceSourceFailureV2(
      'workspace/runtimeTargets',
      'duplicate runtime profile'
    )
  const scenarios = array(v.scenarios ?? [], 'workspace/scenarios', 64)
  scenarios.forEach((s, i) =>
  {
    const p = `workspace/scenarios/${i}`
    const row = object(s, p, ['id', 'scenario'])
    identity(row.id, `${p}/id`)
    if (row.scenario === undefined)
      workspaceSourceFailureV2(p, 'scenario is required')
  })
  uniqueIds(scenarios, 'workspace/scenarios')
  const scenarioIds = new Set(scenarios.map((s) => (s as { id: string }).id))
  array(v.assertions ?? [], 'workspace/assertions', 4096).forEach((a, i) =>
  {
    const p = `workspace/assertions/${i}`
    const row = object(a, p, ['scenarioId', 'assertion'])
    if (
      !scenarioIds.has(identity(row.scenarioId, `${p}/scenarioId`)) ||
      row.assertion === undefined
    )
      workspaceSourceFailureV2(p, 'assertion must bind a declared scenario')
  })
  if (v.output !== undefined)
    workspaceRelativePathV2(
      object(v.output, 'workspace/output', ['path']).path,
      'workspace/output/path'
    )
  return v as unknown as ScratchWorkspaceManifestV2
}

function sequence(value: unknown, path: string): void
{
  const v = object(value, path, ['blocks'])
  const blocks = array(v.blocks, `${path}/blocks`, 25000)
  if (blocks.length === 0)
    workspaceSourceFailureV2(path, 'statement sequence must not be empty')
  blocks.forEach((b, i) => block(b, `${path}/blocks/${i}`))
}

function logicalReference(value: unknown, path: string): void
{
  const v = object(value, path, ['entityKind', 'id'])
  choice(v.entityKind, `${path}/entityKind`, ['target', 'declaration', 'media'])
  identity(v.id, `${path}/id`)
}

function input(value: unknown, path: string): void
{
  const v = object(value, path, ['valueKind', 'value'])
  if (v.valueKind === 'empty') object(v, path, ['valueKind'])
  else if (v.valueKind === 'literal') scalar(v.value, `${path}/value`)
  else if (v.valueKind === 'entity') logicalReference(v.value, `${path}/value`)
  else if (v.valueKind === 'block') block(v.value, `${path}/value`)
  else if (v.valueKind === 'statementSequence')
    sequence(v.value, `${path}/value`)
  else if (v.valueKind === 'special')
  {
    const special = object(v.value, `${path}/value`, ['domain', 'token'])
    choice(special.domain, `${path}/value/domain`, [
      'targetSelector',
      'costumeSelector',
      'backdropSelector',
    ])
    text(special.token, `${path}/value/token`)
  }
  else workspaceSourceFailureV2(path, 'unsupported input value kind')
}

function block(value: unknown, path: string): void
{
  const v = object(value, path, [
    'nodeKind',
    'opcode',
    'localAlias',
    'fields',
    'inputs',
    'procedureId',
    'arguments',
    'parameterId',
  ])
  if (v.localAlias !== undefined) identity(v.localAlias, `${path}/localAlias`)
  if (v.nodeKind === 'ordinary')
  {
    object(v, path, ['nodeKind', 'opcode', 'localAlias', 'fields', 'inputs'])
    text(v.opcode, `${path}/opcode`)
    for (const [i, entry] of array(v.fields, `${path}/fields`, 256).entries())
    {
      const p = `${path}/fields/${i}`
      const row = object(entry, p, ['name', 'value'])
      text(row.name, `${p}/name`)
      const field = object(row.value, `${p}/value`, ['valueKind', 'value'])
      if (field.valueKind === 'entity')
        logicalReference(field.value, `${p}/value/value`)
      else
      {
        choice(field.valueKind, `${p}/value/valueKind`, [
          'text',
          'number',
          'boolean',
          'enum',
        ])
        scalar(field.value, `${p}/value/value`)
        if (
          (field.valueKind === 'number' && typeof field.value !== 'number') ||
          (field.valueKind === 'boolean' && typeof field.value !== 'boolean') ||
          ((field.valueKind === 'text' || field.valueKind === 'enum') &&
            typeof field.value !== 'string')
        )
          workspaceSourceFailureV2(
            p,
            'field scalar type differs from its value kind'
          )
      }
    }
    for (const [i, entry] of array(v.inputs, `${path}/inputs`, 256).entries())
    {
      const p = `${path}/inputs/${i}`
      const row = object(entry, p, ['name', 'value'])
      text(row.name, `${p}/name`)
      input(row.value, `${p}/value`)
    }
  }
  else if (v.nodeKind === 'procedureCall')
  {
    object(v, path, ['nodeKind', 'procedureId', 'localAlias', 'arguments'])
    identity(v.procedureId, `${path}/procedureId`)
    for (const [i, entry] of array(
      v.arguments,
      `${path}/arguments`,
      64
    ).entries())
    {
      const p = `${path}/arguments/${i}`
      const row = object(entry, p, ['parameterId', 'value'])
      identity(row.parameterId, `${p}/parameterId`)
      input(row.value, `${p}/value`)
    }
  }
  else if (v.nodeKind === 'parameterReporter')
  {
    object(v, path, ['nodeKind', 'parameterId', 'localAlias'])
    identity(v.parameterId, `${path}/parameterId`)
  }
  else workspaceSourceFailureV2(path, 'unsupported block kind')
}

export function parseWorkspaceScriptFileV2(
  value: unknown
): WorkspaceScriptFileV2
{
  const v = object(decode(value), 'script', [
    'schemaVersion',
    'kind',
    'root',
    'workspace',
  ])
  choice(v.schemaVersion, 'script/schemaVersion', [2])
  choice(v.kind, 'script/kind', ['script'])
  const root = object(v.root, 'script/root', [
    'rootKind',
    'hat',
    'body',
    'value',
  ])
  if (root.rootKind === 'eventScript')
  {
    object(root, 'script/root', ['rootKind', 'hat', 'body'])
    block(root.hat, 'script/root/hat')
    if (root.body !== undefined) sequence(root.body, 'script/root/body')
  }
  else if (root.rootKind === 'statementSequence')
  {
    object(root, 'script/root', ['rootKind', 'value'])
    sequence(root.value, 'script/root/value')
  }
  else if (root.rootKind === 'expression')
  {
    object(root, 'script/root', ['rootKind', 'value'])
    block(root.value, 'script/root/value')
  }
  else workspaceSourceFailureV2('script/root', 'unsupported root kind')
  if (v.workspace !== undefined) pivot(v.workspace, 'script/workspace')
  return v as unknown as WorkspaceScriptFileV2
}

export function parseWorkspaceProcedureFileV2(
  value: unknown
): WorkspaceProcedureFileV2
{
  const v = object(decode(value), 'procedure', [
    'schemaVersion',
    'kind',
    'signature',
    'body',
    'workspace',
  ])
  choice(v.schemaVersion, 'procedure/schemaVersion', [2])
  choice(v.kind, 'procedure/kind', ['procedure'])
  const signature = object(v.signature, 'procedure/signature', [
    'parts',
    'warp',
  ])
  choice(signature.warp, 'procedure/signature/warp', [true, false])
  array(signature.parts, 'procedure/signature/parts', 129).forEach(
    (part, i) =>
    {
      const p = `procedure/signature/parts/${i}`
      const row = object(part, p, [
        'kind',
        'text',
        'localKey',
        'name',
        'parameterType',
        'defaultValue',
      ])
      if (row.kind === 'label')
      {
        object(row, p, ['kind', 'text'])
        text(row.text, `${p}/text`)
      }
      else if (row.kind === 'parameter')
      {
        object(row, p, [
          'kind',
          'localKey',
          'name',
          'parameterType',
          'defaultValue',
        ])
        identity(row.localKey, `${p}/localKey`)
        text(row.name, `${p}/name`)
        choice(row.parameterType, `${p}/parameterType`, [
          'number',
          'stringOrNumber',
          'boolean',
        ])
        scalar(row.defaultValue, `${p}/defaultValue`)
        if (
          (row.parameterType === 'number' &&
            typeof row.defaultValue !== 'number') ||
          (row.parameterType === 'boolean' &&
            typeof row.defaultValue !== 'boolean') ||
          (row.parameterType === 'stringOrNumber' &&
            typeof row.defaultValue !== 'string' &&
            typeof row.defaultValue !== 'number')
        )
          workspaceSourceFailureV2(
            p,
            'default value differs from parameter type'
          )
      }
      else workspaceSourceFailureV2(p, 'unsupported signature part')
    }
  )
  const result = v as unknown as WorkspaceProcedureFileV2
  const decoded = canonicalProcedureSignatureV1(result.signature)
  if (decoded.parameters.length > 64 || decoded.proccode.length === 0)
    workspaceSourceFailureV2(
      'procedure/signature',
      'signature exceeds standard procedure limits'
    )
  if (v.body !== undefined) sequence(v.body, 'procedure/body')
  if (v.workspace !== undefined) pivot(v.workspace, 'procedure/workspace')
  return result
}

export function parseWorkspaceAssetManifestV2(
  value: unknown
): readonly WorkspaceAssetV2[]
{
  const v = object(decode(value), 'assetManifest', [
    'schemaVersion',
    'kind',
    'assets',
  ])
  choice(v.schemaVersion, 'assetManifest/schemaVersion', [2])
  choice(v.kind, 'assetManifest/kind', ['assets'])
  const rows = array(v.assets, 'assetManifest/assets')
  rows.forEach((entry, i) => asset(entry, `assetManifest/assets/${i}`))
  uniqueIds(rows, 'assetManifest/assets')
  return rows as WorkspaceAssetV2[]
}

export function parseWorkspaceClipManifestV2(
  value: unknown
): readonly (AnimationClipV2 & { readonly targetId: string })[]
{
  const v = object(decode(value), 'clipManifest', [
    'schemaVersion',
    'kind',
    'clips',
  ])
  choice(v.schemaVersion, 'clipManifest/schemaVersion', [2])
  choice(v.kind, 'clipManifest/kind', ['clips'])
  const rows = array(v.clips, 'clipManifest/clips', 128)
  rows.forEach((entry, i) => clip(entry, `clipManifest/clips/${i}`))
  return rows as (AnimationClipV2 & { readonly targetId: string })[]
}

export function expandScratchWorkspaceManifestV2(
  manifest: ScratchWorkspaceManifestV2,
  files: readonly WorkspaceSourceFileV2[]
): ScratchWorkspaceManifestV2
{
  const byPath = new Map<string, WorkspaceSourceFileV2>()
  for (const file of files)
  {
    workspaceRelativePathV2(file.path)
    if (byPath.has(file.path))
      workspaceSourceFailureV2(file.path, 'duplicate source file')
    byPath.set(file.path, file)
  }
  const source = (path: string): Uint8Array =>
    byPath.get(path)?.bytes ??
    workspaceSourceFailureV2(path, 'declared source file is absent')
  return parseScratchWorkspaceManifestV2({
    ...manifest,
    assets: [
      ...(manifest.assets ?? []),
      ...(manifest.assetManifestPaths ?? []).flatMap((path) =>
        parseWorkspaceAssetManifestV2(source(path))
      ),
    ],
    clips: [
      ...(manifest.clips ?? []),
      ...(manifest.clipManifestPaths ?? []).flatMap((path) =>
        parseWorkspaceClipManifestV2(source(path))
      ),
    ],
  })
}
