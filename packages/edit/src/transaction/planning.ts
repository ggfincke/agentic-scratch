// packages/edit/src/transaction/planning.ts
// pure paged next-intent planning authority over the frozen IR catalogue

import type {
  OperationKind,
  OperationPlanningRow,
  SemanticEditOperationGoalV1,
  SemanticEditOperationV1,
} from '@scratch-agent/ir/edit'
import {
  OPERATION_PLANNING_ROWS,
  parseContractDefinitionV1,
  semanticHashV1,
} from '@scratch-agent/ir/edit'

import { immutableCopyV1 as immutableCopy } from '../support/internal-values.js'

interface OperationPlanningRecipeV1
{
  readonly operationKind: OperationKind
  readonly goalFields: readonly string[]
  readonly choiceFields: readonly string[]
  readonly completedFactFields: readonly string[]
  readonly zeroChoice: boolean
  readonly choiceCardinality: 'alwaysZero' | 'dataDependent'
  readonly emptyChoiceSetHashRequired: true
  readonly recursiveCompletionRule: string
  readonly recipeSha256: string
}

interface PlannedNextIntentV1
{
  readonly operationKind: OperationKind
  readonly opId: string
  readonly plannedPrefixLength: number
  readonly plannedPrefixSha256: string
  readonly goalSha256: string
  readonly recipe: OperationPlanningRecipeV1
}

function planningRow(kind: OperationKind): OperationPlanningRow
{
  const row = OPERATION_PLANNING_ROWS.find(
    (candidate) => candidate.operationKind === kind
  )
  if (row === undefined)
  {
    throw new TypeError(`unknown semantic operation kind ${kind}`)
  }
  return row
}

function operationPlanningRecipeV1(
  kind: OperationKind
): OperationPlanningRecipeV1
{
  const row = planningRow(kind)
  const projection = {
    operationKind: row.operationKind,
    goalFields: row.goalFields,
    choiceFields: row.choiceFields,
    completedFactFields: row.completedFactFields,
    zeroChoice: row.zeroChoice,
    choiceCardinality: row.choiceCardinality,
    emptyChoiceSetHashRequired: row.emptyChoiceSetHashRequired,
    recursiveCompletionRule: row.recursiveCompletionRule,
  }
  return immutableCopy({
    ...projection,
    emptyChoiceSetHashRequired: true as const,
    recipeSha256: semanticHashV1('resolved-plan', {
      kind: 'operation-planning-recipe',
      schemaVersion: 1,
      ...projection,
    }),
  })
}

function parseExact<T>(definitionName: string, value: unknown): T
{
  const parsed = parseContractDefinitionV1<T>(definitionName, value)
  if (!parsed.ok)
  {
    throw new TypeError(
      `${definitionName} refused ${parsed.issues.length} exact contract issue(s)`
    )
  }
  return parsed.value
}

export function resolvePlannedNextIntentV1(
  plannedPrefix: readonly SemanticEditOperationV1[],
  goal: SemanticEditOperationGoalV1
): PlannedNextIntentV1
{
  const exactPrefix = plannedPrefix.map((operation) =>
    parseExact<SemanticEditOperationV1>('SemanticEditOperationV1', operation)
  )
  const exactGoal = parseExact<SemanticEditOperationGoalV1>(
    'SemanticEditOperationGoalV1',
    goal
  )
  const opIds = new Set(exactPrefix.map((operation) => operation.opId))
  if (opIds.size !== exactPrefix.length || opIds.has(exactGoal.opId))
  {
    throw new TypeError('planned-prefix and next-intent opIds must be unique')
  }
  return immutableCopy({
    operationKind: exactGoal.kind,
    opId: exactGoal.opId,
    plannedPrefixLength: exactPrefix.length,
    plannedPrefixSha256: semanticHashV1('resolved-semantic-batch', {
      kind: 'planned-prefix',
      schemaVersion: 1,
      operations: exactPrefix,
    }),
    goalSha256: semanticHashV1('resolved-plan', {
      kind: 'operation-goal',
      schemaVersion: 1,
      goal: exactGoal,
    }),
    recipe: operationPlanningRecipeV1(exactGoal.kind),
  })
}
