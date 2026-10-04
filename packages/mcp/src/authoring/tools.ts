// packages/mcp/src/authoring/tools.ts
// advertise compact authoring jobs beside the standard certified edit lifecycle

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { standardScratchMcpProfileToolsV2 } from '../transport/schema-profile.js'
import type { ResourceSnapshotSelectionV1 } from '../transport/resource-snapshots.js'

export const AUTHORING_TOOL_NAMES_V1 = [
  'authoring_open',
  'authoring_plan',
  'authoring_build',
  'authoring_evaluate',
  'authoring_export',
  'authoring_recover_export',
  'authoring_inspect',
  'authoring_close',
] as const

export type AuthoringToolNameV1 = (typeof AUTHORING_TOOL_NAMES_V1)[number]

export interface AuthoringHostCleanupResultV1
{
  complete: boolean
  pendingCalls: number
  issues: readonly string[]
}

export interface AuthoringToolHostV1
{
  call(
    name: AuthoringToolNameV1,
    input: Readonly<Record<string, unknown>>,
    context?: { readonly signal?: AbortSignal }
  ): Promise<Readonly<Record<string, unknown>>>
  readResource?(
    uri: string,
    context?: { readonly signal?: AbortSignal }
  ): Promise<{
    uri: string
    mimeType: string
    text: string
  }>
  selectResourceSnapshot?(
    uri: string,
    context?: { readonly signal?: AbortSignal }
  ): Promise<ResourceSnapshotSelectionV1>
  closeAll?(): Promise<void | AuthoringHostCleanupResultV1>
}

const text = { type: 'string', minLength: 1, maxLength: 4096 }
const identifier = { type: 'string', minLength: 1, maxLength: 256 }
const definitions = {
  authoring_open: {
    description:
      'Open a versioned scratch-workspace.json inside operator-authorized source roots.',
    properties: { manifestPath: text },
    required: ['manifestPath'],
  },
  authoring_plan: {
    description:
      'Prepare immutable source hashes, media, references, operation order, budgets and tool identities.',
    properties: { workspaceId: identifier },
    required: ['workspaceId'],
  },
  authoring_build: {
    description:
      'Build a pinned plan privately and retain its complete diff. Changed inputs refuse without promotion.',
    properties: { workspaceId: identifier, planId: identifier },
    required: ['workspaceId', 'planId'],
  },
  authoring_evaluate: {
    description:
      'Evaluate the exact private build and retain acceptance evidence bound to its bytes.',
    properties: { workspaceId: identifier, buildId: identifier },
    required: ['workspaceId', 'buildId'],
  },
  authoring_export: {
    description:
      'Export an accepted, unchanged build to a new authorized destination.',
    properties: {
      workspaceId: identifier,
      buildId: identifier,
      destinationPath: text,
    },
    required: ['workspaceId', 'buildId', 'destinationPath'],
  },
  authoring_recover_export: {
    description:
      'Reconcile an exact retained export intent, preserve a published candidate, and complete its receipt without replacing conflicting files.',
    properties: { workspaceId: identifier, exportId: identifier },
    required: ['workspaceId', 'exportId'],
  },
  authoring_inspect: {
    description:
      'Page through retained authoring evidence or the actionable standard block catalog.',
    properties: {
      workspaceId: identifier,
      planId: identifier,
      collection: {
        type: 'string',
        enum: [
          'status',
          'sources',
          'plans',
          'builds',
          'evaluations',
          'diff',
          'assets',
          'clips',
          'exports',
          'publications',
          'artifacts',
          'catalog',
        ],
      },
      cursor: { type: 'string', maxLength: 4096 },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
      opcodePrefix: { type: 'string', maxLength: 256 },
    },
    required: ['collection'],
  },
  authoring_close: {
    description:
      'Close a workspace while retaining its immutable evidence and generated builds.',
    properties: { workspaceId: identifier },
    required: ['workspaceId'],
  },
} as const

export const AUTHORING_TOOLS_V1: readonly Tool[] = Object.freeze(
  AUTHORING_TOOL_NAMES_V1.map((name): Tool => ({
    name,
    description: definitions[name].description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: definitions[name].properties,
      required: [...definitions[name].required],
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['schemaVersion', 'tool', 'ok', 'data'],
      properties: {
        schemaVersion: { const: 1 },
        tool: { const: name },
        ok: { type: 'boolean' },
        data: { type: 'object' },
      },
    },
    annotations: {
      readOnlyHint: name === 'authoring_inspect',
      destructiveHint: false,
      openWorldHint: false,
    },
    execution: { taskSupport: 'forbidden' },
  }))
)

export function authoringProfileToolsV1(): readonly Tool[]
{
  return Object.freeze([
    ...standardScratchMcpProfileToolsV2(),
    ...AUTHORING_TOOLS_V1,
  ])
}

export function isAuthoringToolNameV1(
  value: string
): value is AuthoringToolNameV1
{
  return AUTHORING_TOOL_NAMES_V1.includes(value as AuthoringToolNameV1)
}
