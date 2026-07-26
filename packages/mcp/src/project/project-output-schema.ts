// packages/mcp/src/project/project-output-schema.ts
// closed success-data & envelope projections for the four read-only project tools

import { PROJECT_TOOL_NAMES } from '@scratch-agent/edit'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

export type JsonSchema = Record<string, unknown>

// the MCP SDK validates structuredContent w/ a draft-07 Ajv, which ignores
// prefixItems & then applies `items: false` to every element, so an advertised
// 2020-12 tuple rejects the conforming responses it was written to describe
function draft07TupleForm(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(draft07TupleForm)
  if (value === null || typeof value !== 'object') return value
  const node = value as Record<string, unknown>
  const rewritten: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(node))
  {
    if (key === 'prefixItems' || key === 'items') continue
    rewritten[key] = draft07TupleForm(entry)
  }
  if (Array.isArray(node.prefixItems))
  {
    rewritten.items = node.prefixItems.map(draft07TupleForm)
    if ('items' in node)
      rewritten.additionalItems = draft07TupleForm(node.items)
  }
  else if ('items' in node)
  {
    rewritten.items = draft07TupleForm(node.items)
  }
  return rewritten
}

const SHA256 = {
  type: 'string',
  minLength: 64,
  maxLength: 64,
  pattern: '^[0-9a-f]{64}$',
}

const INTEGER = {
  type: 'integer',
  minimum: 0,
  maximum: Number.MAX_SAFE_INTEGER,
}

const STRING = { type: 'string', maxLength: 4096 }

function closed(
  properties: Record<string, unknown>,
  required = Object.keys(properties)
): JsonSchema
{
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  }
}

const PROJECT_STRING = { type: 'string', maxLength: 16 * 1024 }
const PROJECT_NUMBER = { type: 'number' }
const PROJECT_SCALAR = {
  anyOf: [PROJECT_STRING, PROJECT_NUMBER, { type: 'boolean' }],
}

function dynamicMap(value: unknown, maxProperties = 2048): JsonSchema
{
  return {
    type: 'object',
    additionalProperties: false,
    maxProperties,
    propertyNames: { type: 'string', maxLength: 16 * 1024 },
    patternProperties: { '': value },
  }
}

const PROJECT_SCHEMA_DEFINITIONS = {
  ProjectOpaqueJsonValue: {
    anyOf: [
      { type: 'null' },
      { type: 'boolean' },
      PROJECT_NUMBER,
      PROJECT_STRING,
      {
        type: 'array',
        maxItems: 2048,
        items: { $ref: '#/$defs/ProjectOpaqueJsonValue' },
      },
      {
        type: 'object',
        additionalProperties: false,
        maxProperties: 2048,
        propertyNames: { type: 'string', maxLength: 16 * 1024 },
        patternProperties: {
          '': { $ref: '#/$defs/ProjectOpaqueJsonValue' },
        },
      },
    ],
  },
}

const PROJECT_ARTIFACT = closed(
  {
    id: STRING,
    kind: STRING,
    mediaType: STRING,
    byteLength: INTEGER,
    sha256: SHA256,
    uri: { anyOf: [{ type: 'null' }, STRING] },
  },
  ['id', 'kind', 'mediaType', 'byteLength', 'sha256', 'uri']
)

const PROJECT_CHECK_ISSUE = closed(
  {
    code: STRING,
    message: STRING,
    stage: {
      enum: [
        'admission',
        'schema',
        'graph',
        'static',
        'roundTrip',
        'vmSmoke',
        'browserSmoke',
      ],
    },
    producerCode: STRING,
  },
  ['code', 'message']
)

const PROJECT_DIAGNOSTIC_LOCATION = closed(
  {
    target: PROJECT_STRING,
    block: PROJECT_STRING,
    asset: PROJECT_STRING,
    monitor: PROJECT_STRING,
  },
  []
)

const PROJECT_RUN_ISSUE_LOCATION = {
  anyOf: [
    closed({ kind: { const: 'project' } }),
    closed({ kind: { const: 'asset' }, path: PROJECT_STRING }),
    closed({
      kind: { const: 'unresolved-target' },
      name: PROJECT_STRING,
    }),
  ],
}

