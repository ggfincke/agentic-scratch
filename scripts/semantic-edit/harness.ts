// scripts/semantic-edit/harness.ts
// shared generic fixtures, authority manifests, & H-P8 acceptance contracts

import { createHash } from 'node:crypto'
import {
  existsSync,
  openSync,
  closeSync,
  constants,
  fstatSync,
  readSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

import {
  DEFAULT_PHASE_8_RESOURCE_POLICY,
  EDIT_TOOL_DESCRIPTORS,
  EDIT_TOOL_NAMES,
  PROJECT_TOOL_NAMES,
  assertApprovedA0SemanticAuthorityV1,
  type EditToolName,
  type EditToolReceiptFreeResultV1,
  type NonToolReceiptFreeOutcomeHashProjectionV1,
  type ProjectToolReceiptFreeOutcomeHashProjectionV1,
} from '@scratch-agent/edit'
import { blankProject } from '@scratch-agent/ir'
import {
  EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
  boundaryReceiptFreeOutcomeSha256V1,
  editReceiptFreeOutcomeSha256V1,
  editTransportRequestSha256V1,
  productionEditProfileAuthoritySha256V1,
  projectOutputSchema,
  projectReceiptFreeOutcomeSha256V1,
} from '@scratch-agent/mcp'
import { collectVersions, type RunVersions } from '@scratch-agent/runner'
import { scanStrictJson } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import { pngChunk } from '../lib/png.js'
import { sha256Hex } from '../lib/hash.js'
import { portableRelativePath } from '../lib/path.js'
import {
  ensurePrivateDirectory as ensurePrivateDirectoryPrimitive,
  writeExclusivePrivateFile,
} from '../lib/private-fs.js'

import {
  executionArtifactSnapshotIsAuthoritative,
  executionArtifactSnapshotsMatch,
  multimodalExecutionArtifactSnapshot,
  multimodalSourceSnapshot,
  requireRunRootOutsideSourceInventory,
  retainExecutionArtifactSnapshot,
  retainSourceSnapshot,
  sourceSnapshotIsAuthoritative,
  sourceSnapshotsMatch,
  type ExecutionArtifactManifestIdentityV1,
  type ExecutionArtifactSnapshotV1,
  type SourceManifestIdentityV1,
  type SourceSnapshotV1,
} from '@scratch-agent/eval'

export const SEMANTIC_EDIT_TOOL_ALLOWLIST = Object.freeze([
  ...PROJECT_TOOL_NAMES,
  ...EDIT_TOOL_NAMES,
])

const SEMANTIC_EDIT_PROTOCOL_TRACE_KINDS = Object.freeze([
  'raw-frame-rejected',
  'invalid-utf8',
  'invalid-json',
  'invalid-json-rpc',
  'unknown-method',
  'forbidden-method',
  'schema-rejected',
  'admission-refused',
] as const)

const SEMANTIC_EDIT_STATEFUL_TOOLS = Object.freeze([
  'edit_begin',
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_export',
  'edit_close',
] as const)

type SemanticEditBenchmarkWorkflowIdV1 =
  'behavior-preserving-rename' | 'greenfield-media-addition'

type SemanticEditNegativeProbeIdV1 =
  | 'stale-authority'
  | 'ambiguous-selector'
  | 'source-drift'
  | 'root-denial'
  | 'symlink-denial'
  | 'output-path-policy-denial'
  | 'evaluation-unavailable'
  | 'evaluation-inconclusive'
  | 'audit-near-full'
  | 'response-loss-idempotent-retry'
  | 'predecessor-recovery'

interface SemanticEditBenchmarkWorkflowV1
{
  readonly id: SemanticEditBenchmarkWorkflowIdV1
  readonly sourceKind: 'generated-project' | 'pinned-greenfield-template'
  readonly operationFamilies: readonly string[]
  readonly requiredProof: readonly string[]
  readonly requiredTools: readonly string[]
}

interface SemanticEditNegativeProbeV1
{
  readonly id: SemanticEditNegativeProbeIdV1
  readonly expectedDisposition: string
  readonly requiredEvidence: readonly string[]
}

export const SEMANTIC_EDIT_BENCHMARK_WORKFLOWS = Object.freeze([
  Object.freeze({
    id: 'behavior-preserving-rename',
    sourceKind: 'generated-project',
    operationFamilies: Object.freeze(['target.renameSprite']),
    requiredProof: Object.freeze([
      'structural-required-change',
      'runtime-preservation',
      'revision-delta-lineage',
      'certificate',
      'export-reopen',
    ]),
    requiredTools: Object.freeze([
      'project_open',
      'edit_capabilities',
      'edit_begin',
      'edit_inspect',
      'edit_preview',
      'edit_apply',
      'edit_checkpoint',
      'edit_evaluate',
      'edit_status',
      'edit_export',
      'project_open',
      'edit_close',
    ]),
  }),
  Object.freeze({
    id: 'greenfield-media-addition',
    sourceKind: 'pinned-greenfield-template',
    operationFamilies: Object.freeze(['target.addSprite', 'media.addCostume']),
    requiredProof: Object.freeze([
      'asset-admission',
      'greenfield-shape',
      'runtime-required-change',
      'revision-delta-lineage',
      'certificate',
      'export-reopen',
    ]),
    requiredTools: Object.freeze([
      'edit_capabilities',
      'edit_begin',
      'edit_asset_admit',
      'edit_inspect',
      'edit_preview',
      'edit_apply',
      'edit_evaluate',
      'edit_status',
      'edit_export',
      'project_open',
      'edit_close',
    ]),
  }),
] as const satisfies readonly SemanticEditBenchmarkWorkflowV1[])

export const SEMANTIC_EDIT_NEGATIVE_PROBES = Object.freeze([
  Object.freeze({
    id: 'stale-authority',
    expectedDisposition: 'edit.stale_revision',
    requiredEvidence: Object.freeze(['refusal', 'unchanged-head']),
  }),
  Object.freeze({
    id: 'ambiguous-selector',
    expectedDisposition: 'edit.selector_ambiguous',
    requiredEvidence: Object.freeze(['match-count', 'unchanged-head']),
  }),
  Object.freeze({
    id: 'source-drift',
    expectedDisposition: 'edit.source_identity_mismatch',
    requiredEvidence: Object.freeze(['source-provenance', 'lease-release']),
  }),
  Object.freeze({
    id: 'root-denial',
    expectedDisposition: 'host-root-refusal',
    requiredEvidence: Object.freeze(['root-ownership', 'no-host-read']),
  }),
  Object.freeze({
    id: 'symlink-denial',
    expectedDisposition: 'host-symlink-refusal',
    requiredEvidence: Object.freeze(['no-follow', 'no-host-read']),
  }),
  Object.freeze({
    id: 'output-path-policy-denial',
    expectedDisposition: 'bounded-output-policy-refusal',
    requiredEvidence: Object.freeze(['source-unchanged', 'no-output']),
  }),
  Object.freeze({
    id: 'evaluation-unavailable',
    expectedDisposition: 'edit.evaluation_unavailable',
    requiredEvidence: Object.freeze([
      'required-plan',
      'unavailable-certificate',
      'no-export',
    ]),
  }),
  Object.freeze({
    id: 'evaluation-inconclusive',
    expectedDisposition: 'edit.evaluation_inconclusive',
    requiredEvidence: Object.freeze(['required-plan', 'no-export']),
  }),
  Object.freeze({
    id: 'audit-near-full',
    expectedDisposition: 'audit-admission-refusal',
    requiredEvidence: Object.freeze(['completion-reserve', 'tail-valid']),
  }),
  Object.freeze({
    id: 'response-loss-idempotent-retry',
    expectedDisposition: 'same-retained-outcome',
    requiredEvidence: Object.freeze(['single-mutation', 'same-result-hash']),
  }),
  Object.freeze({
    id: 'predecessor-recovery',
    expectedDisposition: 'successor-after-terminalization',
    requiredEvidence: Object.freeze([
      'predecessor-tail-anchor',
      'read-only-predecessor',
    ]),
  }),
] as const satisfies readonly SemanticEditNegativeProbeV1[])

export interface SemanticEditRunLayoutV1
{
  readonly runRoot: string
  readonly inputRoot: string
  readonly assetInputRoot: string
  readonly outputRoot: string
  readonly editPrivateRoot: string
  readonly readableArtifactRoot: string
  readonly evidenceRoot: string
  readonly configRoot: string
  readonly replayRoot: string
  readonly workspaceRoot: string
}

export interface SemanticEditGeneratedInputsV1
{
  readonly behaviorProject: {
    readonly path: string
    readonly sha256: string
    readonly byteLength: number
  }
  readonly mediaAsset: {
    readonly path: string
    readonly sha256: string
    readonly byteLength: number
    readonly mediaType: 'image/png'
  }
}

interface SemanticEditAuthoritySnapshotV1
{
  readonly source: SourceSnapshotV1
  readonly sourceManifest: SourceManifestIdentityV1
  readonly executable: ExecutionArtifactSnapshotV1
  readonly executableManifest: ExecutionArtifactManifestIdentityV1
}

interface SemanticEditStaticAuthorityV1
{
  readonly semanticAuthority: ReturnType<
    typeof assertApprovedA0SemanticAuthorityV1
  >
  readonly profileSha256: string
  readonly discoveryProfileSha256: string
  readonly schemaSha256: string
  readonly policySha256: string
  readonly runtimeSha256: string
  readonly versions: RunVersions
  readonly toolAllowlist: readonly string[]
}

interface SemanticEditEvidenceCallV1
{
  readonly sequence: number
  readonly boundary: 'tool' | 'resource-list' | 'resource-read' | 'protocol'
  readonly name: string
  readonly callId: string
  readonly requestSha256: string
  readonly outcomeSha256: string
  readonly beginRecordSha256: string
  readonly completeRecordSha256: string
  readonly eventSha256: string | null
}

export interface SemanticEditAcceptedEvidenceV1
{
  readonly schemaVersion: 1
  readonly serverInstanceId: string
  readonly invocationPrincipalSha256: string
  readonly journalRunId: string
  readonly journalStoreKey: string
  readonly journalAuditKeyId: string
  readonly journalRealmSha256: string
  readonly journalProfileSha256: string
  readonly journalBoundaryPolicySha256: string
  readonly journalPredecessor:
    | { readonly state: 'absent' }
    | {
        readonly state: 'present'
        readonly storeKey: string
        readonly finalTailSha256: string
      }
  readonly serverAuditHeadSha256: string
  readonly terminalSha256: string
  readonly auditRecordCount: number
  readonly auditRecordBytes: number
  readonly semanticEventHeads: readonly {
    readonly sessionId: string
    readonly eventHeadSha256: string
  }[]
  readonly unmatchedAuditBegins: 0
  readonly calls: readonly SemanticEditEvidenceCallV1[]
  readonly revisionSha256s: readonly string[]
  readonly parentDeltaSha256s: readonly string[]
  readonly cumulativeDeltaSha256s: readonly string[]
  readonly preservationSha256s: readonly string[]
  readonly lineageSha256s: readonly string[]
  readonly certificateSha256s: readonly string[]
  readonly reportProjectionSha256s: readonly string[]
  readonly exportReceiptSha256s: readonly string[]
  readonly resourceUseSha256: string
  readonly bootstrapDescriptorSha256: string
  readonly bootstrapDescriptorCanonicalSha256: string
  readonly contractRegistrySha256: string
  readonly contractRegistryArtifactSetSha256: string
  readonly secretMaterialSha256: string
  readonly predecessorHandoffSha256: string | null
  readonly hostManifestSha256: string
}

export interface SemanticEditTraceRecordV1
{
  readonly sequence: number
  readonly boundary: SemanticEditEvidenceCallV1['boundary'] | 'protocol'
  readonly name: string
  readonly requestSha256: string
  readonly outcomeSha256: string
  readonly rawRequest: unknown
  readonly rawOutcome: unknown
  readonly outcomeIsError: boolean
  readonly callId: string | null
  readonly beginRecordSha256: string | null
  readonly completeRecordSha256: string | null
  readonly eventSha256: string | null
  readonly ok: boolean
}

interface SemanticEditTraceReconciliationV1
{
  readonly ok: boolean
  readonly traceRecords: number
  readonly evidenceCalls: number
  readonly matchedCalls: number
  readonly failures: readonly string[]
  readonly serverAuditHeadSha256: string
  readonly semanticEventHeads: readonly string[]
}

interface GenericSemanticEditObjectiveV1
{
  readonly objectiveId: string
  readonly operationFamily:
    | 'target'
    | 'declaration'
    | 'script'
    | 'block'
    | 'procedure'
    | 'media'
    | 'greenfield'
  readonly instruction: string
}

interface GenericSemanticEditWorkflowConfigV1
{
  readonly schemaVersion: 1
  readonly inputPath: string
  readonly outputBasename: string
  readonly contractRole: 'behavior' | 'media'
  readonly assets: readonly {
    readonly assetId: string
    readonly sourcePath: string
    readonly expectedSha256: string
    readonly expectedByteLength: number
    readonly mediaKind: 'costume' | 'sound'
  }[]
  readonly objectives: readonly GenericSemanticEditObjectiveV1[]
  readonly requiredEvidence: readonly (
    'structural' | 'runtime' | 'preservation' | 'certificate' | 'export-reopen'
  )[]
  readonly maximumDurationMs: number
}

export interface SemanticEditHostBootstrapDescriptorV1
{
  readonly schemaVersion: 1
  readonly kind: 'production-stdio-edit-host-v1'
  readonly principalSha256: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly authoritativeBuildManifestSha256: string
  readonly behaviorContract: {
    readonly registrationId: string
    readonly semanticContractSha256: string
    readonly evaluationPlanId: string
  }
  readonly mediaContract: {
    readonly registrationId: string
    readonly semanticContractSha256: string
    readonly evaluationPlanId: string
    readonly templateId: string
    readonly templateVersion: string
    readonly templateArtifactSha256: string
  }
  readonly contractRegistryRelativePath: string
  readonly secretMaterialRelativePath: string
  readonly evidenceSummaryRelativePath: string
  readonly predecessorManifestRelativePath: string | null
  readonly operatorFixture?: {
    readonly kind: 'semantic-edit-benchmark-v1'
    readonly auditLimits?: {
      readonly recordCap: number
      readonly byteCap: number
    }
    readonly evaluationDisposition?:
      'required-lane-unavailable' | 'required-lane-inconclusive'
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u
const LOCAL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u
const OUTPUT_BASENAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.sb3$/u
const MAX_CONFIG_BYTES = 256 * 1024
export const MAX_SEMANTIC_EDIT_EVIDENCE_BYTES = 32 * 1024 * 1024

export function sha256(value: Uint8Array | string): string
{
  return sha256Hex(value)
}

export function canonicalSha256(value: unknown): string
{
  return sha256(canonicalJsonBytesV1(value))
}

export function portablePath(root: string, path: string): string
{
  return portableRelativePath(root, path)
}

export function ensurePrivateDirectory(path: string): void
{
  ensurePrivateDirectoryPrimitive(path)
}

export function writeExclusive(path: string, value: Uint8Array | string): void
{
  writeExclusivePrivateFile(path, value)
}

export function writeJsonExclusive(path: string, value: unknown): void
{
  writeExclusive(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function createSemanticEditRunLayoutV1(
  runsRoot: string,
  runId: string
): SemanticEditRunLayoutV1
{
  const resolvedRunsRoot = resolve(runsRoot)
  const runRoot = join(resolvedRunsRoot, runId)
  requireRunRootOutsideSourceInventory(runRoot)
  const layout = Object.freeze({
    runRoot,
    inputRoot: join(runRoot, 'roots/input'),
    assetInputRoot: join(runRoot, 'roots/asset-input'),
    outputRoot: join(runRoot, 'roots/output'),
    editPrivateRoot: join(runRoot, 'roots/edit-private'),
    readableArtifactRoot: join(runRoot, 'roots/readable-artifact'),
    evidenceRoot: join(runRoot, 'evidence'),
    configRoot: join(runRoot, 'config'),
    replayRoot: join(runRoot, 'replay'),
    workspaceRoot: join(runRoot, 'workspace'),
  })
  for (const path of [resolvedRunsRoot, ...Object.values(layout)])
    ensurePrivateDirectory(path)
  return layout
}

function solidPng(width: number, height: number): Uint8Array
{
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  header[8] = 8
  header[9] = 6
  const raw: number[] = []
  for (let row = 0; row < height; row++)
  {
    raw.push(0)
    for (let column = 0; column < width; column++)
      raw.push(0x20, 0x80, 0xd0, 0xff)
  }
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', deflateSync(Uint8Array.from(raw))),
    ...pngChunk('IEND', new Uint8Array()),
  ])
}

export async function writeGeneratedSemanticEditInputsV1(
  layout: SemanticEditRunLayoutV1
): Promise<SemanticEditGeneratedInputsV1>
{
  const project = blankProject()
  const costumeBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#4c97ff"/></svg>',
    'utf8'
  )
  const costumeAssetId = createHash('md5').update(costumeBytes).digest('hex')
  const costume = {
    name: 'benchmark-costume',
    assetId: costumeAssetId,
    md5ext: `${costumeAssetId}.svg`,
    dataFormat: 'svg' as const,
    bitmapResolution: 1 as const,
    rotationCenterX: 10,
    rotationCenterY: 10,
  }
  const actor = project.addSprite('Benchmark Actor', { x: 0, y: 0 })
  actor.addCostume(costume, costumeBytes)
  actor.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
    { opcode: 'motion_changexby', inputs: { DX: 10 } },
  ])
  const secondActor = project.addSprite('Second Actor', { x: -20, y: 15 })
  secondActor.addCostume(costume, costumeBytes)
  secondActor.addScript([{ opcode: 'event_whenflagclicked' }])
  const behaviorBytes = await project.toSb3()
  const behaviorPath = join(layout.inputRoot, 'behavior-project.sb3')
  writeExclusive(behaviorPath, behaviorBytes)
  const mediaBytes = solidPng(8, 8)
  const mediaPath = join(layout.assetInputRoot, 'additive-costume.png')
  writeExclusive(mediaPath, mediaBytes)
  return Object.freeze({
    behaviorProject: Object.freeze({
      path: behaviorPath,
      sha256: sha256(behaviorBytes),
      byteLength: behaviorBytes.byteLength,
    }),
    mediaAsset: Object.freeze({
      path: mediaPath,
      sha256: sha256(mediaBytes),
      byteLength: mediaBytes.byteLength,
      mediaType: 'image/png' as const,
    }),
  })
}

