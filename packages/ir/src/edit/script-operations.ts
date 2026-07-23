// packages/ir/src/edit/script-operations.ts
// apply exact script creation, duplication, & removal over validated graph closures

import { scratchRecordValue, type Block, type Target } from '@scratch-agent/sb3'

import type { ProjectIR } from '../project/project-ir.js'
import { jsonPointerPart as pointerPart } from '../project/project-vocabulary.js'
import type {
  SemanticEditOperationScriptAddV1,
  SemanticEditOperationScriptDuplicateV1,
  SemanticEditOperationScriptRemoveV1,
  TopLevelScriptRootV1,
} from './contracts.generated.js'
import {
  cloneGraphClosureV1,
  commitGraphAllocatorV1,
  deleteExactCommentsV1,
  deleteGraphClosureV1,
  installClonedCommentsV1,
  installGraphClosureV1,
  planGraphClosureV1,
  setTopLevelWorkspaceV1,
  type GraphInstalledClosureV1,
} from './graph-primitives.js'
import {
  compareLexicalTextV1 as compareText,
  sameStringSetV1 as sameSet,
} from './lexical-order.js'

type ScriptStructuralOperationV1 =
  | SemanticEditOperationScriptAddV1
  | SemanticEditOperationScriptDuplicateV1
  | SemanticEditOperationScriptRemoveV1

export type ResolvedScriptStructuralOperationV1 =
  | {
      readonly operation: SemanticEditOperationScriptAddV1
      readonly targetIndex: number
    }
  | {
      readonly operation: SemanticEditOperationScriptDuplicateV1
      readonly targetIndex: number
      readonly topBlockId: string
      readonly exposedCloneSources: readonly {
        readonly alias: string
        readonly sourceBlockId: string
      }[]
    }
  | {
      readonly operation: SemanticEditOperationScriptRemoveV1
      readonly targetIndex: number
      readonly topBlockId: string
      readonly dispositionCommentIds: readonly string[]
    }

export interface CuratedExistingClosureEvidenceV1
{
  readonly ok: boolean
  readonly blockIds: readonly string[]
  readonly hasOpaquePayload: boolean
  readonly safeForStructuralEdit: boolean
  readonly safeForDuplication: boolean
  readonly issues: readonly unknown[]
}

export interface ScriptOperationCatalogAdapterV1
{
  readonly lowerTopLevelRoot: (
    project: ProjectIR,
    targetIndex: number,
    root: TopLevelScriptRootV1,
    workspace: { readonly x: number; readonly y: number }
  ) => GraphInstalledClosureV1
  readonly validateExistingClosure: (
    target: Target,
    rootBlockId: string
  ) => CuratedExistingClosureEvidenceV1
}

export interface AppliedScriptStructuralOperationV1
{
  readonly opId: string
  readonly operationKind: ScriptStructuralOperationV1['kind']
  readonly targetIndex: number
  readonly topBlockId: string | null
  readonly createdTopBlockId: string | null
  readonly createdTailBlockId: string | null
  readonly createdBlockIds: readonly string[]
  readonly removedBlockIds: readonly string[]
  readonly removedCommentIds: readonly string[]
  readonly aliasBlockIds: Readonly<Record<string, string>>
  readonly clonedBlockIds: Readonly<Record<string, string>>
  readonly clonedCommentIds: Readonly<Record<string, string>>
  readonly creationKeyByBlockId: Readonly<Record<string, string>>
  readonly exactPaths: readonly string[]
  readonly postClosureSha256: string | null
}

class ScriptStructuralOperationErrorV1 extends Error
{
  constructor(
    readonly code:
      | 'edit.cardinality_mismatch'
      | 'edit.fingerprint_mismatch'
      | 'edit.graph_failed'
      | 'edit.internal_invariant'
      | 'edit.invalid_owner'
      | 'edit.invalid_shape'
      | 'edit.planning_facts_mismatch'
      | 'edit.selector_no_match'
      | 'edit.unsupported_opcode',
    message: string,
    readonly matchCount: number | null = null
  )
  {
    super(message)
    this.name = 'ScriptStructuralOperationErrorV1'
  }
}

function editError(
  code: ScriptStructuralOperationErrorV1['code'],
  message: string,
  matchCount: number | null = null
): never
{
  throw new ScriptStructuralOperationErrorV1(code, message, matchCount)
}

function target(project: ProjectIR, targetIndex: number): Target
{
  const value = project.json.targets[targetIndex]
  if (!value)
    return editError('edit.selector_no_match', 'script target is absent')
  return value
}

function graphPaths(
  targetIndex: number,
  blockIds: readonly string[],
  commentIds: readonly string[] = []
): readonly string[]
{
  return [
    ...blockIds.map(
      (blockId) => `/targets/${targetIndex}/blocks/${pointerPart(blockId)}`
    ),
    ...commentIds.map(
      (commentId) =>
        `/targets/${targetIndex}/comments/${pointerPart(commentId)}`
    ),
  ].sort(compareText)
}