const PROJECT_RUN_ISSUE = closed(
  {
    code: STRING,
    kind: {
      enum: [
        'project-load',
        'scenario',
        'tick-budget',
        'network-policy',
        'browser-launch',
        'observation',
        'runtime',
        'internal',
      ],
    },
    responsibility: {
      enum: ['project', 'repair-case', 'infrastructure', 'unsupported'],
    },
    message: STRING,
    location: PROJECT_RUN_ISSUE_LOCATION,
  },
  ['code', 'kind', 'responsibility', 'message']
)

const PROJECT_TARGET_ITEM = closed({
  targetIndex: INTEGER,
  name: PROJECT_STRING,
  isStage: { type: 'boolean' },
  blockCount: INTEGER,
  scriptCount: INTEGER,
  costumeCount: INTEGER,
  soundCount: INTEGER,
  variableCount: INTEGER,
  listCount: INTEGER,
  broadcastCount: INTEGER,
  commentCount: INTEGER,
})

const PROJECT_SCRIPT_ITEM = closed({
  targetIndex: INTEGER,
  scriptIndex: INTEGER,
  rootBlockId: PROJECT_STRING,
  opcode: PROJECT_STRING,
  x: { anyOf: [{ type: 'null' }, { type: 'number' }] },
  y: { anyOf: [{ type: 'null' }, { type: 'number' }] },
  blockCount: INTEGER,
})

const PROJECT_BLOCK_ITEM = closed({
  targetIndex: INTEGER,
  scriptIndex: { anyOf: [{ type: 'null' }, INTEGER] },
  orderInScript: { anyOf: [{ type: 'null' }, INTEGER] },
  blockId: PROJECT_STRING,
  opcode: { anyOf: [{ type: 'null' }, PROJECT_STRING] },
  next: { anyOf: [{ type: 'null' }, PROJECT_STRING] },
  parent: { anyOf: [{ type: 'null' }, PROJECT_STRING] },
  topLevel: { type: 'boolean' },
  shadow: { type: 'boolean' },
  fields: dynamicMap({
    anyOf: [
      {
        type: 'array',
        minItems: 1,
        maxItems: 1,
        prefixItems: [
          { anyOf: [PROJECT_STRING, PROJECT_NUMBER, { type: 'null' }] },
        ],
        items: false,
      },
      {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        prefixItems: [
          { anyOf: [PROJECT_STRING, PROJECT_NUMBER, { type: 'null' }] },
          { anyOf: [PROJECT_STRING, { type: 'null' }] },
        ],
        items: false,
      },
    ],
  }),
  inputs: dynamicMap({
    type: 'array',
    minItems: 1,
    maxItems: 2048,
    prefixItems: [{ enum: [1, 2, 3] }],
    items: {
      anyOf: [
        PROJECT_STRING,
        { type: 'null' },
        {
          anyOf: [
            {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              prefixItems: [
                { enum: [4, 5, 6, 7, 8] },
                { anyOf: [PROJECT_STRING, PROJECT_NUMBER] },
              ],
              items: false,
            },
            {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              prefixItems: [{ const: 9 }, PROJECT_STRING],
              items: false,
            },
            {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              prefixItems: [
                { const: 10 },
                { anyOf: [PROJECT_STRING, PROJECT_NUMBER] },
              ],
              items: false,
            },
            {
              type: 'array',
              minItems: 3,
              maxItems: 3,
              prefixItems: [{ const: 11 }, PROJECT_STRING, PROJECT_STRING],
              items: false,
            },
            {
              type: 'array',
              minItems: 3,
              maxItems: 5,
              prefixItems: [{ enum: [12, 13] }, PROJECT_STRING, PROJECT_STRING],
              items: PROJECT_NUMBER,
            },
          ],
        },
      ],
    },
  }),
  mutation: {
    anyOf: [
      { type: 'null' },
      closed(
        {
          tagName: PROJECT_STRING,
          children: {
            type: 'array',
            maxItems: 2048,
            items: { $ref: '#/$defs/ProjectOpaqueJsonValue' },
          },
          proccode: PROJECT_STRING,
          argumentids: PROJECT_STRING,
          argumentnames: PROJECT_STRING,
          argumentdefaults: PROJECT_STRING,
          warp: {
            anyOf: [{ type: 'boolean' }, { type: 'null' }, PROJECT_STRING],
          },
          hasnext: {
            anyOf: [{ type: 'boolean' }, { type: 'null' }, PROJECT_STRING],
          },
        },
        ['tagName', 'children']
      ),
    ],
  },
  primitive: {
    anyOf: [
      { type: 'null' },
      {
        type: 'array',
        minItems: 3,
        maxItems: 5,
        prefixItems: [{ enum: [12, 13] }, PROJECT_STRING, PROJECT_STRING],
        items: PROJECT_NUMBER,
      },
    ],
  },
})

