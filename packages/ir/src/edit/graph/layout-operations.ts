// packages/ir/src/edit/graph/layout-operations.ts
// apply script workspace movement independently from structural graph edits

import { isBlockEntry } from '@scratch-agent/sb3'

import type { ProjectIR } from '../../project/project-ir.js'
import type { SemanticEditOperationScriptMoveWorkspaceV1 } from '../contracts.generated.js'
import { ownRecordValue } from '../support/own-record.js'

interface ResolvedScriptWorkspaceOperationV1
{
  readonly operation: SemanticEditOperationScriptMoveWorkspaceV1
  readonly targetIndex: number
  readonly topBlockId: string
}

interface ScriptWorkspaceOperationResultV1
{
  readonly opId: string
  readonly operationKind: 'script.moveWorkspace'
  readonly targetIndex: number
  readonly topBlockId: string
}

function editError(code: string, message: string): Error
{
  return Object.assign(new Error(message), { code })
}

function matchesOptional(
  value: number | undefined,
  expected:
    | { readonly state: 'missing' }
    | {
        readonly state: 'value'
        readonly value: number
      }
): boolean
{
  return expected.state === 'missing'
    ? value === undefined
    : Object.is(value, expected.value)
}

export function applyScriptWorkspaceOperationV1(
  project: ProjectIR,
  resolved: ResolvedScriptWorkspaceOperationV1
): ScriptWorkspaceOperationResultV1
{
  const owner = project.json.targets[resolved.targetIndex]
  const block = ownRecordValue(owner?.blocks, resolved.topBlockId)
  if (!isBlockEntry(block) || block.topLevel !== true || block.shadow === true)
    throw editError('edit.selector_no_match', 'top-level script is absent')
  if (
    !matchesOptional(block.x, resolved.operation.expected.x) ||
    !matchesOptional(block.y, resolved.operation.expected.y)
  )
    throw editError('edit.planning_facts_mismatch', 'script workspace changed')
  block.x = resolved.operation.changes.x
  block.y = resolved.operation.changes.y
  return {
    opId: resolved.operation.opId,
    operationKind: 'script.moveWorkspace',
    targetIndex: resolved.targetIndex,
    topBlockId: resolved.topBlockId,
  }
}