export function captureSemanticEditAuthorityV1(
  runRoot: string,
  name: 'start' | 'pre-agent' | 'completion'
): SemanticEditAuthoritySnapshotV1
{
  const source = multimodalSourceSnapshot()
  const executable = multimodalExecutionArtifactSnapshot()
  const sourceManifest = retainSourceSnapshot(runRoot, name, source)
  const executableManifest = retainExecutionArtifactSnapshot(
    runRoot,
    name,
    executable
  )
  if (!sourceSnapshotIsAuthoritative(source))
    throw new Error(`source authority is unavailable: ${source.issue}`)
  if (!executionArtifactSnapshotIsAuthoritative(executable))
    throw new Error(
      `executable artifact authority is unavailable: ${executable.issue}`
    )
  return Object.freeze({
    source,
    sourceManifest,
    executable,
    executableManifest,
  })
}

export function semanticEditAuthoritySnapshotsMatchV1(
  left: SemanticEditAuthoritySnapshotV1,
  right: SemanticEditAuthoritySnapshotV1
): boolean
{
  return (
    sourceSnapshotsMatch(left.source, right.source) &&
    executionArtifactSnapshotsMatch(left.executable, right.executable)
  )
}

export function semanticEditStaticAuthorityV1(): SemanticEditStaticAuthorityV1
{
  const versions = collectVersions()
  return Object.freeze({
    semanticAuthority: assertApprovedA0SemanticAuthorityV1(),
    profileSha256: productionEditProfileAuthoritySha256V1(
      EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1
    ),
    discoveryProfileSha256: canonicalSha256({
      schemaVersion: 1,
      toolOrder: SEMANTIC_EDIT_TOOL_ALLOWLIST,
    }),
    schemaSha256: canonicalSha256({
      schemaVersion: 1,
      descriptors: EDIT_TOOL_DESCRIPTORS,
    }),
    policySha256: canonicalSha256(DEFAULT_PHASE_8_RESOURCE_POLICY),
    runtimeSha256: canonicalSha256({ schemaVersion: 1, versions }),
    versions,
    toolAllowlist: SEMANTIC_EDIT_TOOL_ALLOWLIST,
  })
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void
{
  const actual = Object.keys(value).sort()
  const wanted = [...expected].sort()
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new Error(`${label} has unknown or missing fields`)
}

function record(value: unknown, label: string): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export function readBoundedRegularFileV1(
  path: string,
  maximumBytes: number,
  label: string
): Uint8Array
{
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error(`${label} byte limit is invalid`)
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try
  {
    const info = fstatSync(descriptor, { bigint: true })
    if (!info.isFile()) throw new Error(`${label} must be a regular file`)
    if (info.size > BigInt(maximumBytes))
      throw new Error(`${label} exceeds ${maximumBytes} bytes`)
    const bytes = Buffer.alloc(Number(info.size))
    let offset = 0
    while (offset < bytes.byteLength)
    {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        null
      )
      if (count === 0) break
      offset += count
    }
    if (offset !== bytes.byteLength)
      throw new Error(`${label} changed while it was read`)
    const finalInfo = fstatSync(descriptor, { bigint: true })
    if (
      finalInfo.dev !== info.dev ||
      finalInfo.ino !== info.ino ||
      finalInfo.size !== info.size ||
      finalInfo.mtimeNs !== info.mtimeNs
    )
      throw new Error(`${label} changed while it was read`)
    return bytes
  }
  finally
  {
    closeSync(descriptor)
  }
}