const PROJECT_DECLARATION_ITEM = closed({
  targetIndex: INTEGER,
  kind: { enum: ['variable', 'list', 'broadcast'] },
  id: PROJECT_STRING,
  name: PROJECT_STRING,
  value: { anyOf: [PROJECT_SCALAR, { type: 'null' }] },
  itemCount: { anyOf: [{ type: 'null' }, INTEGER] },
  itemSample: {
    anyOf: [
      { type: 'null' },
      { type: 'array', maxItems: 20, items: PROJECT_SCALAR },
    ],
  },
  cloud: { type: 'boolean' },
})

const PROJECT_DIAGNOSTIC_ITEM = closed({
  source: { enum: ['schema', 'graph', 'static'] },
  severity: { enum: ['error', 'warning', 'info'] },
  code: STRING,
  message: STRING,
  location: PROJECT_DIAGNOSTIC_LOCATION,
})

const PROJECT_TRUNCATED_ITEM = closed({
  truncated: { const: true },
  originalBytes: INTEGER,
  originalSha256: SHA256,
  preview: { type: 'string', maxLength: 8 * 1024 + 3 },
})

const PROJECT_SCENARIO_SUMMARY = closed({
  profile: { enum: ['default-smoke', 'custom'] },
  sha256: SHA256,
  stepCount: INTEGER,
  maxTicks: INTEGER,
  snapshotCount: INTEGER,
})

const PROJECT_RUNTIME_LOG_CATEGORY = closed(
  {
    code: STRING,
    level: { enum: ['warning', 'error', 'other'] },
    disposition: {
      enum: ['expected-environment', 'advisory', 'failure'],
    },
    count: INTEGER,
    samples: { type: 'array', maxItems: 10, items: STRING },
    uniqueValues: INTEGER,
  },
  ['code', 'level', 'disposition', 'count', 'samples']
)

const PROJECT_RUNTIME_LOG = closed({
  total: INTEGER,
  categories: {
    type: 'array',
    maxItems: 128,
    items: PROJECT_RUNTIME_LOG_CATEGORY,
  },
  droppedEvents: INTEGER,
  truncatedBytes: INTEGER,
})

const PROJECT_BROWSER_LOG_CATEGORY = closed({
  code: STRING,
  level: STRING,
  disposition: {
    enum: ['expected-environment', 'advisory', 'failure'],
  },
  count: INTEGER,
  samples: { type: 'array', maxItems: 10, items: STRING },
})

const PROJECT_BROWSER_LOG = closed({
  total: INTEGER,
  retainedEntries: INTEGER,
  droppedEntries: INTEGER,
  truncatedBytes: INTEGER,
  categories: {
    type: 'array',
    maxItems: 128,
    items: PROJECT_BROWSER_LOG_CATEGORY,
  },
})

const PROJECT_RECT = closed({
  x: PROJECT_NUMBER,
  y: PROJECT_NUMBER,
  width: PROJECT_NUMBER,
  height: PROJECT_NUMBER,
})

const PROJECT_RENDERER_GEOMETRY = closed({
  canvas: closed({ width: PROJECT_NUMBER, height: PROJECT_NUMBER }),
  targets: {
    type: 'array',
    maxItems: 2048,
    items: closed({
      originalTargetId: PROJECT_STRING,
      name: PROJECT_STRING,
      isStage: { type: 'boolean' },
      instance: { enum: ['original', 'clone'] },
      instanceIndex: INTEGER,
      visible: { type: 'boolean' },
      costumeIndex: INTEGER,
      costumeName: PROJECT_STRING,
      rect: { anyOf: [{ type: 'null' }, PROJECT_RECT] },
    }),
  },
})

