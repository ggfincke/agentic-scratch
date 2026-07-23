// packages/eval/src/edit-evaluation/edit-diagnostics.ts
// compare edit-only diagnostics through stable lineage while retaining raw evidence

import type { ProjectIR } from '@scratch-agent/ir'
import type { Diagnostic } from '@scratch-agent/validate'

import {
  normalizeDiagnosticFailure,
  stableFingerprint,
  type DiagnosticEvidenceLocation,
  type DiagnosticFailure,
} from '../core/failures.js'

export interface EditDiagnosticLineageV1
{
  revisionIdentity: string
  targetByIndex?: ReadonlyMap<number, string>
  blockByOwnerAndId?: ReadonlyMap<string, string>
  scriptByOwnerAndTopId?: ReadonlyMap<string, string>
  declarationByOwnerKindAndId?: ReadonlyMap<string, string>
  assetByPath?: ReadonlyMap<string, string>
  monitorById?: ReadonlyMap<string, string>
  unresolvedTargetByName?: ReadonlyMap<string, string>
}

type EditDiagnosticLocationIdentityV1 =
  | { kind: 'project' }
  | { kind: 'target'; lineageId: string }
  | { kind: 'block'; lineageId: string }
  | { kind: 'script'; lineageId: string }
  | { kind: 'declaration'; lineageId: string }
  | { kind: 'asset'; lineageId: string }
  | { kind: 'monitor'; lineageId: string }
  | { kind: 'unresolvedTarget'; lineageId: string }
  | {
      kind: 'unmapped'
      revisionIdentity: string
      raw: DiagnosticEvidenceLocation
    }

interface EditDiagnosticIdentityV1
{
  source: DiagnosticFailure['source']
  code: string
  severity: Diagnostic['severity']
  locations: EditDiagnosticLocationIdentityV1[]
}

export interface EditDiagnosticEvidenceV1
{
  fingerprint: string
  identity: EditDiagnosticIdentityV1
  raw: DiagnosticFailure
}

interface EditDiagnosticComparisonV1
{
  retained: EditDiagnosticEvidenceV1[]
  added: EditDiagnosticEvidenceV1[]
  removed: EditDiagnosticEvidenceV1[]
}

function editDiagnosticBlockKeyV1(
  targetIndex: number,
  blockId: string
): string
{
  return `${targetIndex}\u0000${blockId}`
}

const editDiagnosticScriptKeyV1 = editDiagnosticBlockKeyV1

export function editDiagnosticDeclarationKeyV1(
  targetIndex: number,
  kind: 'variable' | 'list' | 'broadcast',
  id: string
): string
{
  return `${targetIndex}\u0000${kind}\u0000${id}`
}

function unmapped(
  lineage: EditDiagnosticLineageV1,
  raw: DiagnosticEvidenceLocation
): EditDiagnosticLocationIdentityV1
{
  return {
    kind: 'unmapped',
    revisionIdentity: lineage.revisionIdentity,
    raw,
  }
}

function locationIdentity(
  location: DiagnosticEvidenceLocation,
  lineage: EditDiagnosticLineageV1
): EditDiagnosticLocationIdentityV1
{
  switch (location.kind)
  {
    case 'project':
      return { kind: 'project' }
    case 'target':
    {
      const lineageId = lineage.targetByIndex?.get(location.target.targetIndex)
      return lineageId
        ? { kind: 'target', lineageId }
        : unmapped(lineage, location)
    }
    case 'block':
    {
      const lineageId = lineage.blockByOwnerAndId?.get(
        editDiagnosticBlockKeyV1(
          location.block.target.targetIndex,
          location.block.blockId
        )
      )
      return lineageId
        ? { kind: 'block', lineageId }
        : unmapped(lineage, location)
    }
    case 'script':
    {
      const lineageId = lineage.scriptByOwnerAndTopId?.get(
        editDiagnosticScriptKeyV1(
          location.script.target.targetIndex,
          location.script.topBlockId
        )
      )
      return lineageId
        ? { kind: 'script', lineageId }
        : unmapped(lineage, location)
    }
    case 'declaration':
    {
      const declaration = location.declaration
      const lineageId = lineage.declarationByOwnerKindAndId?.get(
        editDiagnosticDeclarationKeyV1(
          declaration.declarationTarget.targetIndex,
          declaration.kind,
          declaration.id
        )
      )
      return lineageId
        ? { kind: 'declaration', lineageId }
        : unmapped(lineage, location)
    }
    case 'asset':
    {
      const lineageId = lineage.assetByPath?.get(location.path)
      return lineageId
        ? { kind: 'asset', lineageId }
        : unmapped(lineage, location)
    }
    case 'monitor':
    {
      const lineageId = lineage.monitorById?.get(location.id)
      return lineageId
        ? { kind: 'monitor', lineageId }
        : unmapped(lineage, location)
    }
    case 'unresolved-target':
    {
      const lineageId = lineage.unresolvedTargetByName?.get(location.name)
      return lineageId
        ? { kind: 'unresolvedTarget', lineageId }
        : unmapped(lineage, location)
    }
  }
}