export function readBoundedJsonV1(
  path: string,
  label: string,
  maximumBytes = MAX_CONFIG_BYTES
): unknown
{
  if (
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < 1 ||
    maximumBytes > MAX_SEMANTIC_EDIT_EVIDENCE_BYTES
  )
    throw new Error(`${label} JSON byte limit is invalid`)
  const bytes = readBoundedRegularFileV1(path, maximumBytes, label)
  try
  {
    return scanStrictJson(bytes, {
      maxDepth: 32,
      maxMembersPerContainer: 32_768,
      maxNodes: 1_000_000,
    }).value
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : 'invalid JSON'
    throw new Error(`${label} is not strict bounded JSON: ${message}`)
  }
}

export function parseGenericSemanticEditWorkflowConfigV1(
  value: unknown
): GenericSemanticEditWorkflowConfigV1
{
  const input = record(value, 'workflow config')
  exactKeys(
    input,
    [
      'schemaVersion',
      'inputPath',
      'outputBasename',
      'contractRole',
      ...(input.assets === undefined ? [] : ['assets']),
      'objectives',
      'requiredEvidence',
      'maximumDurationMs',
    ],
    'workflow config'
  )
  if (
    input.schemaVersion !== 1 ||
    typeof input.inputPath !== 'string' ||
    !isAbsolute(input.inputPath) ||
    !OUTPUT_BASENAME_PATTERN.test(String(input.outputBasename)) ||
    (input.contractRole !== 'behavior' && input.contractRole !== 'media') ||
    !Array.isArray(input.objectives) ||
    input.objectives.length < 1 ||
    input.objectives.length > 8 ||
    !Array.isArray(input.requiredEvidence) ||
    !Number.isSafeInteger(input.maximumDurationMs) ||
    Number(input.maximumDurationMs) < 60_000 ||
    Number(input.maximumDurationMs) > 60 * 60 * 1000
  )
    throw new Error('workflow config has invalid bounds or identifiers')
  const assetValues = input.assets ?? []
  if (!Array.isArray(assetValues) || assetValues.length > 16)
    throw new Error('workflow assets exceed their bounded cardinality')
  const assets = assetValues.map((entry, index) =>
  {
    const asset = record(entry, `workflow asset ${index}`)
    exactKeys(
      asset,
      [
        'assetId',
        'sourcePath',
        'expectedSha256',
        'expectedByteLength',
        'mediaKind',
      ],
      `workflow asset ${index}`
    )
    if (
      typeof asset.assetId !== 'string' ||
      !LOCAL_KEY_PATTERN.test(asset.assetId) ||
      typeof asset.sourcePath !== 'string' ||
      !isAbsolute(asset.sourcePath) ||
      typeof asset.expectedSha256 !== 'string' ||
      !SHA256_PATTERN.test(asset.expectedSha256) ||
      !Number.isSafeInteger(asset.expectedByteLength) ||
      Number(asset.expectedByteLength) < 1 ||
      Number(asset.expectedByteLength) > 25 * 1024 * 1024 ||
      (asset.mediaKind !== 'costume' && asset.mediaKind !== 'sound')
    )
      throw new Error(`workflow asset ${index} is invalid`)
    return Object.freeze({
      assetId: asset.assetId,
      sourcePath: resolve(asset.sourcePath),
      expectedSha256: asset.expectedSha256,
      expectedByteLength: Number(asset.expectedByteLength),
      mediaKind: asset.mediaKind,
    })
  })
  if (
    new Set(assets.map((asset) => asset.assetId)).size !== assets.length ||
    new Set(assets.map((asset) => asset.sourcePath)).size !== assets.length ||
    assets.reduce((total, asset) => total + asset.expectedByteLength, 0) >
      100 * 1024 * 1024
  )
    throw new Error(
      'workflow assets repeat identity/path or exceed total bytes'
    )
  if (assets.length > 0 && input.contractRole !== 'media')
    throw new Error('workflow assets require the host media contract role')
  const families = new Set([
    'target',
    'declaration',
    'script',
    'block',
    'procedure',
    'media',
    'greenfield',
  ])
  const objectives = input.objectives.map((entry, index) =>
  {
    const objective = record(entry, `objective ${index}`)
    exactKeys(
      objective,
      ['objectiveId', 'operationFamily', 'instruction'],
      `objective ${index}`
    )
    if (
      typeof objective.objectiveId !== 'string' ||
      !LOCAL_KEY_PATTERN.test(objective.objectiveId) ||
      typeof objective.operationFamily !== 'string' ||
      !families.has(objective.operationFamily) ||
      typeof objective.instruction !== 'string' ||
      objective.instruction.length < 1 ||
      Buffer.byteLength(objective.instruction, 'utf8') > 2048
    )
      throw new Error(`objective ${index} is invalid`)
    return Object.freeze({
      objectiveId: objective.objectiveId,
      operationFamily: objective.operationFamily,
      instruction: objective.instruction,
    }) as GenericSemanticEditObjectiveV1
  })
  if (
    new Set(objectives.map((entry) => entry.objectiveId)).size !==
    objectives.length
  )
    throw new Error('workflow objective IDs must be unique')
  const evidenceValues = new Set([
    'structural',
    'runtime',
    'preservation',
    'certificate',
    'export-reopen',
  ])
  if (
    input.requiredEvidence.length < 1 ||
    input.requiredEvidence.length > evidenceValues.size ||
    input.requiredEvidence.some(
      (entry) => typeof entry !== 'string' || !evidenceValues.has(entry)
    ) ||
    new Set(input.requiredEvidence).size !== input.requiredEvidence.length
  )
    throw new Error('workflow required evidence is invalid')
  const inputPath = resolve(input.inputPath)
  if (!existsSync(inputPath) || !inputPath.toLowerCase().endsWith('.sb3'))
    throw new Error('workflow input must name an existing .sb3 file')
  return Object.freeze({
    schemaVersion: 1,
    inputPath,
    outputBasename: String(input.outputBasename),
    contractRole: input.contractRole,
    assets: Object.freeze(assets),
    objectives: Object.freeze(objectives),
    requiredEvidence: Object.freeze(
      input.requiredEvidence.map(String)
    ) as GenericSemanticEditWorkflowConfigV1['requiredEvidence'],
    maximumDurationMs: Number(input.maximumDurationMs),
  })
}

