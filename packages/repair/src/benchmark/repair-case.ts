// packages/repair/src/benchmark/repair-case.ts
// registered immutable repair objectives, acceptance summaries, & case hashes

import { createHash } from 'node:crypto'

import { canonicalJson, type Json } from '@scratch-agent/ir'
import {
  validateRepairTestSpecs,
  type Assertion,
  type RepairTestSpec,
} from '@scratch-agent/eval'
import type { Scenario } from '@scratch-agent/runner'

import { compareText } from '../internal/compare-text.js'
import { isPlainRecord as record } from '../internal/records.js'
import { validateRepairPolicy, type RepairPolicy } from '../policy/policy.js'
import {
  cloneRepairMultimodalRequirement,
  validateRepairMultimodalRequirement,
  type RepairMultimodalRequirementV1,
} from '../multimodal/multimodal.js'

export interface RepairCase
{
  id: string
  objective: string
  tests: RepairTestSpec[]
  policy: RepairPolicy
  multimodal?: RepairMultimodalRequirementV1
}

interface AcceptanceTestSummary
{
  id: string
  name: string
  role: RepairTestSpec['role']
  lanes: Array<'vm' | 'model' | 'browser'>
  scenario: Scenario
  assertions: Assertion[]
  visualAssertions: Assertion[]
  modelIds: string[]
  modelHashes: Array<{ id: string; sha256: string }>
}

export interface AcceptanceContract
{
  caseId: string
  objective: string
  tests: AcceptanceTestSummary[]
  multimodal?: RepairMultimodalRequirementV1
}

export interface RepairCaseIssue
{
  code: string
  message: string
}

export type ParsedRepairCase =
  | { ok: true; repairCase: RepairCase }
  | { ok: false; issues: RepairCaseIssue[] }

const CASE_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/

type LoadedModel = NonNullable<RepairTestSpec['model']>['programModels'][number]

function modelProjection(model: LoadedModel): object
{
  const edge = (value: LoadedModel['edges'][number]) => ({
    id: value.id,
    label: value.label,
    from: value.from,
    to: value.to,
    forceTestAtTicks: value.forceTestAtTicks,
    forceTestAfterTicks: value.forceTestAfterTicks,
    conditions: value.conditions,
    effects: value.effects,
    inputs: value.inputs,
  })
  return {
    id: model.id,
    usage: model.usage,
    startNodeId: model.startNodeId,
    stopAllNodeIds: [...model.stopAllNodeIds].sort(compareText),
    nodes: [...model.nodes.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([id, node]) => ({
        id,
        label: node.label,
        isStop: node.isStop,
        outgoing: node.outgoing.map(edge),
      })),
    edges: model.edges.map(edge),
    initialStorage: model.initialStorage,
    startTrigger: model.startTrigger,
    maxDurationTicks: model.maxDurationTicks,
  }
}

function models(test: RepairTestSpec): LoadedModel[]
{
  if (!test.model) return []
  return [
    ...test.model.programModels,
    ...test.model.endModels,
    ...test.model.userModels,
  ]
}

function modelHash(model: LoadedModel): string
{
  return createHash('sha256')
    .update(canonicalJson(modelProjection(model) as Json))
    .digest('hex')
}

function testIdentity(test: RepairTestSpec): object
{
  return {
    id: test.id,
    name: test.name,
    role: test.role,
    scenario: test.scenario,
    assertions: test.asserts,
    visualAssertions: test.visual ?? [],
    models: models(test).map(modelProjection),
    baseline: test.baseline,
  }
}

export function acceptanceContract(repairCase: RepairCase): AcceptanceContract
{
  return {
    caseId: repairCase.id,
    objective: repairCase.objective,
    tests: repairCase.tests.map((test) =>
    {
      const loadedModels = models(test)
      return {
        id: test.id,
        name: test.name,
        role: test.role,
        lanes: [
          'vm' as const,
          ...(test.model ? (['model'] as const) : []),
          ...(test.visual?.length ? (['browser'] as const) : []),
        ],
        scenario: structuredClone(test.scenario),
        assertions: structuredClone(test.asserts),
        visualAssertions: structuredClone(test.visual ?? []),
        modelIds: loadedModels.map((model) => model.id).sort(compareText),
        modelHashes: loadedModels
          .map((model) => ({ id: model.id, sha256: modelHash(model) }))
          .sort((a, b) => compareText(a.id, b.id)),
      }
    }),
    ...(repairCase.multimodal
      ? { multimodal: cloneRepairMultimodalRequirement(repairCase.multimodal) }
      : {}),
  }
}