function locationKey(location: EditDiagnosticLocationIdentityV1): string
{
  switch (location.kind)
  {
    case 'project':
      return 'project'
    case 'target':
    case 'block':
    case 'script':
    case 'declaration':
    case 'asset':
    case 'monitor':
    case 'unresolvedTarget':
      return `${location.kind}:${location.lineageId}`
    case 'unmapped':
      return `unmapped:${location.revisionIdentity}:${JSON.stringify(location.raw)}`
  }
}

function compareText(left: string, right: string): number
{
  if (left === right) return 0
  return left < right ? -1 : 1
}

function editDiagnosticEvidence(
  raw: DiagnosticFailure,
  lineage: EditDiagnosticLineageV1,
  identityFields: () => Pick<
    EditDiagnosticIdentityV1,
    'source' | 'code' | 'severity'
  >
): EditDiagnosticEvidenceV1
{
  const locations = raw.locations
    .map((location) => locationIdentity(location, lineage))
    .sort((left, right) => compareText(locationKey(left), locationKey(right)))
  const { source, code, severity } = identityFields()
  const identity: EditDiagnosticIdentityV1 = {
    source,
    code,
    severity,
    locations,
  }
  return {
    fingerprint: stableFingerprint('diagnostic', {
      source: identity.source,
      code: identity.code,
      severity: identity.severity,
      locations: identity.locations,
    }),
    identity,
    raw,
  }
}

export function normalizeEditDiagnosticV1(
  project: ProjectIR,
  source: DiagnosticFailure['source'],
  diagnostic: Diagnostic,
  lineage: EditDiagnosticLineageV1
): EditDiagnosticEvidenceV1
{
  const raw = normalizeDiagnosticFailure(project, source, diagnostic)
  return editDiagnosticEvidence(
    raw,
    lineage,
    () => ({
      source,
      code: diagnostic.code,
      severity: diagnostic.severity,
    })
  )
}

export function bindEditDiagnosticFailureV1(
  raw: DiagnosticFailure,
  lineage: EditDiagnosticLineageV1
): EditDiagnosticEvidenceV1
{
  return editDiagnosticEvidence(
    raw,
    lineage,
    () => ({
      source: raw.source,
      code: raw.code,
      severity: raw.severity,
    })
  )
}

function buckets(
  diagnostics: readonly EditDiagnosticEvidenceV1[]
): Map<string, EditDiagnosticEvidenceV1[]>
{
  const result = new Map<string, EditDiagnosticEvidenceV1[]>()
  for (const diagnostic of diagnostics)
  {
    const bucket = result.get(diagnostic.fingerprint) ?? []
    bucket.push(diagnostic)
    result.set(diagnostic.fingerprint, bucket)
  }
  return result
}

export function compareEditDiagnosticsV1(
  baseline: readonly EditDiagnosticEvidenceV1[],
  candidate: readonly EditDiagnosticEvidenceV1[]
): EditDiagnosticComparisonV1
{
  const before = buckets(baseline)
  const after = buckets(candidate)
  const retained: EditDiagnosticEvidenceV1[] = []
  const added: EditDiagnosticEvidenceV1[] = []
  const removed: EditDiagnosticEvidenceV1[] = []
  const fingerprints = new Set([...before.keys(), ...after.keys()])
  for (const fingerprint of [...fingerprints].sort())
  {
    const oldBucket = before.get(fingerprint) ?? []
    const newBucket = after.get(fingerprint) ?? []
    const retainedCount = Math.min(oldBucket.length, newBucket.length)
    retained.push(...newBucket.slice(0, retainedCount))
    added.push(...newBucket.slice(retainedCount))
    removed.push(...oldBucket.slice(retainedCount))
  }
  return { retained, added, removed }
}
