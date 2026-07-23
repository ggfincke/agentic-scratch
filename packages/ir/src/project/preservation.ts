// packages/ir/src/project/preservation.ts
// snapshot & enforce protected project surfaces independently of repair policy

import { createHash } from 'node:crypto'

import type { BlockEntry, ProjectJson, Target } from '@scratch-agent/sb3'

import { canonicalJson, type Json, type JsonObject } from '../core/json.js'
import { compareText } from '../internal/compare-text.js'
import {
  fingerprintAsset,
  TARGET_GAMEPLAY_PROPERTY_NAMES,
  type AssetFingerprint,
  type DeltaTargetIdentity,
} from './project-delta.js'
import type { ProjectIR } from './project-ir.js'
import {
  jsonPointerPart as pointerPart,
  KNOWN_BLOCK_FIELDS,
  KNOWN_MUTATION_FIELDS,
  KNOWN_ROOT_FIELDS,
  KNOWN_TARGET_FIELDS,
  projectTargetIdentity as targetIdentity,
} from './project-vocabulary.js'

interface TargetStructureSnapshot extends DeltaTargetIdentity
{
  layerOrderPresent: boolean
  layerOrder?: number
}

interface ExistingScriptLayout
{
  target: DeltaTargetIdentity
  topBlockId: string
  xPresent: boolean
  yPresent: boolean
  x?: number
  y?: number
}

interface TargetAssetMetadata
{
  target: DeltaTargetIdentity
  costumes: Json
  sounds: Json
}

interface TargetCommentsSnapshot
{
  target: DeltaTargetIdentity
  commentsPresent: boolean
  comments: Json
  blockCommentLinks: Json
}

interface TargetDeclarationsSnapshot
{
  target: DeltaTargetIdentity
  variables: Json
  listsPresent: boolean
  lists: Json
  broadcastsPresent: boolean
  broadcasts: Json
}

interface TargetGameplaySnapshot
{
  target: DeltaTargetIdentity
  properties: JsonObject
}

interface PreservationManifest
{
  assets: AssetFingerprint[]
  targetStructure: TargetStructureSnapshot[]
  targetAssetMetadata: TargetAssetMetadata[]
  declarations: TargetDeclarationsSnapshot[]
  existingScripts: ExistingScriptLayout[]
  comments: TargetCommentsSnapshot[]
  gameplay: TargetGameplaySnapshot[]
  monitorsPresent: boolean
  monitors: Json
  extensionsPresent: boolean
  extensions: Json
  meta: Json
  unknownFieldsSha256: string
}

interface AllowedTargetProperty
{
  targetIndex: number
  property: string
}

interface PreservationAllowances
{
  allowAssetChanges?: boolean
  allowExistingEditorLayoutChanges?: boolean
  allowMetadataChanges?: boolean
  allowTargetStructureChanges?: boolean
  allowedTargetProperties?: readonly AllowedTargetProperty[]
}

type PreservationViolationCode =
  | 'asset-changed'
  | 'asset-metadata-changed'
  | 'declarations-changed'
  | 'target-structure-changed'
  | 'existing-script-missing'
  | 'existing-script-layout-changed'
  | 'comments-changed'
  | 'gameplay-property-changed'
  | 'monitors-changed'
  | 'extensions-changed'
  | 'metadata-changed'
  | 'unknown-fields-changed'

type PreservationSurface =
  | 'assets'
  | 'declarations'
  | 'target-structure'
  | 'existing-editor-layout'
  | 'comments'
  | 'gameplay-configuration'
  | 'monitors'
  | 'metadata'
  | 'unknown'

interface PreservationViolation
{
  code: PreservationViolationCode
  surface: PreservationSurface
  path: string
  mandatory: boolean
  detail: string
  expected?: unknown
  actual?: unknown
}

export interface PreservationResult
{
  preserved: boolean
  violations: PreservationViolation[]
}

function asJson(value: unknown): Json
{
  return structuredClone(value) as Json
}

function equalJson(a: unknown, b: unknown): boolean
{
  return canonicalJson(a as Json) === canonicalJson(b as Json)
}

function sortedAssetFingerprints(project: ProjectIR): AssetFingerprint[]
{
  return project.assets.map(fingerprintAsset).sort((a, b) =>
  {
    const pathOrder = compareText(a.path, b.path)
    if (pathOrder !== 0) return pathOrder
    const hashOrder = compareText(a.sha256, b.sha256)
    if (hashOrder !== 0) return hashOrder
    return a.byteLength - b.byteLength
  })
}

function targetStructure(project: ProjectJson): TargetStructureSnapshot[]
{
  return project.targets.map((target, targetIndex) => ({
    ...targetIdentity(target, targetIndex),
    layerOrderPresent: Object.hasOwn(target, 'layerOrder'),
    ...(target.layerOrder !== undefined
      ? { layerOrder: target.layerOrder }
      : {}),
  }))
}