export function parseSemanticEditHostBootstrapDescriptorV1(
  value: unknown
): SemanticEditHostBootstrapDescriptorV1
{
  const input = record(value, 'edit host bootstrap descriptor')
  const descriptorKeys = [
    'schemaVersion',
    'kind',
    'principalSha256',
    'pinnedScratchRuntimeSourceSha256',
    'authoritativeBuildManifestSha256',
    'behaviorContract',
    'mediaContract',
    'contractRegistryRelativePath',
    'secretMaterialRelativePath',
    'evidenceSummaryRelativePath',
    'predecessorManifestRelativePath',
    ...(input.operatorFixture === undefined ? [] : ['operatorFixture']),
  ]
  exactKeys(input, descriptorKeys, 'edit host bootstrap descriptor')
  const behavior = record(input.behaviorContract, 'behavior contract')
  const media = record(input.mediaContract, 'media contract')
  const operatorFixture =
    input.operatorFixture === undefined
      ? null
      : record(input.operatorFixture, 'operator fixture')
  exactKeys(
    behavior,
    ['registrationId', 'semanticContractSha256', 'evaluationPlanId'],
    'behavior contract'
  )
  if (operatorFixture)
  {
    const fixtureKeys = [
      'kind',
      ...(operatorFixture.auditLimits === undefined ? [] : ['auditLimits']),
      ...(operatorFixture.evaluationDisposition === undefined
        ? []
        : ['evaluationDisposition']),
    ]
    exactKeys(operatorFixture, fixtureKeys, 'operator fixture')
    if (fixtureKeys.length < 2)
      throw new Error('operator fixture cannot be empty')
    if (operatorFixture.auditLimits !== undefined)
    {
      const limits = record(
        operatorFixture.auditLimits,
        'operator fixture audit limits'
      )
      exactKeys(
        limits,
        ['recordCap', 'byteCap'],
        'operator fixture audit limits'
      )
      const recordCap = Number(limits.recordCap)
      const byteCap = Number(limits.byteCap)
      const reserveRecords = Math.max(Math.ceil(recordCap / 10), 128)
      if (
        !Number.isSafeInteger(recordCap) ||
        recordCap < reserveRecords + 4 ||
        recordCap > 32_768 ||
        !Number.isSafeInteger(byteCap) ||
        byteCap < (reserveRecords + 4) * 8 * 1024 ||
        byteCap > 512 * 1024 * 1024
      )
        throw new Error('operator fixture audit limits are outside authority')
    }
    if (
      operatorFixture.kind !== 'semantic-edit-benchmark-v1' ||
      (operatorFixture.evaluationDisposition !== undefined &&
        operatorFixture.evaluationDisposition !== 'required-lane-unavailable' &&
        operatorFixture.evaluationDisposition !== 'required-lane-inconclusive')
    )
      throw new Error('operator fixture is invalid')
  }
  exactKeys(
    media,
    [
      'registrationId',
      'semanticContractSha256',
      'evaluationPlanId',
      'templateId',
      'templateVersion',
      'templateArtifactSha256',
    ],
    'media contract'
  )
  const validContract = (contract: Record<string, unknown>): boolean =>
    typeof contract.registrationId === 'string' &&
    OPAQUE_ID_PATTERN.test(contract.registrationId) &&
    typeof contract.semanticContractSha256 === 'string' &&
    SHA256_PATTERN.test(contract.semanticContractSha256) &&
    typeof contract.evaluationPlanId === 'string' &&
    LOCAL_KEY_PATTERN.test(contract.evaluationPlanId)
  if (
    input.schemaVersion !== 1 ||
    input.kind !== 'production-stdio-edit-host-v1' ||
    typeof input.principalSha256 !== 'string' ||
    !SHA256_PATTERN.test(input.principalSha256) ||
    typeof input.pinnedScratchRuntimeSourceSha256 !== 'string' ||
    !SHA256_PATTERN.test(input.pinnedScratchRuntimeSourceSha256) ||
    typeof input.authoritativeBuildManifestSha256 !== 'string' ||
    !SHA256_PATTERN.test(input.authoritativeBuildManifestSha256) ||
    !validContract(behavior) ||
    !validContract(media) ||
    typeof media.templateId !== 'string' ||
    !LOCAL_KEY_PATTERN.test(media.templateId) ||
    typeof media.templateVersion !== 'string' ||
    media.templateVersion.length < 1 ||
    media.templateVersion.length > 64 ||
    typeof media.templateArtifactSha256 !== 'string' ||
    !SHA256_PATTERN.test(media.templateArtifactSha256) ||
    typeof input.contractRegistryRelativePath !== 'string' ||
    typeof input.secretMaterialRelativePath !== 'string' ||
    typeof input.evidenceSummaryRelativePath !== 'string' ||
    (input.predecessorManifestRelativePath !== null &&
      typeof input.predecessorManifestRelativePath !== 'string')
  )
    throw new Error('edit host bootstrap descriptor is invalid')
  for (const path of [
    input.contractRegistryRelativePath,
    input.secretMaterialRelativePath,
    input.evidenceSummaryRelativePath,
    ...(input.predecessorManifestRelativePath === null
      ? []
      : [input.predecessorManifestRelativePath]),
  ])
    if (
      path.length < 1 ||
      isAbsolute(path) ||
      path.split(/[\\/]/u).some((part) => part === '' || part === '..') ||
      resolve('/', path) === '/'
    )
      throw new Error('bootstrap evidence paths must stay relative')
  if (
    !input.evidenceSummaryRelativePath.startsWith('evidence/') ||
    !input.evidenceSummaryRelativePath.endsWith('.json')
  )
    throw new Error('accepted evidence must stay in its reserved namespace')
  return input as unknown as SemanticEditHostBootstrapDescriptorV1
}