function assertCuratedClosure(
  owner: Target,
  rootBlockId: string,
  expectedBlockIds: readonly string[],
  adapter: ScriptOperationCatalogAdapterV1,
  purpose: 'structuralEdit' | 'duplication'
): void
{
  const evidence = adapter.validateExistingClosure(owner, rootBlockId)
  if (
    !evidence.ok ||
    evidence.hasOpaquePayload ||
    !evidence.safeForStructuralEdit ||
    (purpose === 'duplication' && !evidence.safeForDuplication)
  )
    return editError(
      'edit.unsupported_opcode',
      `script ${purpose} requires a complete curated vanilla-core closure`
    )
  if (!sameSet(evidence.blockIds, expectedBlockIds))
    return editError(
      'edit.graph_failed',
      'catalog and graph authorities disagree on the script closure'
    )
}

function assertExpectedClosure(
  actualSha256: string,
  actualCount: number,
  expectedSha256: string,
  expectedCount: number
): void
{
  if (actualSha256 !== expectedSha256)
    return editError(
      'edit.fingerprint_mismatch',
      'script closure fingerprint changed'
    )
  if (actualCount !== expectedCount)
    return editError(
      'edit.cardinality_mismatch',
      'script closure block count changed'
    )
}

function exactDispositionComments(
  attached: readonly string[],
  disposition: SemanticEditOperationScriptRemoveV1['comments'],
  resolved: readonly string[]
): readonly string[]
{
  if (disposition.kind === 'rejectIfPresent')
  {
    if (attached.length > 0 || resolved.length > 0)
      return editError(
        'edit.planning_facts_mismatch',
        'script removal rejects attached comments'
      )
    return []
  }
  if (
    !sameSet(attached, resolved) ||
    resolved.length !== disposition.comments.length
  )
    return editError(
      'edit.planning_facts_mismatch',
      'script removal comment disposition is not the complete exact set'
    )
  return [...resolved].sort(compareText)
}

function installLoweredScript(
  owner: Target,
  lowered: GraphInstalledClosureV1,
  workspace: { readonly x: number; readonly y: number },
  adapter: ScriptOperationCatalogAdapterV1
): void
{
  installGraphClosureV1(owner, lowered)
  setTopLevelWorkspaceV1(owner, lowered.rootId, workspace)
  const plan = planGraphClosureV1(owner, 'script', lowered.rootId)
  if (!sameSet(plan.orderedBlockIds, lowered.blockIds))
    return editError(
      'edit.graph_failed',
      'lowered script does not own exactly its declared block set'
    )
  assertCuratedClosure(
    owner,
    lowered.rootId,
    plan.orderedBlockIds,
    adapter,
    'structuralEdit'
  )
}