function topLevelLayout(
  target: Target,
  targetIndex: number,
  blockId: string,
  entry: BlockEntry
): ExistingScriptLayout | undefined
{
  if (Array.isArray(entry))
  {
    if (entry.length < 5) return undefined
    return {
      target: targetIdentity(target, targetIndex),
      topBlockId: blockId,
      xPresent: true,
      yPresent: true,
      x: entry[3],
      y: entry[4],
    }
  }
  if (entry.topLevel !== true || entry.shadow === true) return undefined
  return {
    target: targetIdentity(target, targetIndex),
    topBlockId: blockId,
    xPresent: Object.hasOwn(entry, 'x'),
    yPresent: Object.hasOwn(entry, 'y'),
    ...(entry.x !== undefined ? { x: entry.x } : {}),
    ...(entry.y !== undefined ? { y: entry.y } : {}),
  }
}

function existingScriptLayouts(project: ProjectJson): ExistingScriptLayout[]
{
  const layouts: ExistingScriptLayout[] = []
  project.targets.forEach((target, targetIndex) =>
  {
    for (const [blockId, entry] of Object.entries(target.blocks))
    {
      const layout = topLevelLayout(target, targetIndex, blockId, entry)
      if (layout) layouts.push(layout)
    }
  })
  return layouts.sort((a, b) =>
  {
    if (a.target.targetIndex !== b.target.targetIndex)
    {
      return a.target.targetIndex - b.target.targetIndex
    }
    return compareText(a.topBlockId, b.topBlockId)
  })
}

function targetAssetMetadata(project: ProjectJson): TargetAssetMetadata[]
{
  return project.targets.map((target, targetIndex) => ({
    target: targetIdentity(target, targetIndex),
    costumes: asJson(target.costumes),
    sounds: asJson(target.sounds),
  }))
}

function targetComments(project: ProjectJson): TargetCommentsSnapshot[]
{
  return project.targets.map((target, targetIndex) =>
  {
    const blockCommentLinks: JsonObject = {}
    for (const [blockId, entry] of Object.entries(target.blocks).sort())
    {
      if (!Array.isArray(entry) && Object.hasOwn(entry, 'comment'))
      {
        blockCommentLinks[blockId] = asJson(entry.comment ?? null)
      }
    }
    return {
      target: targetIdentity(target, targetIndex),
      commentsPresent: Object.hasOwn(target, 'comments'),
      comments: asJson(target.comments ?? {}),
      blockCommentLinks,
    }
  })
}

function targetDeclarations(
  project: ProjectJson
): TargetDeclarationsSnapshot[]
{
  return project.targets.map((target, targetIndex) => ({
    target: targetIdentity(target, targetIndex),
    variables: asJson(target.variables),
    listsPresent: Object.hasOwn(target, 'lists'),
    lists: asJson(target.lists ?? {}),
    broadcastsPresent: Object.hasOwn(target, 'broadcasts'),
    broadcasts: asJson(target.broadcasts ?? {}),
  }))
}

function targetGameplay(project: ProjectJson): TargetGameplaySnapshot[]
{
  return project.targets.map((target, targetIndex) =>
  {
    const record = target as unknown as Record<string, unknown>
    const properties: JsonObject = {}
    for (const property of TARGET_GAMEPLAY_PROPERTY_NAMES)
    {
      if (Object.hasOwn(record, property))
      {
        properties[property] = asJson(record[property])
      }
    }
    return { target: targetIdentity(target, targetIndex), properties }
  })
}

function captureUnknownFields(project: ProjectJson): JsonObject
{
  const captured: JsonObject = {}
  const root = project as unknown as Record<string, unknown>
  for (const key of Object.keys(root).sort())
  {
    if (!KNOWN_ROOT_FIELDS.has(key))
      captured[`/${pointerPart(key)}`] = asJson(root[key])
  }

  project.targets.forEach((target, targetIndex) =>
  {
    const targetRecord = target as unknown as Record<string, unknown>
    for (const key of Object.keys(targetRecord).sort())
    {
      if (!KNOWN_TARGET_FIELDS.has(key))
      {
        captured[`/targets/${targetIndex}/${pointerPart(key)}`] = asJson(
          targetRecord[key]
        )
      }
    }
    for (const [blockId, entry] of Object.entries(target.blocks))
    {
      if (Array.isArray(entry)) continue
      const blockRecord = entry as unknown as Record<string, unknown>
      for (const key of Object.keys(blockRecord).sort())
      {
        if (!KNOWN_BLOCK_FIELDS.has(key))
        {
          captured[
            `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/${pointerPart(key)}`
          ] = asJson(blockRecord[key])
        }
      }
      if (!entry.mutation) continue
      const mutation = entry.mutation as unknown as Record<string, unknown>
      for (const key of Object.keys(mutation).sort())
      {
        if (!KNOWN_MUTATION_FIELDS.has(key))
        {
          captured[
            `/targets/${targetIndex}/blocks/${pointerPart(blockId)}/mutation/${pointerPart(key)}`
          ] = asJson(mutation[key])
        }
      }
    }
  })
  return captured
}