const PROJECT_SPRITE_STATE = closed({
  x: PROJECT_NUMBER,
  y: PROJECT_NUMBER,
  direction: PROJECT_NUMBER,
  costume: PROJECT_STRING,
  visible: { type: 'boolean' },
  id: PROJECT_STRING,
  name: PROJECT_STRING,
  isStage: { type: 'boolean' },
  size: PROJECT_NUMBER,
  rotationStyle: PROJECT_STRING,
  draggable: { type: 'boolean' },
  volume: PROJECT_NUMBER,
  effects: dynamicMap(PROJECT_NUMBER),
  bubble: {
    anyOf: [
      { type: 'null' },
      closed({ text: PROJECT_STRING, type: { enum: ['say', 'think'] } }),
    ],
  },
  variables: dynamicMap(PROJECT_SCALAR),
  lists: dynamicMap({
    type: 'array',
    maxItems: 2048,
    items: PROJECT_SCALAR,
  }),
})

const PROJECT_SNAPSHOT_STATE = closed(
  {
    tick: INTEGER,
    label: PROJECT_STRING,
    targetOrder: {
      type: 'array',
      maxItems: 2048,
      items: PROJECT_STRING,
    },
    targetsById: dynamicMap(PROJECT_SPRITE_STATE),
    stageTargetId: PROJECT_STRING,
    targets: dynamicMap(PROJECT_SPRITE_STATE),
    variables: dynamicMap(PROJECT_SCALAR),
    lists: dynamicMap({
      type: 'array',
      maxItems: 2048,
      items: PROJECT_SCALAR,
    }),
    answer: PROJECT_STRING,
    timer: PROJECT_NUMBER,
    stage: closed({
      backdrop: PROJECT_STRING,
      tempo: PROJECT_NUMBER,
      videoState: PROJECT_STRING,
    }),
    visual: closed({
      canvas: closed({ width: PROJECT_NUMBER, height: PROJECT_NUMBER }),
      spriteRects: dynamicMap({
        anyOf: [{ type: 'null' }, PROJECT_RECT],
      }),
      gridCols: INTEGER,
      gridRows: INTEGER,
      grid: { type: 'array', maxItems: 3072, items: PROJECT_NUMBER },
      geometry: PROJECT_RENDERER_GEOMETRY,
      identityIssues: {
        type: 'array',
        maxItems: 2048,
        items: PROJECT_STRING,
      },
    }),
  },
  [
    'tick',
    'targetOrder',
    'targetsById',
    'stageTargetId',
    'targets',
    'variables',
    'lists',
    'answer',
    'timer',
    'stage',
  ]
)

const PROJECT_LANE = closed({
  ok: { type: 'boolean' },
  runtime: STRING,
  snapshotCount: INTEGER,
  snapshots: {
    type: 'array',
    maxItems: 8,
    items: closed({
      label: { anyOf: [{ type: 'null' }, PROJECT_STRING] },
      tick: INTEGER,
    }),
  },
  issues: closed({
    count: INTEGER,
    samples: { type: 'array', maxItems: 10, items: PROJECT_RUN_ISSUE },
    omitted: INTEGER,
  }),
  logSummary: { anyOf: [PROJECT_RUNTIME_LOG, PROJECT_BROWSER_LOG] },
  screenshotCount: INTEGER,
  screenshots: { type: 'array', maxItems: 8, items: PROJECT_ARTIFACT },
})

const PROJECT_RUN_RECORD = closed({
  runId: STRING,
  createdAt: STRING,
  completedAt: STRING,
  status: { enum: ['passed', 'failed'] },
  lanes: {
    type: 'array',
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
    items: { enum: ['vm', 'browser'] },
  },
  scenario: PROJECT_SCENARIO_SUMMARY,
  vm: { anyOf: [{ type: 'null' }, PROJECT_LANE] },
  browser: { anyOf: [{ type: 'null' }, PROJECT_LANE] },
  vmTracePath: { type: 'null' },
  browserTracePath: { type: 'null' },
  artifactIds: { type: 'array', maxItems: 0 },
})