export function applyScriptStructuralOperationV1(
  project: ProjectIR,
  resolved: ResolvedScriptStructuralOperationV1,
  adapter: ScriptOperationCatalogAdapterV1
): AppliedScriptStructuralOperationV1
{
  const { operation, targetIndex } = resolved
  const sourceOwner = target(project, targetIndex)
  const staged = structuredClone(sourceOwner)
  if (operation.kind === 'script.add')
  {
    const lowered = adapter.lowerTopLevelRoot(
      project,
      targetIndex,
      operation.root,
      operation.workspace
    )
    installLoweredScript(staged, lowered, operation.workspace, adapter)
    commitGraphAllocatorV1(project.uids, lowered)
    project.json.targets[targetIndex] = staged
    return {
      opId: operation.opId,
      operationKind: operation.kind,
      targetIndex,
      topBlockId: null,
      createdTopBlockId: lowered.rootId,
      createdTailBlockId: lowered.tailId,
      createdBlockIds: Object.freeze([...lowered.blockIds]),
      removedBlockIds: Object.freeze([]),
      removedCommentIds: Object.freeze([]),
      aliasBlockIds: Object.freeze({ ...lowered.aliasBlockIds }),
      clonedBlockIds: Object.freeze({}),
      clonedCommentIds: Object.freeze({}),
      creationKeyByBlockId: Object.freeze({
        ...lowered.creationKeyByBlockId,
      }),
      exactPaths: Object.freeze(graphPaths(targetIndex, lowered.blockIds)),
      postClosureSha256: planGraphClosureV1(staged, 'script', lowered.rootId)
        .closureSha256,
    }
  }

  const existingResolved = resolved as Exclude<
    ResolvedScriptStructuralOperationV1,
    { operation: SemanticEditOperationScriptAddV1 }
  >
  const plan = planGraphClosureV1(staged, 'script', existingResolved.topBlockId)
  const root = scratchRecordValue(
    staged.blocks,
    existingResolved.topBlockId
  ) as Block | undefined
  if (!root) return editError('edit.selector_no_match', 'script root is absent')
  if (root.opcode === 'procedures_definition')
    return editError(
      'edit.invalid_shape',
      'procedure definition scripts require procedure operations'
    )

  if (operation.kind === 'script.duplicate')
  {
    const duplicateResolved = existingResolved as Extract<
      ResolvedScriptStructuralOperationV1,
      { operation: SemanticEditOperationScriptDuplicateV1 }
    >
    assertCuratedClosure(
      staged,
      duplicateResolved.topBlockId,
      plan.orderedBlockIds,
      adapter,
      'duplication'
    )
    const commentLayout =
      operation.comments.kind === 'rejectIfPresent'
        ? ('rejectIfPresent' as const)
        : operation.comments.layout
    const clone = cloneGraphClosureV1(
      staged,
      plan,
      project.uids,
      operation.workspace,
      commentLayout
    )
    const aliases: Record<string, string> = Object.create(null)
    const seenAliases = new Set<string>()
    for (const exposure of duplicateResolved.exposedCloneSources)
    {
      if (
        seenAliases.has(exposure.alias) ||
        !plan.orderedBlockIds.includes(exposure.sourceBlockId)
      )
        return editError(
          'edit.planning_facts_mismatch',
          'clone exposure aliases or source blocks are invalid'
        )
      seenAliases.add(exposure.alias)
      aliases[exposure.alias] =
        clone.sourceToCloneBlockIds[exposure.sourceBlockId]!
    }
    if (
      duplicateResolved.exposedCloneSources.length !==
      operation.exposeClones.length
    )
      return editError(
        'edit.planning_facts_mismatch',
        'clone exposure resolution is incomplete'
      )
    installGraphClosureV1(staged, clone)
    installClonedCommentsV1(staged, clone)
    const clonedPlan = planGraphClosureV1(staged, 'script', clone.rootId)
    assertCuratedClosure(
      staged,
      clone.rootId,
      clonedPlan.orderedBlockIds,
      adapter,
      'duplication'
    )
    commitGraphAllocatorV1(project.uids, clone)
    project.json.targets[targetIndex] = staged
    return {
      opId: operation.opId,
      operationKind: operation.kind,
      targetIndex,
      topBlockId: duplicateResolved.topBlockId,
      createdTopBlockId: clone.rootId,
      createdTailBlockId: clone.tailId,
      createdBlockIds: Object.freeze([...clone.blockIds]),
      removedBlockIds: Object.freeze([]),
      removedCommentIds: Object.freeze([]),
      aliasBlockIds: Object.freeze(aliases),
      clonedBlockIds: Object.freeze({ ...clone.sourceToCloneBlockIds }),
      clonedCommentIds: Object.freeze({ ...clone.sourceToCloneCommentIds }),
      creationKeyByBlockId: Object.freeze({}),
      exactPaths: Object.freeze(
        graphPaths(
          targetIndex,
          clone.blockIds,
          Object.values(clone.sourceToCloneCommentIds)
        )
      ),
      postClosureSha256: clonedPlan.closureSha256,
    }
  }

  const removeResolved = existingResolved as Extract<
    ResolvedScriptStructuralOperationV1,
    { operation: SemanticEditOperationScriptRemoveV1 }
  >
  assertExpectedClosure(
    plan.closureSha256,
    plan.orderedBlockIds.length,
    operation.expectedClosureSha256,
    operation.expectedOwnedBlockCount
  )
  assertCuratedClosure(
    staged,
    removeResolved.topBlockId,
    plan.orderedBlockIds,
    adapter,
    'structuralEdit'
  )
  const comments = exactDispositionComments(
    plan.attachedCommentIds,
    operation.comments,
    removeResolved.dispositionCommentIds
  )
  deleteExactCommentsV1(staged, comments)
  deleteGraphClosureV1(staged, plan)
  project.json.targets[targetIndex] = staged
  return {
    opId: operation.opId,
    operationKind: operation.kind,
    targetIndex,
    topBlockId: removeResolved.topBlockId,
    createdTopBlockId: null,
    createdTailBlockId: null,
    createdBlockIds: Object.freeze([]),
    removedBlockIds: Object.freeze([...plan.orderedBlockIds]),
    removedCommentIds: Object.freeze([...comments]),
    aliasBlockIds: Object.freeze({}),
    clonedBlockIds: Object.freeze({}),
    clonedCommentIds: Object.freeze({}),
    creationKeyByBlockId: Object.freeze({}),
    exactPaths: Object.freeze(
      graphPaths(targetIndex, plan.orderedBlockIds, comments)
    ),
    postClosureSha256: null,
  }
}