export interface SemanticEditAcceptedEvidenceAuthorityV1
{
  readonly invocationPrincipalSha256: string
  readonly journalProfileSha256: string
  readonly bootstrapDescriptorSha256: string
  readonly bootstrapDescriptorCanonicalSha256: string
  readonly contractRegistrySha256: string
  readonly contractRegistryArtifactSetSha256: string
  readonly secretMaterialSha256: string
  readonly predecessorHandoffSha256: string | null
  readonly hostManifestSha256: string
}

function sortedUniqueSha256s(value: unknown, label: string): readonly string[]
{
  if (
    !Array.isArray(value) ||
    value.length > 32_768 ||
    value.some(
      (entry) => typeof entry !== 'string' || !SHA256_PATTERN.test(entry)
    )
  )
    throw new Error(`${label} is not one bounded SHA-256 array`)
  const strings = value.filter(
    (entry): entry is string =>
      typeof entry === 'string' && SHA256_PATTERN.test(entry)
  )
  if (
    strings.some(
      (entry, index) =>
        index > 0 && strings[index - 1]!.localeCompare(entry) >= 0
    )
  )
    throw new Error(`${label} must be sorted and unique`)
  return Object.freeze([...strings])
}

function matchingString(
  value: unknown,
  pattern: RegExp,
  label: string
): string
{
  if (typeof value !== 'string' || !pattern.test(value))
    throw new Error(`${label} is invalid`)
  return value
}

function boundedSafeInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): number
{
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    throw new Error(`${label} is invalid`)
  return Number(value)
}

export function parseSemanticEditAcceptedEvidenceV1(
  value: unknown,
  authority: SemanticEditAcceptedEvidenceAuthorityV1
): SemanticEditAcceptedEvidenceV1
{
  const input = record(value, 'semantic edit accepted evidence')
  exactKeys(
    input,
    [
      'schemaVersion',
      'serverInstanceId',
      'invocationPrincipalSha256',
      'journalRunId',
      'journalStoreKey',
      'journalAuditKeyId',
      'journalRealmSha256',
      'journalProfileSha256',
      'journalBoundaryPolicySha256',
      'journalPredecessor',
      'serverAuditHeadSha256',
      'terminalSha256',
      'auditRecordCount',
      'auditRecordBytes',
      'semanticEventHeads',
      'unmatchedAuditBegins',
      'calls',
      'revisionSha256s',
      'parentDeltaSha256s',
      'cumulativeDeltaSha256s',
      'preservationSha256s',
      'lineageSha256s',
      'certificateSha256s',
      'reportProjectionSha256s',
      'exportReceiptSha256s',
      'resourceUseSha256',
      'bootstrapDescriptorSha256',
      'bootstrapDescriptorCanonicalSha256',
      'contractRegistrySha256',
      'contractRegistryArtifactSetSha256',
      'secretMaterialSha256',
      'predecessorHandoffSha256',
      'hostManifestSha256',
    ],
    'semantic edit accepted evidence'
  )
  const predecessor = record(
    input.journalPredecessor,
    'semantic edit journal predecessor'
  )
  let journalPredecessor: SemanticEditAcceptedEvidenceV1['journalPredecessor']
  if (predecessor.state === 'absent')
  {
    exactKeys(predecessor, ['state'], 'semantic edit journal predecessor')
    journalPredecessor = Object.freeze({ state: 'absent' })
  }
  else
  {
    exactKeys(
      predecessor,
      ['state', 'storeKey', 'finalTailSha256'],
      'semantic edit journal predecessor'
    )
    if (predecessor.state !== 'present')
      throw new Error('semantic edit journal predecessor is invalid')
    journalPredecessor = Object.freeze({
      state: 'present',
      storeKey: matchingString(
        predecessor.storeKey,
        /^[a-z0-9][a-z0-9._-]{0,63}$/u,
        'semantic edit predecessor store key'
      ),
      finalTailSha256: matchingString(
        predecessor.finalTailSha256,
        SHA256_PATTERN,
        'semantic edit predecessor tail'
      ),
    })
  }
  if (input.schemaVersion !== 1 || input.unmatchedAuditBegins !== 0)
    throw new Error('semantic edit accepted evidence identity is invalid')
  const serverInstanceId = matchingString(
    input.serverInstanceId,
    OPAQUE_ID_PATTERN,
    'semantic edit server instance ID'
  )
  const invocationPrincipalSha256 = matchingString(
    input.invocationPrincipalSha256,
    SHA256_PATTERN,
    'semantic edit invocation principal'
  )
  const journalRunId = matchingString(
    input.journalRunId,
    OPAQUE_ID_PATTERN,
    'semantic edit journal run ID'
  )
  const journalStoreKey = matchingString(
    input.journalStoreKey,
    /^[a-z0-9][a-z0-9._-]{0,63}$/u,
    'semantic edit journal store key'
  )
  const journalAuditKeyId = matchingString(
    input.journalAuditKeyId,
    /^[A-Za-z0-9_-]{8,128}$/u,
    'semantic edit journal audit key ID'
  )
  const journalRealmSha256 = matchingString(
    input.journalRealmSha256,
    SHA256_PATTERN,
    'semantic edit journal realm'
  )
  const journalProfileSha256 = matchingString(
    input.journalProfileSha256,
    SHA256_PATTERN,
    'semantic edit journal profile'
  )
  const journalBoundaryPolicySha256 = matchingString(
    input.journalBoundaryPolicySha256,
    SHA256_PATTERN,
    'semantic edit journal boundary policy'
  )
  const serverAuditHeadSha256 = matchingString(
    input.serverAuditHeadSha256,
    SHA256_PATTERN,
    'semantic edit server audit head'
  )
  const terminalSha256 = matchingString(
    input.terminalSha256,
    SHA256_PATTERN,
    'semantic edit terminal identity'
  )
  const auditRecordCount = boundedSafeInteger(
    input.auditRecordCount,
    2,
    32_768,
    'semantic edit audit record count'
  )
  const auditRecordBytes = boundedSafeInteger(
    input.auditRecordBytes,
    1,
    512 * 1024 * 1024,
    'semantic edit audit record bytes'
  )
  const resourceUseSha256 = matchingString(
    input.resourceUseSha256,
    SHA256_PATTERN,
    'semantic edit resource-use identity'
  )
  const bootstrapDescriptorSha256 = matchingString(
    input.bootstrapDescriptorSha256,
    SHA256_PATTERN,
    'semantic edit bootstrap descriptor identity'
  )
  const bootstrapDescriptorCanonicalSha256 = matchingString(
    input.bootstrapDescriptorCanonicalSha256,
    SHA256_PATTERN,
    'semantic edit canonical bootstrap descriptor identity'
  )
  const contractRegistrySha256 = matchingString(
    input.contractRegistrySha256,
    SHA256_PATTERN,
    'semantic edit contract registry identity'
  )
  const contractRegistryArtifactSetSha256 = matchingString(
    input.contractRegistryArtifactSetSha256,
    SHA256_PATTERN,
    'semantic edit contract registry artifact-set identity'
  )
  const secretMaterialSha256 = matchingString(
    input.secretMaterialSha256,
    SHA256_PATTERN,
    'semantic edit secret-material identity'
  )
  const predecessorHandoffSha256 =
    input.predecessorHandoffSha256 === null
      ? null
      : matchingString(
          input.predecessorHandoffSha256,
          SHA256_PATTERN,
          'semantic edit predecessor handoff identity'
        )
  const hostManifestSha256 = matchingString(
    input.hostManifestSha256,
    SHA256_PATTERN,
    'semantic edit host manifest identity'
  )
  for (const field of Object.keys(authority) as Array<keyof typeof authority>)
    if (input[field] !== authority[field])
      throw new Error(`semantic edit accepted evidence differs at ${field}`)

  if (
    !Array.isArray(input.semanticEventHeads) ||
    input.semanticEventHeads.length > 128
  )
    throw new Error('semantic event heads exceed their bounded cardinality')
  const semanticEventHeads = input.semanticEventHeads.map((value, index) =>
  {
    const head = record(value, `semantic event head ${index}`)
    exactKeys(
      head,
      ['sessionId', 'eventHeadSha256'],
      `semantic event head ${index}`
    )
    if (
      typeof head.sessionId !== 'string' ||
      !OPAQUE_ID_PATTERN.test(head.sessionId) ||
      typeof head.eventHeadSha256 !== 'string' ||
      !SHA256_PATTERN.test(head.eventHeadSha256)
    )
      throw new Error(`semantic event head ${index} is invalid`)
    return Object.freeze({
      sessionId: head.sessionId,
      eventHeadSha256: head.eventHeadSha256,
    })
  })
  if (
    semanticEventHeads.some(
      (entry, index) =>
        index > 0 &&
        semanticEventHeads[index - 1]!.sessionId.localeCompare(
          entry.sessionId
        ) >= 0
    )
  )
    throw new Error('semantic event heads must be sorted and unique')

  if (!Array.isArray(input.calls) || input.calls.length > 32_768)
    throw new Error('accepted evidence calls exceed their bounded cardinality')
  const rawCalls = input.calls
  const callIds = new Set<string>()
  let previousCallSequence = -1
  const calls: SemanticEditEvidenceCallV1[] = rawCalls.map((value, index) =>
  {
    const call = record(value, `accepted evidence call ${index}`)
    exactKeys(
      call,
      [
        'sequence',
        'boundary',
        'name',
        'callId',
        'requestSha256',
        'outcomeSha256',
        'beginRecordSha256',
        'completeRecordSha256',
        'eventSha256',
      ],
      `accepted evidence call ${index}`
    )
    const boundary =
      call.boundary === 'tool' ||
      call.boundary === 'resource-list' ||
      call.boundary === 'resource-read' ||
      call.boundary === 'protocol'
        ? call.boundary
        : null
    const resourceName =
      boundary === 'resource-list'
        ? 'resources/list'
        : boundary === 'resource-read'
          ? 'resources/read'
          : null
    const protocolNameValid =
      boundary !== 'protocol' ||
      call.name === 'tools/list' ||
      SEMANTIC_EDIT_PROTOCOL_TRACE_KINDS.some(
        (kind) => call.name === `protocol/${kind}`
      )
    if (
      !Number.isSafeInteger(call.sequence) ||
      Number(call.sequence) < 0 ||
      previousCallSequence >= Number(call.sequence) ||
      boundary === null ||
      typeof call.name !== 'string' ||
      (boundary === 'tool' &&
        !(SEMANTIC_EDIT_TOOL_ALLOWLIST as readonly string[]).includes(
          call.name
        )) ||
      (resourceName !== null && call.name !== resourceName) ||
      !protocolNameValid ||
      typeof call.callId !== 'string' ||
      !OPAQUE_ID_PATTERN.test(call.callId) ||
      callIds.has(call.callId) ||
      typeof call.requestSha256 !== 'string' ||
      !SHA256_PATTERN.test(call.requestSha256) ||
      typeof call.outcomeSha256 !== 'string' ||
      !SHA256_PATTERN.test(call.outcomeSha256) ||
      typeof call.beginRecordSha256 !== 'string' ||
      !SHA256_PATTERN.test(call.beginRecordSha256) ||
      typeof call.completeRecordSha256 !== 'string' ||
      !SHA256_PATTERN.test(call.completeRecordSha256) ||
      (call.eventSha256 !== null &&
        (typeof call.eventSha256 !== 'string' ||
          !SHA256_PATTERN.test(call.eventSha256)))
    )
      throw new Error(`accepted evidence call ${index} is invalid`)
    const sequence = Number(call.sequence)
    const name = call.name
    const callId = call.callId
    const requestSha256 = call.requestSha256
    const outcomeSha256 = call.outcomeSha256
    const beginRecordSha256 = call.beginRecordSha256
    const completeRecordSha256 = call.completeRecordSha256
    const eventSha256 = call.eventSha256
    previousCallSequence = sequence
    callIds.add(callId)
    return Object.freeze({
      sequence,
      boundary,
      name,
      callId,
      requestSha256,
      outcomeSha256,
      beginRecordSha256,
      completeRecordSha256,
      eventSha256,
    })
  })
  if (auditRecordCount !== calls.length * 2 + 2)
    throw new Error(
      'accepted evidence call cardinality differs from audit records'
    )
  const resourceCalls = calls.filter(
    (call) =>
      call.boundary === 'resource-list' || call.boundary === 'resource-read'
  )
  if (
    resourceUseSha256 !==
    canonicalSha256({
      schemaVersion: 1,
      kind: 'production-edit-resource-use-v1',
      calls: resourceCalls,
    })
  )
    throw new Error(
      'accepted evidence resource-use hash is not self-consistent'
    )
  const parsed: SemanticEditAcceptedEvidenceV1 = Object.freeze({
    schemaVersion: 1,
    serverInstanceId,
    invocationPrincipalSha256,
    journalRunId,
    journalStoreKey,
    journalAuditKeyId,
    journalRealmSha256,
    journalProfileSha256,
    journalBoundaryPolicySha256,
    journalPredecessor,
    serverAuditHeadSha256,
    terminalSha256,
    auditRecordCount,
    auditRecordBytes,
    semanticEventHeads: Object.freeze(semanticEventHeads),
    unmatchedAuditBegins: 0,
    calls: Object.freeze(calls),
    revisionSha256s: sortedUniqueSha256s(
      input.revisionSha256s,
      'revision identities'
    ),
    parentDeltaSha256s: sortedUniqueSha256s(
      input.parentDeltaSha256s,
      'parent delta identities'
    ),
    cumulativeDeltaSha256s: sortedUniqueSha256s(
      input.cumulativeDeltaSha256s,
      'cumulative delta identities'
    ),
    preservationSha256s: sortedUniqueSha256s(
      input.preservationSha256s,
      'preservation identities'
    ),
    lineageSha256s: sortedUniqueSha256s(
      input.lineageSha256s,
      'lineage identities'
    ),
    certificateSha256s: sortedUniqueSha256s(
      input.certificateSha256s,
      'certificate identities'
    ),
    reportProjectionSha256s: sortedUniqueSha256s(
      input.reportProjectionSha256s,
      'report projection identities'
    ),
    exportReceiptSha256s: sortedUniqueSha256s(
      input.exportReceiptSha256s,
      'export receipt identities'
    ),
    resourceUseSha256,
    bootstrapDescriptorSha256,
    bootstrapDescriptorCanonicalSha256,
    contractRegistrySha256,
    contractRegistryArtifactSetSha256,
    secretMaterialSha256,
    predecessorHandoffSha256,
    hostManifestSha256,
  })
  return parsed
}