const PROJECT_INSPECTION_ITEM = {
  anyOf: [
    PROJECT_TARGET_ITEM,
    PROJECT_SCRIPT_ITEM,
    PROJECT_BLOCK_ITEM,
    PROJECT_DECLARATION_ITEM,
    PROJECT_DIAGNOSTIC_ITEM,
    PROJECT_ARTIFACT,
    PROJECT_TRUNCATED_ITEM,
    closed({
      snapshotIndex: INTEGER,
      label: { anyOf: [{ type: 'null' }, PROJECT_STRING] },
      tick: INTEGER,
      targetCount: INTEGER,
      variableCount: INTEGER,
      listCount: INTEGER,
      hasVisual: { type: 'boolean' },
    }),
    PROJECT_RUN_RECORD,
    PROJECT_SNAPSHOT_STATE,
  ],
}

const PROJECT_PAGE = closed({
  requested: INTEGER,
  returned: INTEGER,
  total: INTEGER,
  nextCursor: { anyOf: [{ type: 'null' }, STRING] },
})

const PROJECT_BUDGET = closed({
  maxBytes: INTEGER,
  returnedBytes: INTEGER,
  truncatedItemCount: INTEGER,
})

const PROJECT_STAGES = closed({
  admission: { enum: ['not-run', 'passed', 'failed'] },
  schema: { enum: ['not-run', 'passed', 'failed'] },
  graph: { enum: ['not-run', 'passed', 'failed'] },
  static: { enum: ['not-run', 'passed', 'failed'] },
})

const PROJECT_STATIC_METRICS = {
  anyOf: [
    { type: 'null' },
    closed({
      targets: INTEGER,
      blocks: INTEGER,
      scripts: INTEGER,
      sprites: INTEGER,
      costumes: INTEGER,
      sounds: INTEGER,
      monitors: INTEGER,
      variables: INTEGER,
      lists: INTEGER,
      broadcasts: INTEGER,
      comments: INTEGER,
      extensions: INTEGER,
    }),
  ],
}

const PROJECT_SUMMARY = closed({
  text: { type: 'string', maxLength: 4 * 1024 },
  truncated: { type: 'boolean' },
  untrustedProjectData: { const: true },
})

const PROJECT_LIMITS = closed({
  sessions: INTEGER,
  runsPerSession: INTEGER,
  artifactBytesPerSession: INTEGER,
  pageSizeDefault: INTEGER,
  pageSizeMaximum: INTEGER,
  pageItemBytes: INTEGER,
  toolDataBytes: INTEGER,
  readableArtifactBytes: INTEGER,
  scenario: closed({
    maxRequestBytes: INTEGER,
    maxDepth: INTEGER,
    maxMembers: INTEGER,
    maxSteps: INTEGER,
    maxTicks: INTEGER,
    maxSnapshots: INTEGER,
    maxStringBytes: INTEGER,
    maxAnswerBytes: INTEGER,
    maxCoordinateMagnitude: INTEGER,
  }),
  network: { const: 'denied' },
  video: { const: false },
  runtimeContainment: { const: 'in-process-tick-bounded' },
  hardKillTimeout: { const: false },
})

