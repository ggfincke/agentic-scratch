// packages/mcp/src/development/tools.ts
// describe bounded playtest, inspection & reproducer operations for agents

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { SELECTED_STATE_PROBE_LIMITS_V1 } from '@scratch-agent/runner'
import type { ResourceSnapshotSelectionV1 } from '../transport/resource-snapshots.js'

export const DEVELOPMENT_TOOL_NAMES_V1 = [
  'development_begin',
  'development_command',
  'development_inspect',
  'development_reproduce',
  'development_close',
] as const

export type DevelopmentToolNameV1 = (typeof DEVELOPMENT_TOOL_NAMES_V1)[number]

export interface DevelopmentHostCleanupResultV1
{
  readonly complete: boolean
  readonly pendingCalls: number
  readonly liveSessionIds: readonly string[]
  readonly issues: readonly string[]
}

export interface DevelopmentToolHostV1
{
  call(
    name: DevelopmentToolNameV1,
    input: Readonly<Record<string, unknown>>,
    context?: { readonly signal?: AbortSignal }
  ): Promise<Readonly<Record<string, unknown>>>
  readResource?(
    uri: string
  ): Promise<{ uri: string; mimeType: string; text: string }>
  selectResourceSnapshot?(
    uri: string,
    context?: { readonly signal?: AbortSignal }
  ): Promise<ResourceSnapshotSelectionV1>
  closeAll?(): Promise<void | DevelopmentHostCleanupResultV1>
}