export function reconcileSemanticEditTraceV1(
  trace: readonly SemanticEditTraceRecordV1[],
  evidence: SemanticEditAcceptedEvidenceV1
): SemanticEditTraceReconciliationV1
{
  const failures: string[] = []
  if (evidence.unmatchedAuditBegins !== 0)
    failures.push('server audit retains unmatched begin records')
  const auditableTrace = trace
  for (let index = 0; index < auditableTrace.length; index++)
  {
    const current = auditableTrace[index]!
    const previous = auditableTrace[index - 1]
    if (previous && current.sequence <= previous.sequence)
      failures.push(
        `trace position ${index} is not in strictly increasing sequence order`
      )
  }
  for (let index = 0; index < evidence.calls.length; index++)
  {
    const current = evidence.calls[index]!
    const previous = evidence.calls[index - 1]
    if (previous && current.sequence <= previous.sequence)
      failures.push(
        `audit call position ${index} is not in strictly increasing sequence order`
      )
  }
  const projectedTrace = auditableTrace.map((record) =>
  {
    let requestSha256: string
    let outcomeSha256: string
    if ((EDIT_TOOL_NAMES as readonly string[]).includes(record.name))
    {
      const outcome = record.rawOutcome as Record<string, unknown>
      const { audit: _audit, ...receiptFree } = outcome
      requestSha256 = editTransportRequestSha256V1({
        principalSha256: evidence.invocationPrincipalSha256,
        realmSha256: evidence.journalRealmSha256,
        tool: record.name as EditToolName,
        request: record.rawRequest as never,
      })
      outcomeSha256 = editReceiptFreeOutcomeSha256V1(
        receiptFree as EditToolReceiptFreeResultV1
      )
    }
    else if (
      (PROJECT_TOOL_NAMES as readonly string[]).includes(record.name)
    )
    {
      const outputBytes = canonicalJsonBytesV1(record.rawOutcome)
      requestSha256 = canonicalSha256(record.rawRequest)
      outcomeSha256 = projectReceiptFreeOutcomeSha256V1({
        outcomeKind: 'projectTool',
        tool: record.name as ProjectToolReceiptFreeOutcomeHashProjectionV1['tool'],
        outputSchemaSha256: canonicalSha256(
          projectOutputSchema(
            record.name as Parameters<typeof projectOutputSchema>[0]
          )
        ),
        canonicalOutputSha256: sha256(outputBytes),
        outputByteLength: outputBytes.byteLength,
        isError: record.outcomeIsError,
      })
    }
    else
    {
      const outputBytes = canonicalJsonBytesV1(record.rawOutcome)
      requestSha256 = canonicalSha256(record.rawRequest)
      let boundary: NonToolReceiptFreeOutcomeHashProjectionV1['boundary'] | null
      let disposition: NonToolReceiptFreeOutcomeHashProjectionV1['disposition']
      let outcomeCode: string
      if (record.boundary === 'resource-list')
      {
        boundary = { boundaryKind: 'resource-list' }
        disposition = 'completed'
        outcomeCode = 'resource.list.completed'
      }
      else if (
        record.boundary === 'resource-read' &&
        record.rawRequest !== null &&
        typeof record.rawRequest === 'object' &&
        typeof (record.rawRequest as Record<string, unknown>)['uri'] ===
          'string'
      )
      {
        boundary = {
          boundaryKind: 'resource-read',
          requestedUriSha256: sha256(
            (record.rawRequest as Record<string, string>)['uri']!
          ),
        }
        disposition = 'completed'
        outcomeCode = 'resource.read.completed'
      }
      else if (
        record.boundary === 'protocol' &&
        record.name === 'tools/list'
      )
      {
        boundary = { boundaryKind: 'protocol', protocolKind: 'tools-list' }
        disposition = 'completed'
        outcomeCode = 'tools.list.completed'
      }
      else if (record.boundary === 'protocol')
      {
        const outcome = record.rawOutcome as Record<string, unknown>
        const protocolKind = SEMANTIC_EDIT_PROTOCOL_TRACE_KINDS.find(
          (kind) => record.name === `protocol/${kind}`
        )
        if (protocolKind)
        {
          boundary = { boundaryKind: 'protocol', protocolKind }
          disposition = [
            'raw-frame-rejected',
            'invalid-utf8',
            'invalid-json',
            'invalid-json-rpc',
          ].includes(protocolKind)
            ? 'malformed'
            : 'refused'
          outcomeCode =
            typeof outcome.code === 'string'
              ? outcome.code
              : typeof outcome.outcomeCode === 'string'
                ? outcome.outcomeCode
                : 'mcp.internal'
        }
        else
        {
          boundary = null
          disposition = 'refused'
          outcomeCode = 'mcp.internal'
        }
      }
      else
      {
        boundary = null
        disposition = 'refused'
        outcomeCode = 'mcp.internal'
      }
      if (!boundary)
        throw new Error(
          `trace record ${record.sequence} has no frozen audit boundary`
        )
      const outcome: NonToolReceiptFreeOutcomeHashProjectionV1 = {
        outcomeKind: 'nonToolBoundary',
        boundary,
        disposition,
        outcomeCode,
        canonicalOutcomeSha256: sha256(outputBytes),
        outcomeByteLength: outputBytes.byteLength,
        evidenceIds: [],
      }
      outcomeSha256 = boundaryReceiptFreeOutcomeSha256V1(outcome)
    }
    return Object.freeze({ record, requestSha256, outcomeSha256 })
  })
  if (projectedTrace.length !== evidence.calls.length)
    failures.push('benchmark trace and server audit call counts differ')
  let matchedCalls = 0
  for (const [index, projected] of projectedTrace.entries())
  {
    const { record } = projected
    const call = evidence.calls[index]
    if (!call)
    {
      failures.push(`trace record ${record.sequence} has no audit position`)
      continue
    }
    const exactPositionMatch =
      record.boundary === call.boundary &&
      record.name === call.name &&
      projected.requestSha256 === call.requestSha256 &&
      projected.outcomeSha256 === call.outcomeSha256
    if (exactPositionMatch) matchedCalls++
    else
      failures.push(
        `trace record ${record.sequence} does not match audit sequence ${call.sequence} at position ${index}`
      )
    if (
      (record.callId !== null && record.callId !== call.callId) ||
      (record.beginRecordSha256 !== null &&
        record.beginRecordSha256 !== call.beginRecordSha256) ||
      (record.completeRecordSha256 !== null &&
        record.completeRecordSha256 !== call.completeRecordSha256) ||
      record.eventSha256 !== call.eventSha256
    )
      failures.push(`trace record ${record.sequence} identity disagrees`)
    if (
      SEMANTIC_EDIT_STATEFUL_TOOLS.includes(record.name as never) &&
      record.ok &&
      call.eventSha256 === null
    )
      failures.push(
        `successful stateful trace record ${record.sequence} has no event`
      )
  }
  return Object.freeze({
    ok: failures.length === 0,
    traceRecords: auditableTrace.length,
    evidenceCalls: evidence.calls.length,
    matchedCalls,
    failures: Object.freeze(failures),
    serverAuditHeadSha256: evidence.serverAuditHeadSha256,
    semanticEventHeads: Object.freeze(
      evidence.semanticEventHeads.map((entry) => entry.eventHeadSha256)
    ),
  })
}

export function assertAuthoritativeNpmLifecycleV1(name: string): void
{
  if (process.env.npm_lifecycle_event !== name)
    throw new Error(`run this workflow through npm run ${name}`)
}