function projectSuccessDataSchema(
  name: (typeof PROJECT_TOOL_NAMES)[number]
): JsonSchema
{
  switch (name)
  {
    case 'project_open':
      return closed({
        sessionId: STRING,
        state: { enum: ['ready', 'failed'] },
        input: closed({
          displayName: STRING,
          sha256: SHA256,
          byteLength: INTEGER,
        }),
        stages: PROJECT_STAGES,
        metrics: PROJECT_STATIC_METRICS,
        summary: PROJECT_SUMMARY,
        issues: {
          type: 'array',
          maxItems: 128,
          items: PROJECT_CHECK_ISSUE,
        },
        canRun: { type: 'boolean' },
        limits: PROJECT_LIMITS,
        artifacts: {
          type: 'array',
          maxItems: 4096,
          items: PROJECT_ARTIFACT,
        },
        createdAt: STRING,
        untrustedProjectData: { const: true },
      })
    case 'project_inspect':
      return closed({
        sessionId: STRING,
        queryKind: {
          enum: [
            'targets',
            'scripts',
            'script-blocks',
            'declarations',
            'diagnostics',
            'runs',
            'snapshots',
            'snapshot-state',
            'artifacts',
          ],
        },
        collectionVersion: STRING,
        items: {
          type: 'array',
          maxItems: 50,
          items: PROJECT_INSPECTION_ITEM,
        },
        page: PROJECT_PAGE,
        budget: PROJECT_BUDGET,
        untrustedProjectData: { const: true },
      })
    case 'project_run':
      return closed({
        sessionId: STRING,
        runId: STRING,
        status: { enum: ['passed', 'failed'] },
        lanes: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { enum: ['vm', 'browser'] },
        },
        scenario: PROJECT_SCENARIO_SUMMARY,
        vm: { anyOf: [{ type: 'null' }, PROJECT_LANE] },
        browser: { anyOf: [{ type: 'null' }, PROJECT_LANE] },
        artifacts: {
          type: 'array',
          maxItems: 4096,
          items: PROJECT_ARTIFACT,
        },
        completedAt: STRING,
        untrustedProjectData: { const: true },
      })
    case 'project_status':
      return closed({
        sessionId: STRING,
        state: { enum: ['ready', 'failed', 'running'] },
        input: closed({
          displayName: STRING,
          sha256: SHA256,
          byteLength: INTEGER,
        }),
        stages: PROJECT_STAGES,
        canRun: { type: 'boolean' },
        runCount: INTEGER,
        latestRun: { anyOf: [{ type: 'null' }, PROJECT_RUN_RECORD] },
        issues: {
          type: 'array',
          maxItems: 128,
          items: PROJECT_CHECK_ISSUE,
        },
        artifacts: {
          type: 'array',
          maxItems: 4096,
          items: PROJECT_ARTIFACT,
        },
        retention: closed({
          activeSessionLimit: INTEGER,
          activeSessionCount: INTEGER,
          runLimit: INTEGER,
          runsUsed: INTEGER,
          artifactByteLimit: INTEGER,
          artifactBytes: INTEGER,
          policy: { const: 'idle-lru-eviction' },
        }),
        createdAt: STRING,
        updatedAt: STRING,
        untrustedProjectData: { const: true },
      })
  }
}

// the closed replacement for the historical generic {type:'object'} data slot
export function projectOutputSchema(
  name: (typeof PROJECT_TOOL_NAMES)[number]
): JsonSchema
{
  return draft07TupleForm({
    $schema: 'http://json-schema.org/draft-07/schema#',
    $defs: PROJECT_SCHEMA_DEFINITIONS,
    ...closed(
      {
        schemaVersion: { const: 1 },
        tool: { const: name },
        data: projectSuccessDataSchema(name),
        error: closed({ code: STRING, message: STRING }),
      },
      ['schemaVersion', 'tool']
    ),
    oneOf: [{ required: ['data'] }, { required: ['error'] }],
  }) as JsonSchema
}

function freezeSchema(value: unknown): void
{
  if (value === null || typeof value !== 'object' || Object.isFrozen(value))
    return
  for (const entry of Object.values(value)) freezeSchema(entry)
  Object.freeze(value)
}

const PROJECT_OUTPUT_SCHEMAS = new Map(
  PROJECT_TOOL_NAMES.map((name) =>
  {
    const schema = projectOutputSchema(name)
    freezeSchema(schema)
    return [name, schema] as const
  })
)

const PROJECT_OUTPUT_SCHEMA_SHA256 = new Map(
  [...PROJECT_OUTPUT_SCHEMAS].map(([name, schema]) => [
    name,
    sha256Hex(canonicalJsonBytesV1(schema)),
  ])
)

export function internalProjectOutputSchema(
  name: (typeof PROJECT_TOOL_NAMES)[number]
): JsonSchema
{
  return PROJECT_OUTPUT_SCHEMAS.get(name) as JsonSchema
}

export function internalProjectOutputSchemaSha256(
  name: (typeof PROJECT_TOOL_NAMES)[number]
): string
{
  return PROJECT_OUTPUT_SCHEMA_SHA256.get(name) as string
}