export function repairCaseHash(repairCase: RepairCase): string
{
  return createHash('sha256')
    .update(
      canonicalJson({
        acceptance: acceptanceContract(repairCase),
        policy: repairCase.policy,
        tests: repairCase.tests.map(testIdentity),
        ...(repairCase.multimodal
          ? {
              multimodal: cloneRepairMultimodalRequirement(
                repairCase.multimodal
              ),
            }
          : {}),
      } as unknown as Json)
    )
    .digest('hex')
}

function validateRepairCaseValue(value: unknown): RepairCaseIssue[]
{
  if (!record(value))
  {
    return [
      {
        code: 'case.invalid-shape',
        message: 'repair case must be an object',
      },
    ]
  }
  const issues: RepairCaseIssue[] = []
  const requiredKeys = new Set(['id', 'objective', 'tests', 'policy'])
  const allowedKeys = new Set([...requiredKeys, 'multimodal'])
  if (
    [...requiredKeys].some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !allowedKeys.has(key))
  )
  {
    issues.push({
      code: 'case.invalid-shape',
      message:
        'repair case must contain id, objective, tests, and policy with only supported optional fields',
    })
  }
  if (Object.hasOwn(value, 'multimodal'))
  {
    issues.push(...validateRepairMultimodalRequirement(value.multimodal))
  }
  if (typeof value.id !== 'string' || !CASE_ID.test(value.id))
  {
    issues.push({
      code: 'case.invalid-id',
      message: 'repair case id must be stable and filesystem-safe',
    })
  }
  if (
    typeof value.objective !== 'string' ||
    value.objective.trim().length === 0
  )
  {
    issues.push({
      code: 'case.empty-objective',
      message: 'repair case objective must be nonempty',
    })
  }
  issues.push(
    ...validateRepairPolicy(value.policy).map((entry) => ({
      code: entry.code,
      message: entry.message,
    }))
  )
  issues.push(
    ...validateRepairTestSpecs(
      Array.isArray(value.tests) ? (value.tests as RepairTestSpec[]) : []
    ).map((entry) => ({
      code: entry.code,
      message: entry.message,
    }))
  )
  if (!Array.isArray(value.tests))
  {
    issues.push({
      code: 'case.invalid-tests',
      message: 'repair case tests must be an array',
    })
  }
  const policy = record(value.policy) ? value.policy : null
  const evidence = policy && record(policy.evidence) ? policy.evidence : null
  if (
    Array.isArray(value.tests) &&
    value.tests.some(
      (test) =>
        record(test) && Array.isArray(test.visual) && test.visual.length > 0
    ) &&
    typeof evidence?.maxLevel === 'number' &&
    evidence.maxLevel < 3
  )
  {
    issues.push({
      code: 'case.visual-evidence-level',
      message: 'a required visual oracle needs evidence level 3',
    })
  }
  return issues
}

function validateRepairCase(value: unknown): RepairCaseIssue[]
{
  try
  {
    return validateRepairCaseValue(value)
  }
  catch
  {
    return [
      {
        code: 'case.invalid-value',
        message: 'repair case could not be inspected safely',
      },
    ]
  }
}

export function parseRepairCase(value: unknown): ParsedRepairCase
{
  let detached: unknown
  try
  {
    detached = structuredClone(value)
  }
  catch
  {
    return {
      ok: false,
      issues: [
        {
          code: 'case.invalid-value',
          message: 'repair case must be safely cloneable',
        },
      ],
    }
  }
  const issues = validateRepairCase(detached)
  return issues.length === 0
    ? { ok: true, repairCase: detached as RepairCase }
    : { ok: false, issues }
}