function unknownFieldsSha256(project: ProjectJson): string
{
  const value = canonicalJson(captureUnknownFields(project))
  return createHash('sha256').update(value, 'utf-8').digest('hex')
}

export function createPreservationManifest(
  project: ProjectIR
): PreservationManifest
{
  const root = project.json as unknown as Record<string, unknown>
  return {
    assets: sortedAssetFingerprints(project),
    targetStructure: targetStructure(project.json),
    targetAssetMetadata: targetAssetMetadata(project.json),
    declarations: targetDeclarations(project.json),
    existingScripts: existingScriptLayouts(project.json),
    comments: targetComments(project.json),
    gameplay: targetGameplay(project.json),
    monitorsPresent: Object.hasOwn(root, 'monitors'),
    monitors: asJson(project.json.monitors ?? []),
    extensionsPresent: Object.hasOwn(root, 'extensions'),
    extensions: asJson(project.json.extensions ?? []),
    meta: asJson(project.json.meta),
    unknownFieldsSha256: unknownFieldsSha256(project.json),
  }
}

function scriptKey(script: ExistingScriptLayout): string
{
  return `${script.target.targetIndex}\u0000${script.topBlockId}`
}

function scriptCoordinates(script: ExistingScriptLayout): Json
{
  return {
    xPresent: script.xPresent,
    yPresent: script.yPresent,
    ...(script.x !== undefined ? { x: script.x } : {}),
    ...(script.y !== undefined ? { y: script.y } : {}),
  }
}

function assetMetadataValues(entries: TargetAssetMetadata[]): Json
{
  return entries.map((entry) => ({
    costumes: entry.costumes,
    sounds: entry.sounds,
  }))
}

function declarationValues(entries: TargetDeclarationsSnapshot[]): Json
{
  return entries.map((entry) => ({
    variables: entry.variables,
    listsPresent: entry.listsPresent,
    lists: entry.lists,
    broadcastsPresent: entry.broadcastsPresent,
    broadcasts: entry.broadcasts,
  }))
}

function commentValues(entries: TargetCommentsSnapshot[]): Json
{
  return entries.map((entry) => ({
    commentsPresent: entry.commentsPresent,
    comments: entry.comments,
    blockCommentLinks: entry.blockCommentLinks,
  }))
}

function allowedTargetPropertySet(
  allowances: PreservationAllowances
): Set<string>
{
  return new Set(
    (allowances.allowedTargetProperties ?? []).map(
      (entry) => `${entry.targetIndex}\u0000${entry.property}`
    )
  )
}

function compareGameplay(
  baseline: PreservationManifest,
  candidate: PreservationManifest,
  allowances: PreservationAllowances,
  violations: PreservationViolation[]
): void
{
  const allowed = allowedTargetPropertySet(allowances)
  const candidateTargets = new Map(
    candidate.gameplay.map((entry) => [entry.target.targetIndex, entry])
  )
  for (const expected of baseline.gameplay)
  {
    const actual = candidateTargets.get(expected.target.targetIndex)
    const properties = [
      ...new Set([
        ...Object.keys(expected.properties),
        ...Object.keys(actual?.properties ?? {}),
      ]),
    ].sort()
    for (const property of properties)
    {
      const expectedValue = expected.properties[property]
      const actualValue = actual?.properties[property]
      if (equalJson(expectedValue, actualValue)) continue
      if (allowed.has(`${expected.target.targetIndex}\u0000${property}`))
        continue
      violations.push({
        code: 'gameplay-property-changed',
        surface: 'gameplay-configuration',
        path: `/targets/${expected.target.targetIndex}/${pointerPart(property)}`,
        mandatory: false,
        detail: 'target gameplay property differs from the baseline manifest',
        expected: expectedValue,
        actual: actualValue,
      })
    }
  }
}

