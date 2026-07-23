// packages/mcp/src/repair/tools.ts
// advertise exact repair tools & delegate calls to the session registry

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { buildRepairBenchmark, proposalSchema } from '@scratch-agent/repair'

import { REPAIR_CASE_IDS } from './cases.js'
import { RepairMcpBoundaryError } from '../transport/errors.js'
import type { RepairSessionRegistry } from './sessions.js'

type JsonRecord = Record<string, unknown>

const SESSION_ID_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 8192,
}

const ABSOLUTE_PATH_SCHEMA = {
  type: 'string',
  minLength: 1,
  maxLength: 32768,
}

const SESSION_ID_MAX_LENGTH = SESSION_ID_SCHEMA.maxLength
const ABSOLUTE_PATH_MAX_LENGTH = ABSOLUTE_PATH_SCHEMA.maxLength

function record(value: unknown): value is JsonRecord
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function closedArgs(value: unknown, required: readonly string[]): JsonRecord
{
  if (!record(value))
  {
    throw new RepairMcpBoundaryError(
      'mcp.arguments-invalid',
      'tool arguments must be an object'
    )
  }
  const unknown = Object.keys(value).filter((key) => !required.includes(key))
  const missing = required.filter((key) => !(key in value))
  if (unknown.length > 0 || missing.length > 0)
  {
    throw new RepairMcpBoundaryError(
      'mcp.arguments-invalid',
      'tool arguments do not match the advertised schema'
    )
  }
  return value
}

function boundedString(
  args: JsonRecord,
  name: string,
  maxLength: number
): string
{
  const value = args[name]
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    [...value].length > maxLength
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.arguments-invalid',
      'tool arguments do not match the advertised schema'
    )
  }
  return value
}

function registeredCaseId(args: JsonRecord): (typeof REPAIR_CASE_IDS)[number]
{
  const value = args.caseId
  if (!REPAIR_CASE_IDS.includes(value as (typeof REPAIR_CASE_IDS)[number]))
  {
    throw new RepairMcpBoundaryError(
      'mcp.arguments-invalid',
      'tool arguments do not match the advertised schema'
    )
  }
  return value as (typeof REPAIR_CASE_IDS)[number]
}

function registeredProposalSchemas(): {
  anyOf: object[]
  definitions: JsonRecord
}
{
  let sharedDefinitions: JsonRecord | null = null
  const seen = new Set<string>()
  const variants: object[] = []
  for (const caseId of REPAIR_CASE_IDS)
  {
    const policy = buildRepairBenchmark(caseId).repairCase.policy
    const schema = proposalSchema(
      policy.intentBudget.allowedOpKinds,
      policy.intentBudget.maxOpsPerProposal,
      policy.intentBudget.maxNewBlocksPerProposal,
      policy.preservation.allowedTargetProperties
    ) as JsonRecord
    const definitions = schema.$defs
    if (!record(definitions))
    {
      throw new Error('repair proposal schema has no definitions')
    }
    if (!sharedDefinitions)
    {
      sharedDefinitions = structuredClone(definitions)
    }
    else if (
      JSON.stringify(sharedDefinitions) !== JSON.stringify(definitions)
    )
    {
      throw new Error('registered repair proposal definitions diverged')
    }
    const {
      $schema: _schema,
      $comment: _comment,
      $defs: _definitions,
      ...variant
    } = schema
    const identity = JSON.stringify(variant)
    if (!seen.has(identity))
    {
      seen.add(identity)
      variants.push(variant)
    }
  }
  return {
    anyOf: variants,
    definitions: sharedDefinitions ?? {},
  }
}

const REGISTERED_PROPOSAL_SCHEMAS = registeredProposalSchemas()

const START_INPUT = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['inputPath', 'caseId'],
  properties: {
    inputPath: ABSOLUTE_PATH_SCHEMA,
    caseId: { enum: REPAIR_CASE_IDS },
  },
}

const SESSION_INPUT = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['sessionId'],
  properties: { sessionId: SESSION_ID_SCHEMA },
}

const SUBMIT_INPUT = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['sessionId', 'proposal'],
  properties: {
    sessionId: SESSION_ID_SCHEMA,
    proposal: { anyOf: REGISTERED_PROPOSAL_SCHEMAS.anyOf },
  },
  $defs: REGISTERED_PROPOSAL_SCHEMAS.definitions,
}

const EXPORT_INPUT = {
  type: 'object' as const,
  additionalProperties: false,
  required: ['sessionId', 'outputPath'],
  properties: {
    sessionId: SESSION_ID_SCHEMA,
    outputPath: ABSOLUTE_PATH_SCHEMA,
  },
}

export const REPAIR_TOOLS: Tool[] = [
  {
    name: 'repair_start',
    description:
      'Start one registered R1-R5 repair session for a selected .sb3 file.',
    inputSchema: START_INPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  },
  {
    name: 'repair_next',
    description:
      'Reserve and return the next immutable repair request for a session.',
    inputSchema: SESSION_INPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  },
  {
    name: 'repair_submit',
    description:
      'Submit one typed semantic proposal for the outstanding repair request.',
    inputSchema: SUBMIT_INPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  },
  {
    name: 'repair_status',
    description: 'Read the current repair session state and terminal result.',
    inputSchema: SESSION_INPUT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  },
  {
    name: 'repair_export',
    description:
      'Write and verify an accepted artifact at a new path under the output root.',
    inputSchema: EXPORT_INPUT,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  },
]

export async function callRepairTool(
  registry: RepairSessionRegistry,
  name: string,
  rawArguments: unknown
): Promise<JsonRecord>
{
  switch (name)
  {
    case 'repair_start':
    {
      const args = closedArgs(rawArguments, ['inputPath', 'caseId'])
      return (await registry.start(
        boundedString(args, 'inputPath', ABSOLUTE_PATH_MAX_LENGTH),
        registeredCaseId(args)
      )) as unknown as JsonRecord
    }
    case 'repair_next':
    {
      const args = closedArgs(rawArguments, ['sessionId'])
      return registry.next(
        boundedString(args, 'sessionId', SESSION_ID_MAX_LENGTH)
      ) as unknown as JsonRecord
    }
    case 'repair_submit':
    {
      const args = closedArgs(rawArguments, ['sessionId', 'proposal'])
      return (await registry.submit(
        boundedString(args, 'sessionId', SESSION_ID_MAX_LENGTH),
        args.proposal
      )) as unknown as JsonRecord
    }
    case 'repair_status':
    {
      const args = closedArgs(rawArguments, ['sessionId'])
      return registry.status(
        boundedString(args, 'sessionId', SESSION_ID_MAX_LENGTH)
      ) as unknown as JsonRecord
    }
    case 'repair_export':
    {
      const args = closedArgs(rawArguments, ['sessionId', 'outputPath'])
      return registry.export(
        boundedString(args, 'sessionId', SESSION_ID_MAX_LENGTH),
        boundedString(args, 'outputPath', ABSOLUTE_PATH_MAX_LENGTH)
      ) as unknown as JsonRecord
    }
    default:
      throw new RepairMcpBoundaryError(
        'mcp.tool-unknown',
        'repair tool was not found'
      )
  }
}
