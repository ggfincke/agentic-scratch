// packages/repair/src/policy/policy.ts
// trusted aggregate repair budgets, preservation, diagnostics, & evidence policy

import {
  DEFAULT_REPAIR_IMPACT_LIMITS,
  DEFAULT_REPAIR_INTENT_LIMITS,
  DEFAULT_REPAIR_PRESERVATION_POLICY,
  TARGET_PROPERTIES,
  type RepairImpactLimits,
  type RepairIntentLimits,
  type RepairOpKind,
  type RepairPreservationPolicy,
} from '@scratch-agent/ir'
import {
  DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
  type DiagnosticRegressionOptions,
} from '@scratch-agent/eval'

import { isPlainRecord as record } from '../internal/records.js'

export type EvidenceLevel = 0 | 1 | 2 | 3

interface RepairEvidencePolicy
{
  baselineLevel: 0
  initialAgentRequestLevel: EvidenceLevel
  maxLevel: EvidenceLevel
  escalateAfterRepeatedFailure: boolean
}

export interface RepairPolicy
{
  maxAttempts: number
  intentBudget: RepairIntentLimits
  impactBudget: RepairImpactLimits
  preservation: RepairPreservationPolicy
  diagnostics: DiagnosticRegressionOptions
  evidence: RepairEvidencePolicy
}

interface RepairPolicyIssue
{
  code: string
  message: string
}

const ALL_REPAIR_OP_KINDS: readonly RepairOpKind[] = [
  'replaceLiteral',
  'replaceCompatibleOpcode',
  'replaceVariableRef',
  'replaceBroadcastRef',
  'insertStatementsAfter',
  'deleteStatement',
  'addScript',
  'setTargetProperty',
]

const DIAGNOSTIC_THRESHOLDS = new Set(['never', 'info', 'warning', 'error'])

export const DEFAULT_REPAIR_POLICY: RepairPolicy = {
  maxAttempts: 4,
  intentBudget: {
    ...DEFAULT_REPAIR_INTENT_LIMITS,
    allowedOpKinds: [...DEFAULT_REPAIR_INTENT_LIMITS.allowedOpKinds],
  },
  impactBudget: { ...DEFAULT_REPAIR_IMPACT_LIMITS },
  preservation: {
    ...DEFAULT_REPAIR_PRESERVATION_POLICY,
    allowedTargetProperties: [
      ...DEFAULT_REPAIR_PRESERVATION_POLICY.allowedTargetProperties,
    ],
  },
  diagnostics: {
    ...DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS,
    allowedNewGraphCodes: [
      ...DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS.allowedNewGraphCodes,
    ],
    allowedNewStaticCodes: [
      ...DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS.allowedNewStaticCodes,
    ],
  },
  evidence: {
    baselineLevel: 0,
    initialAgentRequestLevel: 1,
    maxLevel: 3,
    escalateAfterRepeatedFailure: true,
  },
}