const text = { type: 'string', minLength: 1, maxLength: 4096 }
const id = { type: 'string', minLength: 1, maxLength: 256 }
const profile = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    runtime: { enum: ['scratch-official', 'turbowarp'] },
    scheduler: { enum: ['deterministic', 'natural'] },
    tickRate: { enum: [30, 60] },
  },
  required: ['schemaVersion', 'runtime', 'scheduler', 'tickRate'],
}
const numericSelector = {
  type: 'object',
  additionalProperties: false,
  properties: {
    targetIndex: { type: 'integer', minimum: 0, maximum: 999 },
    instance: {
      oneOf: [
        { const: 'original' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            cloneKey: { type: ['string', 'number', 'boolean'], maxLength: 128 },
          },
          required: ['cloneKey'],
        },
      ],
    },
    property: {
      oneOf: [
        {
          enum: [
            'x',
            'y',
            'direction',
            'size',
            'volume',
            'costumeIndexOneBased',
          ],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            variableId: { type: 'string', minLength: 1, maxLength: 256 },
          },
          required: ['variableId'],
        },
      ],
    },
  },
  required: ['targetIndex', 'property'],
}
const overlayValue = {
  oneOf: [
    { type: 'number', minimum: -10000, maximum: 10000 },
    {
      type: 'object',
      additionalProperties: false,
      properties: { probe: numericSelector },
      required: ['probe'],
    },
  ],
}
const overlay = {
  oneOf: ['rectangle', 'circle'].map((kind) => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1, maxLength: 128 },
      label: { type: 'string', maxLength: 80 },
      purpose: { enum: ['declared-collision', 'debug-region'] },
      kind: { const: kind },
      x: overlayValue,
      y: overlayValue,
      ...(kind === 'rectangle'
        ? { width: overlayValue, height: overlayValue }
        : { radius: overlayValue }),
    },
    required: [
      'id',
      'purpose',
      'kind',
      'x',
      'y',
      ...(kind === 'rectangle' ? ['width', 'height'] : ['radius']),
    ],
  })),
}
const probe = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxListItems: {
      type: 'integer',
      minimum: 0,
      maximum: SELECTED_STATE_PROBE_LIMITS_V1.maxListItems,
    },
    targets: {
      type: 'array',
      maxItems: SELECTED_STATE_PROBE_LIMITS_V1.maxTargets,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          targetIndex: {
            type: 'integer',
            minimum: 0,
            maximum: SELECTED_STATE_PROBE_LIMITS_V1.maxTargetIndex,
          },
          variableIds: {
            type: 'array',
            maxItems: SELECTED_STATE_PROBE_LIMITS_V1.maxDeclarationSelectors,
            uniqueItems: true,
            items: {
              ...id,
              maxLength: SELECTED_STATE_PROBE_LIMITS_V1.maxIdentifierLength,
              pattern: '^[^\\u0000]+$',
            },
          },
          listIds: {
            type: 'array',
            maxItems: SELECTED_STATE_PROBE_LIMITS_V1.maxDeclarationSelectors,
            uniqueItems: true,
            items: {
              ...id,
              maxLength: SELECTED_STATE_PROBE_LIMITS_V1.maxIdentifierLength,
              pattern: '^[^\\u0000]+$',
            },
          },
          includeClones: { type: 'boolean' },
          cloneKeyVariableId: {
            ...id,
            maxLength: SELECTED_STATE_PROBE_LIMITS_V1.maxIdentifierLength,
            pattern: '^[^\\u0000]+$',
          },
        },
        required: ['targetIndex'],
      },
    },
  },
}
const definitions = {
  development_begin: {
    description:
      'Load exact source bytes into a bounded recorded Scratch or TurboWarp playtest window. Probe target indexes and declaration IDs must be unique, with at most 64 variable/list selectors across all targets. A clone key requires includeClones:true.',
    properties: {
      sourcePath: text,
      expectedSourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      profile,
      preset: { enum: ['official30', 'turboWarp60'] },
      visible: { type: 'boolean' },
      inputMode: { enum: ['agent', 'human'] },
      probe,
      seed: { type: 'integer', minimum: 0, maximum: 4294967295 },
    },
    required: ['sourcePath'],
  },
  development_command: {
    description:
      'Control play, mark a problem, import source-bound clips, record internal output audio, or build a retained history and comparison viewer.',
    properties: {
      sessionId: id,
      command: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { const: 'view' },
              compareSessionId: id,
              overlays: { type: 'array', maxItems: 64, items: overlay },
              clipArtifactKey: text,
              reproductionArtifactKey: text,
            },
            required: ['kind'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { const: 'importClip' },
              sourcePath: text,
              expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            },
            required: ['kind', 'sourcePath'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { const: 'recordAudio' },
              durationMs: { type: 'integer', minimum: 1, maximum: 10000 },
              maxBytes: {
                type: 'integer',
                minimum: 1,
                maximum: 5 * 1024 * 1024,
              },
            },
            required: ['kind'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { enum: ['start', 'pause', 'resume', 'restart'] },
            },
            required: ['kind'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { const: 'advance' },
              ticks: { type: 'integer', minimum: 1, maximum: 600 },
            },
            required: ['kind', 'ticks'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { const: 'mark' },
              label: { type: 'string', minLength: 1, maxLength: 240 },
            },
            required: ['kind', 'label'],
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { const: 'input' },
              input: {
                oneOf: [
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      device: { const: 'keyboard' },
                      key: { type: 'string', minLength: 1, maxLength: 32 },
                      isDown: { type: 'boolean' },
                    },
                    required: ['device', 'key', 'isDown'],
                  },
                  {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      device: { const: 'mouse' },
                      x: { type: 'number', minimum: -10000, maximum: 10000 },
                      y: { type: 'number', minimum: -10000, maximum: 10000 },
                      isDown: { type: 'boolean' },
                    },
                    required: ['device', 'x', 'y'],
                  },
                ],
              },
            },
            required: ['kind', 'input'],
          },
        ],
      },
    },
    required: ['sessionId', 'command'],
  },
  development_inspect: {
    description:
      'Read paginated retained state, applied inputs, segments, markers and artifact references without advancing gameplay.',
    properties: {
      sessionId: id,
      collection: {
        enum: [
          'status',
          'events',
          'inputs',
          'segments',
          'marks',
          'state',
          'artifacts',
          'trace',
          'sounds',
          'diagnostics',
        ],
      },
      cursor: text,
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['sessionId'],
  },
  development_reproduce: {
    description:
      'Replay a marked input prefix from reset; report selected-state agreement or first divergence and retained visual evidence.',
    properties: {
      sessionId: id,
      markId: id,
      profile,
      denseCapture: {
        type: 'object',
        additionalProperties: false,
        properties: {
          maxFrames: { type: 'integer', minimum: 1, maximum: 240 },
          maxBytes: { type: 'integer', minimum: 1, maximum: 50 * 1024 * 1024 },
        },
      },
    },
    required: ['sessionId', 'markId'],
  },
  development_close: {
    description:
      'Release held inputs, stop the runtime and close the window while retaining private evidence.',
    properties: { sessionId: id },
    required: ['sessionId'],
  },
}

export const DEVELOPMENT_TOOLS_V1: readonly Tool[] =
  DEVELOPMENT_TOOL_NAMES_V1.map((name) => ({
    name,
    description: definitions[name].description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: definitions[name].properties,
      required: definitions[name].required,
    },
    outputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        schemaVersion: { const: 1 },
        tool: { const: name },
        ok: { type: 'boolean' },
        data: { type: 'object' },
      },
      required: ['schemaVersion', 'tool', 'ok', 'data'],
    },
    annotations: {
      readOnlyHint: name === 'development_inspect',
      destructiveHint: false,
      openWorldHint: false,
    },
  }))

export function isDevelopmentToolNameV1(
  name: string
): name is DevelopmentToolNameV1
{
  return DEVELOPMENT_TOOL_NAMES_V1.some((value) => value === name)
}

export function developmentProfileAuthoritySha256V1()
{
  return sha256Hex(
    canonicalJsonBytesV1({
      schemaVersion: 1,
      kind: 'development-profile-v1',
      tools: DEVELOPMENT_TOOLS_V1,
    })
  )
}
