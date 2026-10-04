// packages/edit/src/dispatch/reference-canonicalization.ts
// canonicalize retained semantic references without erasing created selectors

import {
  resolveDeclarationRefV1,
  resolveTargetRefV1,
  type BlockEntityEvidenceV1,
  type BlockRefV1,
  type DeclarationRefV1,
  type MediaRefV1,
  type ScriptEntityEvidenceV1,
  type ScriptRefV1,
  type TargetRefV1,
} from '@scratch-agent/ir/edit'

import type { ProductionOperationContextV1 } from '../transaction/production-transaction.js'
import { exactDeclarationRefV1 } from './dispatcher-primitives.js'
import {
  exactMediaRefV1,
  resolveMediaReferenceV1,
} from './media-target-dispatchers.js'
import {
  exactBlockRef,
  exactScriptRef,
  exactTargetRef,
  resolverAdapters,
} from './target-dispatchers.js'

export function canonicalBlockRefV1(
  reference: BlockRefV1,
  evidence: BlockEntityEvidenceV1
): BlockRefV1
{
  return reference.refKind === 'created' ? reference : exactBlockRef(evidence)
}

export function canonicalScriptRefV1(
  reference: ScriptRefV1,
  evidence: ScriptEntityEvidenceV1
): ScriptRefV1
{
  return reference.refKind === 'created' ? reference : exactScriptRef(evidence)
}

export function canonicalizeSemanticValueV1(
  context: ProductionOperationContextV1,
  value: unknown
): unknown
{
  if (Array.isArray(value))
    return value.map((entry) => canonicalizeSemanticValueV1(context, entry))
  if (value === null || typeof value !== 'object') return value
  const record = value as Readonly<Record<string, unknown>>
  if (
    record['entityKind'] === 'target' &&
    typeof record['refKind'] === 'string'
  )
  {
    const evidence = resolveTargetRefV1(
      context.candidate,
      record as unknown as TargetRefV1,
      resolverAdapters(context).target
    )
    return exactTargetRef(evidence)
  }
  if (
    record['entityKind'] === 'declaration' &&
    typeof record['refKind'] === 'string'
  )
  {
    const evidence = resolveDeclarationRefV1(
      context.candidate,
      record as unknown as DeclarationRefV1,
      resolverAdapters(context)
    )
    return exactDeclarationRefV1(evidence)
  }
  if (record['entityKind'] === 'media' && typeof record['refKind'] === 'string')
    return exactMediaRefV1(
      resolveMediaReferenceV1(context, record as unknown as MediaRefV1).current
    )
  const canonical: Record<string, unknown> = Object.create(null)
  for (const [key, entry] of Object.entries(record))
    canonical[key] = canonicalizeSemanticValueV1(context, entry)
  return canonical
}