function positiveInteger(value: unknown): value is number
{
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function nonnegativeInteger(value: unknown): value is number
{
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function issue(code: string, message: string): RepairPolicyIssue
{
  return { code, message }
}

export function validateRepairPolicy(value: unknown): RepairPolicyIssue[]
{
  try
  {
    return validateRepairPolicyValue(value)
  }
  catch
  {
    return [
      issue(
        'policy.invalid-value',
        'repair policy could not be inspected safely'
      ),
    ]
  }
}

function validateRepairPolicyValue(value: unknown): RepairPolicyIssue[]
{
  if (!record(value))
  {
    return [issue('policy.invalid-shape', 'repair policy must be an object')]
  }
  const issues: RepairPolicyIssue[] = []
  const expectedKeys = new Set([
    'maxAttempts',
    'intentBudget',
    'impactBudget',
    'preservation',
    'diagnostics',
    'evidence',
  ])
  if (
    Object.keys(value).length !== expectedKeys.size ||
    Object.keys(value).some((key) => !expectedKeys.has(key))
  )
  {
    issues.push(
      issue('policy.invalid-shape', 'repair policy has an invalid shape')
    )
  }
  const policy = value
  if (!positiveInteger(policy.maxAttempts) || policy.maxAttempts > 4)
  {
    issues.push(
      issue('policy.max-attempts', 'maxAttempts must be an integer from 1 to 4')
    )
  }
  const intentBudget = record(policy.intentBudget) ? policy.intentBudget : null
  const impactBudget = record(policy.impactBudget) ? policy.impactBudget : null
  const preservation = record(policy.preservation) ? policy.preservation : null
  const diagnostics = record(policy.diagnostics) ? policy.diagnostics : null
  const evidence = record(policy.evidence) ? policy.evidence : null
  for (const [name, nested, keys] of [
    [
      'intentBudget',
      intentBudget,
      ['maxOpsPerProposal', 'maxNewBlocksPerProposal', 'allowedOpKinds'],
    ],
    [
      'impactBudget',
      impactBudget,
      [
        'maxTouchedTargets',
        'maxTouchedScripts',
        'maxChangedAuthoredBlocks',
        'maxChangedBlockRecords',
      ],
    ],
    [
      'preservation',
      preservation,
      [
        'allowAssetChanges',
        'allowExistingEditorLayoutChanges',
        'allowMetadataChanges',
        'allowTargetStructureChanges',
        'allowedTargetProperties',
      ],
    ],
    [
      'diagnostics',
      diagnostics,
      [
        'rejectNewGraphAtOrAbove',
        'rejectNewStaticAtOrAbove',
        'allowedNewGraphCodes',
        'allowedNewStaticCodes',
      ],
    ],
    [
      'evidence',
      evidence,
      [
        'baselineLevel',
        'initialAgentRequestLevel',
        'maxLevel',
        'escalateAfterRepeatedFailure',
      ],
    ],
  ] as const)
  {
    const expected = new Set<string>(keys)
    if (
      !nested ||
      Object.keys(nested).length !== expected.size ||
      Object.keys(nested).some((key) => !expected.has(key))
    )
    {
      issues.push(
        issue(
          `policy.${name}.invalid-shape`,
          `${name} must contain exactly the registered policy fields`
        )
      )
    }
  }
  const positiveLimits: Array<[string, number, number]> = [
    [
      'maxOpsPerProposal',
      intentBudget?.maxOpsPerProposal as number,
      DEFAULT_REPAIR_INTENT_LIMITS.maxOpsPerProposal,
    ],
  ]
  for (const [name, limit, maximum] of positiveLimits)
  {
    if (!positiveInteger(limit) || limit > maximum)
    {
      issues.push(
        issue(
          `policy.${name}`,
          `${name} must be an integer from 1 to ${maximum}`
        )
      )
    }
  }
  const denialLimits: Array<[string, number, number]> = [
    [
      'maxNewBlocksPerProposal',
      intentBudget?.maxNewBlocksPerProposal as number,
      DEFAULT_REPAIR_INTENT_LIMITS.maxNewBlocksPerProposal,
    ],
    [
      'maxTouchedTargets',
      impactBudget?.maxTouchedTargets as number,
      DEFAULT_REPAIR_IMPACT_LIMITS.maxTouchedTargets,
    ],
    [
      'maxTouchedScripts',
      impactBudget?.maxTouchedScripts as number,
      DEFAULT_REPAIR_IMPACT_LIMITS.maxTouchedScripts,
    ],
    [
      'maxChangedAuthoredBlocks',
      impactBudget?.maxChangedAuthoredBlocks as number,
      DEFAULT_REPAIR_IMPACT_LIMITS.maxChangedAuthoredBlocks,
    ],
    [
      'maxChangedBlockRecords',
      impactBudget?.maxChangedBlockRecords as number,
      DEFAULT_REPAIR_IMPACT_LIMITS.maxChangedBlockRecords,
    ],
  ]
  for (const [name, limit, maximum] of denialLimits)
  {
    if (!nonnegativeInteger(limit) || limit > maximum)
    {
      issues.push(
        issue(
          `policy.${name}`,
          `${name} must be an integer from 0 to ${maximum}`
        )
      )
    }
  }
  const allowedOpKinds = intentBudget?.allowedOpKinds
  if (
    !Array.isArray(allowedOpKinds) ||
    allowedOpKinds.length === 0 ||
    new Set(allowedOpKinds).size !== allowedOpKinds.length
  )
  {
    issues.push(
      issue('policy.allowed-op-kinds', 'allowedOpKinds must be a nonempty set')
    )
  }
  for (const kind of Array.isArray(allowedOpKinds) ? allowedOpKinds : [])
  {
    if (
      typeof kind !== 'string' ||
      !ALL_REPAIR_OP_KINDS.includes(kind as RepairOpKind)
    )
    {
      issues.push(
        issue('policy.allowed-op-kind', `unsupported operation kind: ${kind}`)
      )
    }
  }
  const allowedTargetProperties = preservation?.allowedTargetProperties
  if (
    !Array.isArray(allowedTargetProperties) ||
    new Set(allowedTargetProperties).size !== allowedTargetProperties.length ||
    allowedTargetProperties.some(
      (property) =>
        typeof property !== 'string' ||
        !(TARGET_PROPERTIES as readonly string[]).includes(property)
    )
  )
  {
    issues.push(
      issue(
        'policy.allowed-target-properties',
        'allowedTargetProperties must contain unique supported properties'
      )
    )
  }
  if (
    Array.isArray(allowedOpKinds) &&
    allowedOpKinds.includes('setTargetProperty') &&
    (!Array.isArray(allowedTargetProperties) ||
      allowedTargetProperties.length === 0)
  )
  {
    issues.push(
      issue(
        'policy.target-property',
        'setTargetProperty requires an allowed target property'
      )
    )
  }
  for (const [name, flag] of [
    ['allowAssetChanges', preservation?.allowAssetChanges],
    [
      'allowExistingEditorLayoutChanges',
      preservation?.allowExistingEditorLayoutChanges,
    ],
    ['allowMetadataChanges', preservation?.allowMetadataChanges],
    ['allowTargetStructureChanges', preservation?.allowTargetStructureChanges],
    ['escalateAfterRepeatedFailure', evidence?.escalateAfterRepeatedFailure],
  ] as const)
  {
    if (typeof flag !== 'boolean')
    {
      issues.push(issue(`policy.${name}`, `${name} must be a boolean`))
    }
  }
  for (const [name, threshold] of [
    ['rejectNewGraphAtOrAbove', diagnostics?.rejectNewGraphAtOrAbove],
    ['rejectNewStaticAtOrAbove', diagnostics?.rejectNewStaticAtOrAbove],
  ] as const)
  {
    if (
      typeof threshold !== 'string' ||
      !DIAGNOSTIC_THRESHOLDS.has(threshold)
    )
    {
      issues.push(
        issue(
          `policy.${name}`,
          `${name} must be error, warning, info, or never`
        )
      )
    }
  }
  for (const [name, values] of [
    ['allowedNewGraphCodes', diagnostics?.allowedNewGraphCodes],
    ['allowedNewStaticCodes', diagnostics?.allowedNewStaticCodes],
  ] as const)
  {
    if (
      !Array.isArray(values) ||
      new Set(values).size !== values.length ||
      values.some(
        (entry) =>
          typeof entry !== 'string' ||
          entry.length === 0 ||
          entry.trim() !== entry
      )
    )
    {
      issues.push(
        issue(
          `policy.${name}`,
          `${name} must contain unique nonempty diagnostic codes`
        )
      )
    }
  }
  if (
    evidence?.baselineLevel !== 0 ||
    ![0, 1, 2, 3].includes(evidence?.initialAgentRequestLevel as number) ||
    ![0, 1, 2, 3].includes(evidence?.maxLevel as number) ||
    typeof evidence?.initialAgentRequestLevel !== 'number' ||
    typeof evidence.maxLevel !== 'number' ||
    evidence.initialAgentRequestLevel < 1 ||
    evidence.initialAgentRequestLevel > evidence.maxLevel
  )
  {
    issues.push(
      issue(
        'policy.evidence-levels',
        'evidence must begin at level 0, request at level 1+, and stop at 3'
      )
    )
  }
  return issues
}

export function cloneRepairPolicy(policy: RepairPolicy): RepairPolicy
{
  return structuredClone(policy)
}