export function checkPreservation(
  baseline: PreservationManifest,
  candidateProject: ProjectIR,
  allowances: PreservationAllowances = {}
): PreservationResult
{
  const candidate = createPreservationManifest(candidateProject)
  const violations: PreservationViolation[] = []

  const expectedDeclarations = declarationValues(baseline.declarations)
  const actualDeclarations = declarationValues(candidate.declarations)
  if (!equalJson(expectedDeclarations, actualDeclarations))
  {
    violations.push({
      code: 'declarations-changed',
      surface: 'declarations',
      path: '/targets/*/(variables|lists|broadcasts)',
      mandatory: true,
      detail: 'declaration IDs, names, values, or storage presence changed',
      expected: expectedDeclarations,
      actual: actualDeclarations,
    })
  }

  if (!allowances.allowAssetChanges)
  {
    if (!equalJson(baseline.assets, candidate.assets))
    {
      violations.push({
        code: 'asset-changed',
        surface: 'assets',
        path: '/assets',
        mandatory: false,
        detail: 'asset path, byte length, SHA-256, or multiplicity changed',
        expected: baseline.assets,
        actual: candidate.assets,
      })
    }
    const expectedMetadata = assetMetadataValues(baseline.targetAssetMetadata)
    const actualMetadata = assetMetadataValues(candidate.targetAssetMetadata)
    if (!equalJson(expectedMetadata, actualMetadata))
    {
      violations.push({
        code: 'asset-metadata-changed',
        surface: 'assets',
        path: '/targets/*/(costumes|sounds)',
        mandatory: false,
        detail: 'costume or sound metadata changed',
        expected: expectedMetadata,
        actual: actualMetadata,
      })
    }
  }

  if (
    !allowances.allowTargetStructureChanges &&
    !equalJson(baseline.targetStructure, candidate.targetStructure)
  )
  {
    violations.push({
      code: 'target-structure-changed',
      surface: 'target-structure',
      path: '/targets',
      mandatory: false,
      detail: 'target order, identity, stage status, or layer order changed',
      expected: baseline.targetStructure,
      actual: candidate.targetStructure,
    })
  }

  if (!allowances.allowExistingEditorLayoutChanges)
  {
    const candidateScripts = new Map(
      candidate.existingScripts.map((script) => [scriptKey(script), script])
    )
    for (const expected of baseline.existingScripts)
    {
      const actual = candidateScripts.get(scriptKey(expected))
      if (!actual)
      {
        violations.push({
          code: 'existing-script-missing',
          surface: 'existing-editor-layout',
          path: `/targets/${expected.target.targetIndex}/blocks/${pointerPart(expected.topBlockId)}`,
          mandatory: false,
          detail: 'baseline top-level script is no longer top-level',
          expected,
        })
      }
      else if (
        !equalJson(scriptCoordinates(expected), scriptCoordinates(actual))
      )
      {
        violations.push({
          code: 'existing-script-layout-changed',
          surface: 'existing-editor-layout',
          path: `/targets/${expected.target.targetIndex}/blocks/${pointerPart(expected.topBlockId)}`,
          mandatory: false,
          detail: 'baseline top-level script coordinates changed',
          expected,
          actual,
        })
      }
    }
    if (
      baseline.monitorsPresent !== candidate.monitorsPresent ||
      !equalJson(baseline.monitors, candidate.monitors)
    )
    {
      violations.push({
        code: 'monitors-changed',
        surface: 'monitors',
        path: '/monitors',
        mandatory: false,
        detail: 'monitor value, visibility, or geometry changed',
        expected: baseline.monitors,
        actual: candidate.monitors,
      })
    }
  }

  const expectedComments = commentValues(baseline.comments)
  const actualComments = commentValues(candidate.comments)
  if (!equalJson(expectedComments, actualComments))
  {
    violations.push({
      code: 'comments-changed',
      surface: 'comments',
      path: '/targets/*/comments',
      mandatory: true,
      detail: 'comment content, attachment, or geometry changed',
      expected: expectedComments,
      actual: actualComments,
    })
  }

  compareGameplay(baseline, candidate, allowances, violations)

  if (!allowances.allowMetadataChanges)
  {
    if (
      baseline.extensionsPresent !== candidate.extensionsPresent ||
      !equalJson(baseline.extensions, candidate.extensions)
    )
    {
      violations.push({
        code: 'extensions-changed',
        surface: 'metadata',
        path: '/extensions',
        mandatory: false,
        detail: 'extension metadata changed',
        expected: baseline.extensions,
        actual: candidate.extensions,
      })
    }
    if (!equalJson(baseline.meta, candidate.meta))
    {
      violations.push({
        code: 'metadata-changed',
        surface: 'metadata',
        path: '/meta',
        mandatory: false,
        detail: 'project metadata changed',
        expected: baseline.meta,
        actual: candidate.meta,
      })
    }
  }

  if (baseline.unknownFieldsSha256 !== candidate.unknownFieldsSha256)
  {
    violations.push({
      code: 'unknown-fields-changed',
      surface: 'unknown',
      path: '/',
      mandatory: true,
      detail: 'canonical hash of forward-compatible fields changed',
      expected: baseline.unknownFieldsSha256,
      actual: candidate.unknownFieldsSha256,
    })
  }

  return { preserved: violations.length === 0, violations }
}
