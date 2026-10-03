// packages/edit/src/authoring/workspace-service.ts
// retain immutable whole-project plans, candidates, evaluation & accepted exports

import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdtemp, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import {
  authoringRuntimeIdentitiesV3,
  authoringCandidateEvaluationEvidenceSha256V3,
  authoringEvaluationPolicySha256V3,
  evaluateAuthoringCandidateV3,
  executionArtifactSnapshotIsAuthoritative,
  multimodalExecutionArtifactSnapshot,
  isPathWithinRootV1,
  validateAuthoringCandidateEvaluationV3,
  validateRecordedAuthoringCandidateEvaluationV3,
  verifyLegacyPublishedAuthoringCandidateEvaluationV2,
  assertNativeArtifactLockCapabilityV1,
  assertPublicationDirectoryIdentityV1,
  preparePublicationFileV1,
  commitPreparedPublicationV1,
  verifyCommittedPublicationV1,
  inspectPreparedPublicationV1,
  releasePreparedPublicationV1,
  syncPublicationDirectoryV1,
  type AuthoringCandidateEvaluationRequestV3,
  type AuthoringCandidateEvaluationV3,
  type AuthoringCandidateEvaluation,
  type AuthoringCandidateEvaluationRequestV2,
  type AuthoringRuntimeIdentityV3,
} from '@scratch-agent/eval'
import { blankProject } from '@scratch-agent/ir'
import {
  expandScratchWorkspaceManifestV2,
  parseScratchWorkspaceManifestV2,
  type ScratchWorkspaceManifestV2,
  type WorkspaceBuildLimitsV2,
  type WorkspaceBuildPlanV2,
  type WorkspacePreparedAssetV2,
  type WorkspaceRuntimeTargetV2,
  type WorkspaceSourceFileV2,
  type WorkspaceCompilationInputV2,
} from '@scratch-agent/ir/authoring'
import { getStandardAuthoritySha256V2 } from '@scratch-agent/ir/edit'
import {
  ASSET_PIPELINE_LIMITS_V2,
  AUDIO_PIPELINE_DEFAULT_LIMITS_V1,
  DEFAULT_EDIT_ADMISSION_LIMITS,
  DEFAULT_SB3_LIMITS,
  normalizeAudioV1,
  type AssetPipelineLimitsV2,
  type AudioPipelineLimitsV1,
  type EditAdmissionLimits,
  type Sb3Limits,
} from '@scratch-agent/sb3'

import { resolveEditSemanticAuthorityV1 } from '../authority/semantic-authority.js'
import { editCanonicalSha256V1 } from '../support/canonical.js'
import {
  authoringBytesSha256V1,
  authoringDirectoryV1,
  authoringParseJsonV1,
  authoringPrivateParentV1,
  authoringPotentialDirectoryV2,
  authoringExistingParentV2,
  authoringResolvePublicationV2,
  authoringRecoverPreparationV2,
  authoringReadEvidenceV1,
  authoringReadSourceV1,
} from './workspace-files.js'
import { AuthoringRetentionV1 } from './workspace-retention.js'
import {
  AUTHORING_PUBLICATION_POLICY_V2,
  AUTHORING_PUBLICATION_POLICY_SHA256_V2,
  AUTHORING_PUBLICATION_POLICY_V3,
  AUTHORING_PUBLICATION_POLICY_SHA256_V3,
  authoringPublicationEvidenceBytesV2,
  authoringPublicationIssueV2,
  type AuthoringPublicationIntent,
  type AuthoringPublicationPreparationV2,
} from './workspace-publication.js'
import {
  AUTHORING_WORKSPACE_LIMITS_V1,
  AuthoringWorkspaceErrorV1,
  type AuthoringArtifactRefV1,
  type AuthoringOperatorPermissionsV1,
  type AuthoringSourceSnapshotV1,
  type AuthoringToolIdentityV1,
  type AuthoringWholeBuildContractV2,
  type AuthoringWorkspaceCollectionV1,
  type AuthoringWorkspaceLimitsV1,
  type AuthoringPublicationFaultPointV1,
  type AuthoringPublicationOutcomeV1,
  type AuthoringPublicationSummaryV1,
} from './workspace-types.js'
import {
  assertAuthoringActiveV1,
  WorkspaceWorkerOwnerV1,
} from './workspace-worker-owner.js'
import { workspaceWorkerBytesV1 } from './workspace-worker-types.js'

export * from './workspace-types.js'
export {
  AUTHORING_PUBLICATION_POLICY_V2,
  AUTHORING_PUBLICATION_POLICY_SHA256_V2,
  AUTHORING_PUBLICATION_POLICY_V3,
  AUTHORING_PUBLICATION_POLICY_SHA256_V3,
} from './workspace-publication.js'

export interface AuthoringWorkspaceServiceOptionsV1
{
  readonly permissions: AuthoringOperatorPermissionsV1
  readonly evaluate?: (
    request: AuthoringCandidateEvaluationRequestV3
  ) => Promise<AuthoringCandidateEvaluationV3>
  readonly publicationFaultHook?: (
    point: AuthoringPublicationFaultPointV1
  ) => void | Promise<void>
}

interface Permissions
{
  sourceRoots: readonly string[]
  evidenceRoot: string
  outputRoots: readonly string[]
  limits: AuthoringWorkspaceLimitsV1
  archiveLimits: Sb3Limits
  editLimits: EditAdmissionLimits
  preprocessingLimits: AssetPipelineLimitsV2
  audioLimits: AudioPipelineLimitsV1
  ffmpeg: AuthoringOperatorPermissionsV1['ffmpeg'] | null
}

type PreparedAssetEvidence = WorkspacePreparedAssetV2 extends infer Asset
  ? Asset extends WorkspacePreparedAssetV2
    ? Omit<Asset, 'bytes'>
    : never
  : never

interface PreparedAssetRecord
{
  asset: PreparedAssetEvidence
  artifact: AuthoringArtifactRefV1
}

interface PlanRecord
{
  schemaVersion: 1
  workspaceId: string
  planId: string
  manifest: ScratchWorkspaceManifestV2
  sources: readonly AuthoringSourceSnapshotV1[]
  sourceClosureSha256: string
  baseline: AuthoringArtifactRefV1
  preparedAssets: readonly PreparedAssetRecord[]
  preprocessingCosts: { pixelVisits: number; peakDecodedBytes: number }
  tools: AuthoringToolIdentityV1
  plan: WorkspaceBuildPlanV2
  contract: AuthoringWholeBuildContractV2
  diff: AuthoringArtifactRefV1
}

interface BuildRecord
{
  schemaVersion: 1
  workspaceId: string
  planId: string
  buildId: string
  planRecord: AuthoringArtifactRefV1
  candidate: AuthoringArtifactRefV1
  contractSha256: string
  diff: AuthoringArtifactRefV1
  bootstrap: AuthoringArtifactRefV1
  developmentClips?: AuthoringArtifactRefV1
}

interface EvaluationRecord
{
  schemaVersion: 1
  workspaceId: string
  buildId: string
  evaluationId: string
  disposition: 'accepted' | 'refused'
  candidateSha256: string
  result: AuthoringArtifactRefV1
  mediaArtifacts: readonly {
    sourcePath: string
    artifact: AuthoringArtifactRefV1
  }[]
}

interface StateBase
{
  workspaceId: string
  manifestPath: string
  permissionsSha256: string
  closed: boolean
  plans: readonly { planId: string; artifact: AuthoringArtifactRefV1 }[]
  builds: readonly { buildId: string; artifact: AuthoringArtifactRefV1 }[]
  evaluations: readonly {
    evaluationId: string
    artifact: AuthoringArtifactRefV1
  }[]
  exports: readonly AuthoringArtifactRefV1[]
  artifacts: readonly AuthoringArtifactRefV1[]
}

interface LegacyState extends StateBase
{
  schemaVersion: 1
}

interface CurrentState extends StateBase
{
  schemaVersion: 2
  publicationPolicySha256: string
  publications: readonly AuthoringPublicationSummaryV1[]
  pendingPublication: string | null
}

type State = LegacyState | CurrentState

interface Workspace
{
  retention: AuthoringRetentionV1
  state: State
  stateSha256: string
  busy: boolean
  writable: boolean
}

interface WritableWorkspace extends Workspace
{
  state: CurrentState
}

interface DiscoveredPublications
{
  readonly publications: readonly AuthoringPublicationSummaryV1[]
  readonly artifacts: readonly AuthoringArtifactRefV1[]
  readonly unclaimedReservations: readonly string[]
  readonly identitySha256: string
}

function fail(code: string, message: string): never
{
  throw new AuthoringWorkspaceErrorV1(code, message)
}

function lowered<T extends object>(defaults: T, options: Partial<T> = {}): T
{
  const result = { ...defaults }
  for (const key of Object.keys(options))
  {
    if (!Object.hasOwn(defaults, key))
      return fail('authoring.invalid_permissions', `unknown host limit ${key}`)
    const name = key as keyof T
    const value = options[name]
    const maximum = defaults[name]
    if (
      typeof value !== 'number' ||
      typeof maximum !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > maximum
    )
      return fail(
        'authoring.invalid_permissions',
        `${key} can only lower its finite default`
      )
    result[name] = value as T[keyof T]
  }
  return result
}

function identity(prefix: string, content: unknown): string
{
  return `${prefix}-${editCanonicalSha256V1(content).slice(0, 32)}`
}

function compilationLimits(permissions: Permissions): WorkspaceBuildLimitsV2
{
  return {
    maximumTargets: permissions.editLimits.maxTargets,
    maximumBlocks: permissions.editLimits.maxBlockRecords,
    maximumScripts: permissions.editLimits.maxScriptRoots,
    maximumDeclarations: permissions.editLimits.maxDeclarationRecords,
    maximumCostumes: permissions.editLimits.maxCostumeRecords,
    maximumCostumesPerTarget: permissions.editLimits.maxCostumesPerTarget,
    maximumAssetBytes: permissions.archiveLimits.maxTotalAssetBytes,
    maximumSb3Bytes: permissions.archiveLimits.maxCompressedBytes,
    maximumProjectJsonBytes: permissions.archiveLimits.maxProjectJsonBytes,
    maximumDecodedCostumeBytes: permissions.editLimits.maxPngDecodedRgbaBytes,
    maximumSourceBytes: permissions.limits.maxTotalSourceBytes,
  }
}

function checkId(id: string, prefix: string): void
{
  if (!new RegExp(`^${prefix}-[a-f0-9]{32}$`, 'u').test(id))
    fail('authoring.invalid_identity', `invalid ${prefix} identity`)
}

export async function createAuthoringWorkspaceServiceV1(
  options: AuthoringWorkspaceServiceOptionsV1
): Promise<AuthoringWorkspaceServiceV1>
{
  const input = options.permissions
  if (
    !input ||
    !Array.isArray(input.sourceRoots) ||
    !Array.isArray(input.outputRoots) ||
    input.sourceRoots.length < 1 ||
    input.sourceRoots.length > 32 ||
    input.outputRoots.length < 1 ||
    input.outputRoots.length > 32
  )
    return fail(
      'authoring.invalid_permissions',
      'operator must select bounded source & output roots'
    )
  const sourceRoots = [
    ...new Set(await Promise.all(input.sourceRoots.map(authoringDirectoryV1))),
  ].sort()
  const outputRoots = [
    ...new Set(await Promise.all(input.outputRoots.map(authoringDirectoryV1))),
  ].sort()
  if (!isAbsolute(input.evidenceRoot))
    return fail(
      'authoring.invalid_permissions',
      'evidence root must be an absolute operator path'
    )
  const evidenceRoot = await authoringPotentialDirectoryV2(input.evidenceRoot)
  const permissions: Permissions = {
    sourceRoots,
    evidenceRoot,
    outputRoots,
    limits: lowered(AUTHORING_WORKSPACE_LIMITS_V1, input.limits),
    archiveLimits: lowered(DEFAULT_SB3_LIMITS, input.archiveLimits),
    editLimits: lowered(DEFAULT_EDIT_ADMISSION_LIMITS, input.editLimits),
    preprocessingLimits: lowered(
      ASSET_PIPELINE_LIMITS_V2,
      input.preprocessingLimits
    ),
    audioLimits: lowered(AUDIO_PIPELINE_DEFAULT_LIMITS_V1, input.audioLimits),
    ffmpeg: input.ffmpeg === undefined ? null : structuredClone(input.ffmpeg),
  }
  return new AuthoringWorkspaceServiceV1(
    permissions,
    options.evaluate ?? evaluateAuthoringCandidateV3,
    options.publicationFaultHook
  )
}

export class AuthoringWorkspaceServiceV1
{
  #workspaces = new Map<string, Workspace>()
  #permissionsSha256: string
  #worker = new WorkspaceWorkerOwnerV1()
  #operationBusy = false

  constructor(
    private readonly permissions: Permissions,
    private readonly evaluator: NonNullable<
      AuthoringWorkspaceServiceOptionsV1['evaluate']
    >,
    private readonly publicationFaultHook?: AuthoringWorkspaceServiceOptionsV1['publicationFaultHook']
  )
  {
    this.#permissionsSha256 = editCanonicalSha256V1(permissions)
  }

  async open(input: { manifestPath: string; signal?: AbortSignal }): Promise<{
    workspaceId: string
    manifestPath: string
    manifestSha256: string
    evidenceRoot: string
  }>
  {
    return this.#withOperationLease(input.signal, async () =>
    {
      assertAuthoringActiveV1(input.signal)
      await assertNativeArtifactLockCapabilityV1(
        await authoringExistingParentV2(this.permissions.evidenceRoot)
      )
      assertAuthoringActiveV1(input.signal)
      if (!isAbsolute(input.manifestPath))
        return fail(
          'authoring.invalid_source',
          'open requires an absolute workspace manifest path'
        )
      const source = await authoringReadSourceV1(
        input.manifestPath,
        this.permissions.sourceRoots,
        this.permissions.evidenceRoot,
        Math.min(
          this.permissions.limits.maxSourceJsonBytes,
          this.permissions.limits.maxSourceFileBytes
        )
      )
      assertAuthoringActiveV1(input.signal)
      parseScratchWorkspaceManifestV2(authoringParseJsonV1(source.bytes))
      assertAuthoringActiveV1(input.signal)
      await authoringPrivateParentV1(this.permissions.evidenceRoot)
      assertAuthoringActiveV1(input.signal)
      const workspaceId = `authoring-${randomBytes(16).toString('hex')}`
      const retention = await AuthoringRetentionV1.create(
        workspaceId,
        join(this.permissions.evidenceRoot, workspaceId),
        this.permissions.limits
      )
      const state: CurrentState = {
        schemaVersion: 2,
        workspaceId,
        manifestPath: input.manifestPath,
        permissionsSha256: this.#permissionsSha256,
        closed: false,
        plans: [],
        builds: [],
        evaluations: [],
        exports: [],
        artifacts: [],
        publicationPolicySha256: AUTHORING_PUBLICATION_POLICY_SHA256_V3,
        publications: [],
        pendingPublication: null,
      }
      await retention.withRootLease(async () =>
      {
        const pointer = await this.#commitState(
          retention,
          null,
          state,
          input.signal
        )
        this.#workspaces.set(workspaceId, {
          retention,
          state,
          stateSha256: pointer.sha256,
          busy: false,
          writable: true,
        })
      })
      return {
        workspaceId,
        manifestPath: source.canonicalPath,
        manifestSha256: source.sha256,
        evidenceRoot: retention.root,
      }
    })
  }

  async plan(input: { workspaceId: string; signal?: AbortSignal })
  {
    return this.#mutate(input.workspaceId, input.signal, async (workspace) =>
    {
      if (workspace.state.plans.length >= this.permissions.limits.maxPlans)
        return fail(
          'authoring.retention_budget_exceeded',
          'workspace plan count is exhausted'
        )
      const closure = await this.#closure(workspace, input.signal)
      assertAuthoringActiveV1(input.signal)
      const tools = this.#tools(closure.expanded.runtimeTargets ?? [])
      const prepared = await this.#prepareAssets(
        workspace,
        closure.expanded,
        closure.files,
        input.signal
      )
      await this.#checkAudioDecoders(prepared.assets, input.signal)
      assertAuthoringActiveV1(input.signal)
      const baselineSource = closure.manifest.baseline
      const baselineBytes =
        baselineSource.kind === 'greenfield'
          ? await blankProject().toSb3()
          : closure.files.find((file) => file.path === baselineSource.path)!
              .bytes
      const compilation = await this.#compile(
        {
          manifest: closure.manifest,
          files: closure.files,
          baselineBytes,
          preparedAssets: prepared.assets,
          compilerIdentitySha256: tools.compilerIdentitySha256,
          preprocessingCosts: prepared.costs,
          limits: compilationLimits(this.permissions),
        },
        input.signal
      )
      await this.#checkSources(closure.sources, input.signal)
      this.#checkTools(tools, compilation.plan.runtimeTargets)
      assertAuthoringActiveV1(input.signal)
      const sourceClosureSha256 = editCanonicalSha256V1({
        sources: closure.sources,
        baselineArtifactSha256: authoringBytesSha256V1(baselineBytes),
      })
      const contractContent = {
        schemaVersion: 2 as const,
        kind: 'whole-project-authoring-v2' as const,
        sourceClosureSha256,
        preparedAssetsSha256: editCanonicalSha256V1(
          compilation.plan.preparedAssets
        ),
        operationOrderSha256: editCanonicalSha256V1(
          compilation.plan.operationOrder
        ),
        costsSha256: editCanonicalSha256V1(compilation.plan.costs),
        permissionsSha256: this.#permissionsSha256,
        tools,
        expectedCandidateSha256: compilation.plan.candidateSha256,
      }
      const contract: AuthoringWholeBuildContractV2 = {
        ...contractContent,
        contractSha256: editCanonicalSha256V1(contractContent),
      }
      const planId = identity('plan', contract)
      const baseline = await workspace.retention.retain(
        `plans/${planId}/baseline.sb3`,
        baselineBytes,
        'application/x.scratch.sb3'
      )
      assertAuthoringActiveV1(input.signal)
      const diff = await workspace.retention.retainJson(
        `plans/${planId}/diff.json`,
        compilation.diff
      )
      const preparedAssets = await this.#retainPreparedAssets(
        workspace,
        prepared.assets,
        input.signal
      )
      const record: PlanRecord = {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        planId,
        manifest: closure.manifest,
        sources: closure.sources,
        sourceClosureSha256,
        baseline,
        preparedAssets,
        preprocessingCosts: prepared.costs,
        tools,
        plan: compilation.plan,
        contract,
        diff,
      }
      assertAuthoringActiveV1(input.signal)
      const artifact = await workspace.retention.retainJson(
        `plans/${planId}/plan.json`,
        record
      )
      assertAuthoringActiveV1(input.signal)
      await this.#save(
        workspace,
        {
          ...workspace.state,
          plans: [...workspace.state.plans, { planId, artifact }],
          artifacts: this.#catalog(workspace.state.artifacts, [
            artifact,
            baseline,
            diff,
            ...closure.sources.map((source) => source.artifact),
            ...preparedAssets.map((asset) => asset.artifact),
          ]),
        },
        input.signal
      )
      return {
        workspaceId: input.workspaceId,
        planId,
        candidateSha256: compilation.plan.candidateSha256,
        sourceClosureSha256,
        contractSha256: contract.contractSha256,
        preparedAssetCount: preparedAssets.length,
        plan: compilation.plan,
        artifact,
        diff,
        contract,
      }
    })
  }

  async build(input: {
    workspaceId: string
    planId: string
    signal?: AbortSignal
  })
  {
    return this.#mutate(input.workspaceId, input.signal, async (workspace) =>
    {
      if (workspace.state.builds.length >= this.permissions.limits.maxBuilds)
        return fail(
          'authoring.retention_budget_exceeded',
          'workspace build count is exhausted'
        )
      const planRef = this.#planRef(workspace, input.planId)
      const record = await workspace.retention.readJson<PlanRecord>(planRef)
      await this.#guardPlan(record, true, input.signal)
      const compilation = await this.#compileRetainedPlan(
        workspace,
        record,
        input.signal
      )
      if (
        compilation.plan.candidateSha256 !==
          record.contract.expectedCandidateSha256 ||
        compilation.plan.planSha256 !== record.plan.planSha256 ||
        editCanonicalSha256V1(compilation.diff) !== record.plan.diffSha256
      )
        return fail(
          'authoring.nonrepeatable_build',
          'recompiled candidate, plan or complete diff differs from its immutable plan'
        )
      await this.#guardPlan(record, true, input.signal)
      const buildId = identity('build', {
        planId: record.planId,
        candidateSha256: compilation.plan.candidateSha256,
      })
      assertAuthoringActiveV1(input.signal)
      const candidate = await workspace.retention.retain(
        `builds/${buildId}/candidate.sb3`,
        compilation.candidateBytes,
        'application/x.scratch.sb3'
      )
      const editAuthority = resolveEditSemanticAuthorityV1('standard-v2')
      assertAuthoringActiveV1(input.signal)
      const developmentClips = await workspace.retention.retainJson(
        `builds/${buildId}/development-clips.json`,
        {
          schemaVersion: 1,
          kind: 'development-clips-v1',
          sourceSha256: candidate.sha256,
          clips: record.plan.clips.map((clip) => ({
            id: clip.id,
            name: clip.name,
            targetIndex: clip.targetIndex,
            loop: clip.loop,
            frames: clip.frames.map((frame) => ({
              costumeIndexOneBased: frame.costumeIndexOneBased,
              durationMs: frame.durationMs,
            })),
          })),
        }
      )
      assertAuthoringActiveV1(input.signal)
      const bootstrap = await workspace.retention.retainJson(
        `builds/${buildId}/edit-bootstrap.json`,
        {
          schemaVersion: 2,
          kind: 'standard-authoring-edit-bootstrap',
          source: candidate,
          sourceArtifactSha256: candidate.sha256,
          semanticAuthorityId: 'standard-v2',
          semanticAuthoritySha256: editAuthority.semanticAuthoritySha256,
          wholeBuildContract: record.contract,
          operatorPermissions: this.permissions,
          permissionsSha256: this.#permissionsSha256,
        }
      )
      const build: BuildRecord = {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        planId: record.planId,
        buildId,
        planRecord: planRef,
        candidate,
        contractSha256: record.contract.contractSha256,
        diff: record.diff,
        bootstrap,
        developmentClips,
      }
      assertAuthoringActiveV1(input.signal)
      const artifact = await workspace.retention.retainJson(
        `builds/${buildId}/build.json`,
        build
      )
      assertAuthoringActiveV1(input.signal)
      await this.#save(
        workspace,
        {
          ...workspace.state,
          builds: [...workspace.state.builds, { buildId, artifact }],
          artifacts: this.#catalog(workspace.state.artifacts, [
            artifact,
            candidate,
            bootstrap,
            developmentClips,
          ]),
        },
        input.signal
      )
      return {
        workspaceId: input.workspaceId,
        buildId,
        planId: record.planId,
        candidateSha256: candidate.sha256,
        candidate,
        diff: record.diff,
        bootstrap,
        developmentClips,
        artifact,
      }
    })
  }

  async evaluate(input: {
    workspaceId: string
    buildId: string
    signal?: AbortSignal
  })
  {
    const assertActive = () => assertAuthoringActiveV1(input.signal)
    assertActive()
    return this.#mutate(input.workspaceId, input.signal, async (workspace) =>
    {
      assertActive()
      if (
        workspace.state.evaluations.length >=
        this.permissions.limits.maxEvaluations
      )
        return fail(
          'authoring.retention_budget_exceeded',
          'workspace evaluation count is exhausted'
        )
      const { build, plan } = await this.#buildAndPlan(
        workspace,
        input.buildId,
        input.signal
      )
      assertActive()
      await this.#guardPlan(plan, true, input.signal)
      assertActive()
      const request = this.#evaluationRequest(
        plan,
        await workspace.retention.read(build.candidate)
      )
      assertActive()
      request.signal = input.signal
      const stage = await mkdtemp(
        join(this.permissions.evidenceRoot, '.authoring-evaluation-')
      )
      request.evidenceRoot = stage
      let result: AuthoringCandidateEvaluationV3
      const mediaArtifacts: {
        sourcePath: string
        artifact: AuthoringArtifactRefV1
      }[] = []
      try
      {
        assertActive()
        result = await this.evaluator(request)
        const { evidenceSha256, ...content } = result
        if (
          result.kind !== 'authoring-candidate-evaluation-v3' ||
          result.schemaVersion !== 3 ||
          result.candidateSha256 !== request.candidateSha256 ||
          result.compilerIdentitySha256 !== request.compilerIdentitySha256 ||
          result.standardAuthoritySha256 !== request.standardAuthoritySha256 ||
          editCanonicalSha256V1(result.runtimeTargets) !==
            editCanonicalSha256V1(request.runtimeTargets) ||
          result.evaluationPolicySha256 !==
            authoringEvaluationPolicySha256V3(request) ||
          evidenceSha256 !==
            authoringCandidateEvaluationEvidenceSha256V3(content) ||
          !['accepted', 'refused'].includes(result.disposition) ||
          !result.evidenceRoot ||
          !isPathWithinRootV1(stage, result.evidenceRoot)
        )
          return fail(
            'authoring.invalid_evaluation_evidence',
            'evaluation does not match its exact request & owned evidence stage'
          )
        if (result.disposition === 'accepted')
        {
          assertActive()
          const issues = validateAuthoringCandidateEvaluationV3(result, request)
          if (issues.length > 0)
            return fail(
              'authoring.invalid_evaluation_evidence',
              issues.join('; ')
            )
        }
        await this.#guardPlan(plan, true, input.signal)
        let mediaBytes = 0
        for (const media of result.mediaArtifacts)
        {
          assertActive()
          const snapshot = await authoringReadEvidenceV1(
            media.path,
            stage,
            this.permissions.archiveLimits.maxAssetBytes
          )
          if (
            snapshot.sha256 !== media.sha256 ||
            snapshot.bytes.byteLength !== media.byteLength
          )
            return fail(
              'authoring.evaluation_media_changed',
              'rendered media differs from its exact evaluation identity'
            )
          mediaBytes += snapshot.bytes.byteLength
          if (mediaBytes > 32 * 1024 * 1024)
            return fail(
              'authoring.evaluation_budget_exceeded',
              'rendered evidence exceeds its aggregate byte ceiling'
            )
          assertActive()
          const artifact = await workspace.retention.retain(
            `evaluation-media/${media.sha256}.png`,
            snapshot.bytes,
            media.mimeType
          )
          mediaArtifacts.push({ sourcePath: media.path, artifact })
        }
      }
      finally
      {
        await rm(stage, { recursive: true, force: true })
      }
      await this.#guardPlan(plan, true, input.signal)
      assertActive()
      const evaluationId = identity('evaluation', {
        buildId: build.buildId,
        evidenceSha256: result.evidenceSha256,
      })
      const resultRef = await workspace.retention.retainJson(
        `evaluations/${evaluationId}/result.json`,
        result
      )
      const evaluation: EvaluationRecord = {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        buildId: build.buildId,
        evaluationId,
        disposition: result.disposition,
        candidateSha256: result.candidateSha256,
        result: resultRef,
        mediaArtifacts,
      }
      assertActive()
      const artifact = await workspace.retention.retainJson(
        `evaluations/${evaluationId}/evaluation.json`,
        evaluation
      )
      assertActive()
      await this.#save(
        workspace,
        {
          ...workspace.state,
          evaluations: [
            ...workspace.state.evaluations,
            { evaluationId, artifact },
          ],
          artifacts: this.#catalog(workspace.state.artifacts, [
            artifact,
            resultRef,
            ...mediaArtifacts.map((media) => media.artifact),
          ]),
        },
        input.signal
      )
      const cleanupIssue = result.issues.find((issue) =>
        issue.startsWith('runner.cleanup.incomplete: ')
      )
      if (cleanupIssue)
        return fail('authoring.cleanup_incomplete', cleanupIssue)
      return {
        workspaceId: input.workspaceId,
        buildId: build.buildId,
        evaluationId,
        disposition: result.disposition,
        candidateSha256: result.candidateSha256,
        evidenceSha256: result.evidenceSha256,
        issues: result.issues,
        artifact,
        result: resultRef,
      }
    })
  }

  async export(input: {
    workspaceId: string
    buildId: string
    destinationPath: string
    signal?: AbortSignal
  }): Promise<AuthoringPublicationOutcomeV1>
  {
    return this.#mutate(
      input.workspaceId,
      input.signal,
      async (workspace) =>
      {
        const retryDestination = await authoringResolvePublicationV2(
          input.destinationPath,
          this.permissions.outputRoots,
          this.permissions.evidenceRoot,
          true
        )
        const retry = [...workspace.state.publications]
          .reverse()
          .find(
            (entry) =>
              entry.buildId === input.buildId &&
              entry.path === retryDestination.path &&
              entry.status !== 'aborted'
          )
        if (retry)
          return this.#recoverPublication(
            workspace,
            retry.exportId,
            input.signal
          )
        if (workspace.state.pendingPublication !== null)
          return fail(
            'authoring.publication_recovery_required',
            'workspace has a pending publication; reconcile it before another export'
          )
        if (workspace.state.closed)
          return fail('authoring.workspace_closed', 'workspace is closed')
        if (
          workspace.state.publications.length >=
          this.permissions.limits.maxBuilds
        )
          return fail(
            'authoring.retention_budget_exceeded',
            'workspace publication count is exhausted'
          )
        const { build, plan, accepted, evaluation, bytes } =
          await this.#publicationInputs(
            workspace,
            input.buildId,
            undefined,
            input.signal
          )
        await this.#guardPlan(plan, true, input.signal)
        const destination = await authoringResolvePublicationV2(
          input.destinationPath,
          this.permissions.outputRoots,
          this.permissions.evidenceRoot
        )
        const exportIdentity = {
          workspaceId: input.workspaceId,
          buildId: build.buildId,
          evaluationId: accepted.evaluationId,
          destination,
          previousStateSha256: workspace.stateSha256,
          policySha256: AUTHORING_PUBLICATION_POLICY_SHA256_V3,
        }
        let exportId = ''
        for (
          let attempt = 0;
          attempt < this.permissions.limits.maxBuilds;
          attempt++
        )
        {
          const candidate = identity('export', { ...exportIdentity, attempt })
          if (
            (
              await workspace.retention.store.quotaOutcome(
                `publications/${candidate}/capacity`
              )
            ).state === 'absent'
          )
          {
            exportId = candidate
            break
          }
        }
        if (!exportId)
          return fail(
            'authoring.publication_budget_exceeded',
            'bounded publication reservation attempts are exhausted for this workspace state'
          )
        assertAuthoringActiveV1(input.signal)
        const entries = await workspace.retention.store.listImmutable('')
        const capability = await workspace.retention.store.capability()
        const reservedEntries =
          AUTHORING_PUBLICATION_POLICY_V2.maximumNewEntries
        if (
          entries.length + reservedEntries >
          this.permissions.limits.maxRetainedArtifacts
        )
          return fail(
            'authoring.publication_budget_exceeded',
            'publication receipt & recovery entry capacity is unavailable'
          )
        const maximumPointerBytes =
          new TextEncoder().encode(JSON.stringify(workspace.state)).byteLength +
          AUTHORING_PUBLICATION_POLICY_V2.maximumEvidenceBytes
        const reservedBytes =
          reservedEntries *
            AUTHORING_PUBLICATION_POLICY_V2.maximumEvidenceBytes +
          2 * maximumPointerBytes
        if (
          !Number.isSafeInteger(reservedBytes) ||
          reservedBytes > capability.quota.availableBytes
        )
          return fail(
            'authoring.publication_budget_exceeded',
            'publication receipt & recovery byte capacity is unavailable'
          )
        const reservationId = `publications/${exportId}/capacity`
        const intent: AuthoringPublicationIntent = {
          schemaVersion: 3,
          kind: 'authoring-publication-intent-v3',
          exportId,
          workspaceId: input.workspaceId,
          buildId: build.buildId,
          evaluationId: accepted.evaluationId,
          evaluation,
          candidate: build.candidate,
          plan: build.planRecord,
          contractSha256: plan.contract.contractSha256,
          sourceClosureSha256: plan.sourceClosureSha256,
          tools: plan.tools,
          permissionsSha256: this.#permissionsSha256,
          policySha256: AUTHORING_PUBLICATION_POLICY_SHA256_V3,
          previousStateSha256: workspace.stateSha256,
          ownerSha256: capability.ownershipSha256,
          directory: destination.directory,
          finalBasename: destination.finalBasename,
          tempBasename: `.authoring-${randomUUID()}.tmp`,
          capacity: {
            reservationId,
            reservedBytes,
            reservedEntries,
            initialEntries: entries.length,
            initialBytes: capability.quota.settledBytes,
            maximumPointerBytes,
          },
        }
        assertAuthoringActiveV1(input.signal)
        await workspace.retention.store.reserveQuota(
          reservationId,
          reservedBytes
        )
        await this.publicationFaultHook?.('quota-reserved')
        let summary: AuthoringPublicationSummaryV1
        let intentRetained = false
        try
        {
          assertAuthoringActiveV1(input.signal)
          const intentRef = await this.#retainPublication(
            workspace,
            `exports/${exportId}/intent.json`,
            intent
          )
          intentRetained = true
          summary = {
            schemaVersion: 1,
            exportId,
            buildId: build.buildId,
            candidateSha256: build.candidate.sha256,
            path: destination.path,
            phase: 'intent',
            status: 'pending',
            recoverable: true,
            intent: intentRef,
            prepared: null,
            receipt: null,
            issues: [],
          }
          await this.publicationFaultHook?.('intent-before-state')
          await this.#setPublication(
            workspace,
            summary,
            true,
            [intentRef],
            input.signal
          )
        }
        catch (error)
        {
          // retained intents own their capacity even when pointer registration fails
          const retained = await workspace.retention.store.listImmutable(
            `exports/${exportId}`
          )
          if (!intentRetained && retained.length === 0)
            await workspace.retention.store
              .releaseQuota(reservationId)
              .catch(() => undefined)
          throw error
        }
        try
        {
          await this.publicationFaultHook?.('intent-retained')
          assertAuthoringActiveV1(input.signal)
          const preparation = await this.#preparePublication(
            workspace,
            summary,
            intent,
            bytes,
            0,
            input.signal
          )
          summary = this.#publication(workspace, exportId)
          await this.#freshPublicationGate(
            workspace,
            intent,
            plan,
            input.signal
          )
          await this.publicationFaultHook?.('before-commit')
          await this.#freshPublicationGate(
            workspace,
            intent,
            plan,
            input.signal
          )
          assertAuthoringActiveV1(input.signal)
          commitPreparedPublicationV1(preparation.proof)
          await this.publicationFaultHook?.('after-commit')
          return await this.#finishPublication(
            workspace,
            summary,
            intent,
            preparation
          )
        }
        catch (error)
        {
          return this.#publicationInterrupted(workspace, summary, intent, error)
        }
      },
      true
    )
  }

  async recoverExport(input: {
    workspaceId: string
    exportId: string
    signal?: AbortSignal
  }): Promise<AuthoringPublicationOutcomeV1>
  {
    checkId(input.exportId, 'export')
    return this.#mutate(
      input.workspaceId,
      input.signal,
      (workspace) =>
        this.#recoverPublication(workspace, input.exportId, input.signal),
      true
    )
  }

  async #recoverPublication(
    workspace: WritableWorkspace,
    exportId: string,
    signal?: AbortSignal
  ): Promise<AuthoringPublicationOutcomeV1>
  {
    let summary = this.#publication(workspace, exportId)
    const intent = await this.#readPublicationIntent(workspace, summary)
    assertAuthoringActiveV1(signal)
    if (
      workspace.state.pendingPublication !== null &&
      workspace.state.pendingPublication !== exportId
    )
      return fail(
        'authoring.publication_recovery_required',
        'a different publication owns the pending recovery capacity'
      )
    if (summary.status === 'aborted')
      return this.#publicationOutcome(summary, intent)
    try
    {
      assertPublicationDirectoryIdentityV1(intent.directory)
      let preparation =
        summary.prepared === null
          ? null
          : await workspace.retention.readJson<AuthoringPublicationPreparationV2>(
              summary.prepared
            )
      if (preparation) this.#checkPreparation(intent, summary, preparation)
      if (summary.status === 'complete')
      {
        if (!preparation || !summary.receipt)
          return fail(
            'authoring.publication_evidence_changed',
            'completed publication lacks its exact preparation or receipt'
          )
        const verified = verifyCommittedPublicationV1(preparation.proof, {
          maxBytes: intent.candidate.byteLength,
        })
        await this.#publicationInputs(
          workspace,
          intent.buildId,
          intent,
          undefined,
          preparation
        )
        const receipt = await workspace.retention.read(summary.receipt)
        if (
          authoringBytesSha256V1(
            authoringPublicationEvidenceBytesV2(
              this.#publicationReceiptValue(summary, intent, verified)
            )
          ) !== authoringBytesSha256V1(receipt)
        )
          return fail(
            'authoring.publication_evidence_changed',
            'completed receipt differs from the exact intent, preparation or publication'
          )
        return this.#publicationOutcome(summary, intent)
      }
      const quota = await workspace.retention.store.quotaOutcome(
        intent.capacity.reservationId
      )
      if (quota.state !== 'active' && quota.state !== 'settled')
        return fail(
          'authoring.publication_interference',
          'publication capacity is missing or terminal and cannot be reopened'
        )
      if (preparation === null)
      {
        for (const ordinal of [1, 0] as const)
        {
          const recovered = await authoringRecoverPreparationV2({
            ...intent,
            tempBasename:
              ordinal === 0
                ? intent.tempBasename
                : `.authoring-${intent.exportId}-replacement.tmp`,
            sha256: intent.candidate.sha256,
            byteLength: intent.candidate.byteLength,
          })
          if (!recovered) continue
          const observed = inspectPreparedPublicationV1(recovered, {
            maxBytes: intent.candidate.byteLength,
          })
          preparation = await this.#retainPreparation(
            workspace,
            summary,
            intent,
            {
              schemaVersion: 2,
              exportId,
              intentSha256: summary.intent.sha256,
              ordinal,
              proof: recovered,
            },
            observed.finalPresent && observed.finalMatchesProof
              ? undefined
              : signal
          )
          summary = this.#publication(workspace, exportId)
          break
        }
      }
      let observed = preparation
        ? inspectPreparedPublicationV1(preparation.proof, {
            maxBytes: intent.candidate.byteLength,
          })
        : null
      if (observed?.finalPresent)
      {
        if (!observed.finalMatchesProof)
          return fail(
            'authoring.publication_interference',
            'destination differs from the retained prepared inode or candidate'
          )
        await this.#publicationInputs(
          workspace,
          intent.buildId,
          intent,
          undefined,
          preparation!
        )
        syncPublicationDirectoryV1(intent.directory.canonicalRealpath)
        return await this.#finishPublication(
          workspace,
          summary,
          intent,
          preparation!
        )
      }
      if (quota.state !== 'active')
        return fail(
          'authoring.publication_interference',
          'settled publication no longer has its exact published output'
        )
      const { plan } = await this.#buildAndPlan(
        workspace,
        intent.buildId,
        signal
      )
      let bytes: Uint8Array
      try
      {
        const checked = await this.#publicationInputs(
          workspace,
          intent.buildId,
          intent,
          signal
        )
        bytes = checked.bytes
        await this.#freshPublicationGate(workspace, intent, plan, signal)
      }
      catch (error)
      {
        if (preparation && observed?.tempPresent && observed.tempMatchesProof)
          releasePreparedPublicationV1(preparation.proof)
        return await this.#abortPublication(workspace, summary, intent, error)
      }
      if (!preparation || !observed?.tempMatchesProof)
      {
        if (observed?.tempPresent || preparation?.ordinal === 1)
          return fail(
            'authoring.publication_interference',
            'prepared temporary is conflicting or its bounded replacement was already consumed'
          )
        preparation = await this.#preparePublication(
          workspace,
          summary,
          intent,
          bytes,
          1,
          signal
        )
        summary = this.#publication(workspace, exportId)
        observed = inspectPreparedPublicationV1(preparation.proof, {
          maxBytes: intent.candidate.byteLength,
        })
      }
      await this.publicationFaultHook?.('before-commit')
      await this.#freshPublicationGate(workspace, intent, plan, signal)
      assertAuthoringActiveV1(signal)
      commitPreparedPublicationV1(preparation.proof)
      await this.publicationFaultHook?.('after-commit')
      return await this.#finishPublication(
        workspace,
        summary,
        intent,
        preparation
      )
    }
    catch (error)
    {
      return this.#publicationInterrupted(workspace, summary, intent, error)
    }
  }

  async #publicationInputs(
    workspace: Workspace,
    buildId: string,
    intent?: AuthoringPublicationIntent,
    signal?: AbortSignal,
    published?: AuthoringPublicationPreparationV2
  )
  {
    const { build, plan } = await this.#buildAndPlan(workspace, buildId, signal)
    this.#checkPlanIdentity(plan)
    let accepted: EvaluationRecord | undefined
    let evaluation: AuthoringArtifactRefV1 | undefined
    for (const entry of [...workspace.state.evaluations].reverse())
    {
      assertAuthoringActiveV1(signal)
      const value = await workspace.retention.readJson<EvaluationRecord>(
        entry.artifact
      )
      if (value.buildId !== buildId) continue
      if (intent !== undefined && value.evaluationId !== intent.evaluationId)
        continue
      accepted = value
      evaluation = entry.artifact
      break
    }
    if (
      !accepted ||
      !evaluation ||
      accepted.disposition !== 'accepted' ||
      accepted.candidateSha256 !== build.candidate.sha256
    )
      return fail(
        'authoring.evaluation_required',
        'export requires an exact-build accepted evaluation'
      )
    if (
      intent !== undefined &&
      (editCanonicalSha256V1(evaluation) !==
        editCanonicalSha256V1(intent.evaluation) ||
        editCanonicalSha256V1(build.candidate) !==
          editCanonicalSha256V1(intent.candidate) ||
        editCanonicalSha256V1(build.planRecord) !==
          editCanonicalSha256V1(intent.plan) ||
        plan.contract.contractSha256 !== intent.contractSha256 ||
        plan.sourceClosureSha256 !== intent.sourceClosureSha256 ||
        editCanonicalSha256V1(plan.tools) !==
          editCanonicalSha256V1(intent.tools))
    )
      return fail(
        'authoring.publication_evidence_changed',
        'publication intent differs from its retained build, plan or accepted evaluation'
      )
    const bytes = await workspace.retention.read(build.candidate)
    assertAuthoringActiveV1(signal)
    const result =
      await workspace.retention.readJson<AuthoringCandidateEvaluation>(
        accepted.result
      )
    if (published)
    {
      if (
        !intent ||
        published.proof.sha256 !== intent.candidate.sha256 ||
        published.proof.byteLength !== intent.candidate.byteLength
      )
        return fail(
          'authoring.publication_evidence_changed',
          'historical acceptance requires the exact published candidate proof'
        )
      verifyCommittedPublicationV1(published.proof, {
        maxBytes: intent.candidate.byteLength,
      })
    }
    const issues =
      result.schemaVersion === 3
        ? (published
            ? validateRecordedAuthoringCandidateEvaluationV3
            : validateAuthoringCandidateEvaluationV3)(
            result,
            this.#evaluationRequest(plan, bytes)
          )
        : published
          ? verifyLegacyPublishedAuthoringCandidateEvaluationV2(
              result,
              this.#recordedEvaluationRequest(plan, bytes)
            )
          : ['new publication requires current v3 accepted evaluation evidence']
    if (issues.length > 0 || result.disposition !== 'accepted')
      return fail(
        'authoring.invalid_evaluation_evidence',
        issues.join('; ') || 'retained evaluation is not accepted'
      )
    if (
      accepted.mediaArtifacts.length !== result.mediaArtifacts.length ||
      accepted.mediaArtifacts.some((entry, index) =>
      {
        const recorded = result.mediaArtifacts[index]!
        return (
          entry.sourcePath !== recorded.path ||
          entry.artifact.sha256 !== recorded.sha256 ||
          entry.artifact.byteLength !== recorded.byteLength ||
          entry.artifact.mimeType !== recorded.mimeType
        )
      })
    )
      return fail(
        'authoring.invalid_evaluation_evidence',
        'retained media mapping differs from the accepted evaluation'
      )
    for (const media of accepted.mediaArtifacts)
    {
      assertAuthoringActiveV1(signal)
      await workspace.retention.read(media.artifact)
    }
    assertAuthoringActiveV1(signal)
    return { build, plan, accepted, evaluation, bytes }
  }

  #publication(
    workspace: WritableWorkspace,
    exportId: string
  ): AuthoringPublicationSummaryV1
  {
    const summary = workspace.state.publications.find(
      (entry) => entry.exportId === exportId
    )
    if (summary === undefined)
      return fail(
        'authoring.export_unavailable',
        'publication is not retained by this workspace'
      )
    return summary
  }

  #publicationOutcome(
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent
  ): AuthoringPublicationOutcomeV1
  {
    return {
      ...summary,
      workspaceId: intent.workspaceId,
      sha256: intent.candidate.sha256,
      byteLength: intent.candidate.byteLength,
    }
  }

  async #discoverPublications(
    workspace: Workspace
  ): Promise<DiscoveredPublications>
  {
    if (workspace.state.schemaVersion !== 2)
      return {
        publications: [],
        artifacts: [],
        unclaimedReservations: [],
        identitySha256: editCanonicalSha256V1([]),
      }
    const entries = await workspace.retention.store.listImmutable('exports')
    const reservations =
      await workspace.retention.store.activeQuotaReservations()
    const groups = new Map<string, Map<string, AuthoringArtifactRefV1>>()
    for (const entry of entries)
    {
      const match = /^exports\/(export-[a-f0-9]{32})\/(.+)$/u.exec(entry.key)
      if (!match) continue
      const [, exportId, name] = match
      if (
        ![
          'intent.json',
          'prepared-0.json',
          'prepared-1.json',
          'receipt.json',
        ].includes(name!) ||
        entry.byteLength > AUTHORING_PUBLICATION_POLICY_V3.maximumEvidenceBytes
      )
        return fail(
          'authoring.publication_evidence_changed',
          'publication discovery found an unsupported or oversized phase record'
        )
      const group =
        groups.get(exportId!) ?? new Map<string, AuthoringArtifactRefV1>()
      group.set(name!, {
        workspaceId: workspace.state.workspaceId,
        key: entry.key,
        path: join(workspace.retention.root, entry.key),
        sha256: entry.sha256,
        byteLength: entry.byteLength,
        mimeType: 'application/json',
      })
      groups.set(exportId!, group)
    }
    if (groups.size > this.permissions.limits.maxBuilds)
      return fail(
        'authoring.publication_budget_exceeded',
        'discovered publication count exceeds the workspace bound'
      )
    for (const summary of workspace.state.publications)
      if (!groups.has(summary.exportId))
        return fail(
          'authoring.publication_evidence_changed',
          'registered publication has no retained intent'
        )
    const publications: AuthoringPublicationSummaryV1[] = []
    const artifacts: AuthoringArtifactRefV1[] = []
    const quota: unknown[] = []
    const orderedIds = [
      ...new Set([
        ...workspace.state.publications.map((entry) => entry.exportId),
        ...[...groups.keys()].sort(),
      ]),
    ]
    for (const exportId of orderedIds)
    {
      const group = groups.get(exportId)!
      const intentRef = group.get('intent.json')
      if (!intentRef)
        return fail(
          'authoring.publication_evidence_changed',
          'prepared publication or receipt has no retained intent'
        )
      const value =
        await workspace.retention.readJson<AuthoringPublicationIntent>(
          intentRef
        )
      const current = workspace.state.publications.find(
        (entry) => entry.exportId === exportId
      )
      const summary: AuthoringPublicationSummaryV1 = current ?? {
        schemaVersion: 1,
        exportId,
        buildId: value.buildId,
        candidateSha256: value.candidate.sha256,
        path: join(value.directory.canonicalRealpath, value.finalBasename),
        phase: 'intent',
        status: 'recovery-required',
        recoverable: true,
        intent: intentRef,
        prepared: null,
        receipt: null,
        issues: ['retained intent requires workspace pointer reconciliation'],
      }
      for (const ref of [summary.intent, summary.prepared, summary.receipt])
        if (ref)
        {
          const discovered = group.get(basename(ref.key))
          if (
            !discovered ||
            editCanonicalSha256V1(discovered) !== editCanonicalSha256V1(ref)
          )
            return fail(
              'authoring.publication_evidence_changed',
              'publication pointer differs from its immutable phase record'
            )
        }
      const intent = await this.#readPublicationIntent(workspace, summary)
      const { build, plan } = await this.#buildAndPlan(
        workspace,
        intent.buildId
      )
      this.#checkPlanIdentity(plan)
      if (
        editCanonicalSha256V1(build.candidate) !==
          editCanonicalSha256V1(intent.candidate) ||
        editCanonicalSha256V1(build.planRecord) !==
          editCanonicalSha256V1(intent.plan) ||
        intent.contractSha256 !== plan.contract.contractSha256 ||
        intent.sourceClosureSha256 !== plan.sourceClosureSha256 ||
        editCanonicalSha256V1(intent.tools) !==
          editCanonicalSha256V1(plan.tools) ||
        !workspace.state.evaluations.some(
          (entry) =>
            entry.evaluationId === intent.evaluationId &&
            editCanonicalSha256V1(entry.artifact) ===
              editCanonicalSha256V1(intent.evaluation)
        )
      )
        return fail(
          'authoring.publication_evidence_changed',
          'discovered intent differs from its retained build, plan or evaluation'
        )
      let prepared: AuthoringArtifactRefV1 | null = null
      let preparation: AuthoringPublicationPreparationV2 | null = null
      for (const ordinal of [0, 1] as const)
      {
        const ref = group.get(`prepared-${ordinal}.json`)
        if (!ref) continue
        const record =
          await workspace.retention.readJson<AuthoringPublicationPreparationV2>(
            ref
          )
        this.#checkPreparation(intent, summary, record)
        if (record.ordinal !== ordinal)
          return fail(
            'authoring.publication_evidence_changed',
            'preparation ordinal differs from its immutable name'
          )
        prepared = ref
        preparation = record
      }
      const receipt = group.get('receipt.json') ?? null
      if (receipt)
      {
        if (!preparation || !prepared)
          return fail(
            'authoring.publication_evidence_changed',
            'publication receipt lacks its retained preparation'
          )
        const expected = this.#publicationReceiptValue(
          { ...summary, prepared },
          intent,
          preparation.proof
        )
        if (
          authoringBytesSha256V1(
            authoringPublicationEvidenceBytesV2(expected)
          ) !== receipt.sha256
        )
          return fail(
            'authoring.publication_evidence_changed',
            'discovered receipt differs from its exact intent and preparation'
          )
        await workspace.retention.read(receipt)
      }
      const changed =
        !current ||
        current.prepared?.sha256 !== prepared?.sha256 ||
        current.receipt?.sha256 !== receipt?.sha256
      if (
        changed &&
        current &&
        ['complete', 'aborted'].includes(current.status)
      )
        return fail(
          'authoring.publication_evidence_changed',
          'terminal publication acquired conflicting later phase evidence'
        )
      publications.push(
        changed
          ? {
              ...summary,
              prepared,
              receipt,
              phase: receipt ? 'published' : prepared ? 'prepared' : 'intent',
              status: 'recovery-required',
              recoverable: true,
              issues: [
                'retained publication phase requires workspace pointer reconciliation',
              ],
            }
          : summary
      )
      artifacts.push(...group.values())
      quota.push(
        await workspace.retention.store.quotaOutcome(
          intent.capacity.reservationId
        )
      )
    }
    const unclaimedReservations = reservations
      .filter((reservation) =>
      {
        const match = /^publications\/(export-[a-f0-9]{32})\/capacity$/u.exec(
          reservation.reservationId
        )
        return match !== null && !groups.has(match[1]!)
      })
      .map((reservation) => reservation.reservationId)
    return {
      publications,
      artifacts,
      unclaimedReservations,
      identitySha256: editCanonicalSha256V1({ entries, reservations, quota }),
    }
  }

  async #publicationFilesAbsent(
    intent: AuthoringPublicationIntent
  ): Promise<boolean>
  {
    assertPublicationDirectoryIdentityV1(intent.directory)
    for (const name of [
      intent.finalBasename,
      intent.tempBasename,
      `.authoring-${intent.exportId}-replacement.tmp`,
    ])
    {
      try
      {
        await lstat(join(intent.directory.canonicalRealpath, name))
        return false
      }
      catch (error)
      {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 'ENOENT'
        )
          throw error
      }
    }
    return true
  }

  async #reconcilePublications(
    workspace: WritableWorkspace,
    signal?: AbortSignal
  ): Promise<void>
  {
    const discovered = await this.#discoverPublications(workspace)
    for (const reservation of discovered.unclaimedReservations)
    {
      // preparation is unreachable until its immutable intent exists
      assertAuthoringActiveV1(signal)
      await workspace.retention.store.releaseQuota(reservation)
    }
    let pending = workspace.state.pendingPublication
    for (let summary of discovered.publications)
    {
      const intent = await this.#readPublicationIntent(workspace, summary)
      const quota = await workspace.retention.store.quotaOutcome(
        intent.capacity.reservationId
      )
      if (
        quota.state !== 'absent' &&
        quota.reservedBytes !== intent.capacity.reservedBytes
      )
        return fail(
          'authoring.publication_evidence_changed',
          'publication reservation differs from its retained capacity'
        )
      if (summary.status === 'aborted')
      {
        if (quota.state === 'active')
        {
          assertAuthoringActiveV1(signal)
          await workspace.retention.store.releaseQuota(
            intent.capacity.reservationId
          )
        }
        continue
      }
      if (summary.status === 'complete') continue
      if (pending !== null && pending !== summary.exportId) continue
      if (
        (quota.state === 'released' || quota.state === 'absent') &&
        summary.prepared === null &&
        summary.receipt === null &&
        (await this.#publicationFilesAbsent(intent))
      )
        summary = {
          ...summary,
          phase: 'aborted',
          status: 'aborted',
          recoverable: false,
          issues: [
            'publication reservation is terminal or absent and no preparation or output exists',
          ],
        }
      const active = summary.status !== 'aborted'
      const current = workspace.state.publications.find(
        (entry) => entry.exportId === summary.exportId
      )
      const artifacts = discovered.artifacts.filter((entry) =>
        entry.key.startsWith(`exports/${summary.exportId}/`)
      )
      if (
        editCanonicalSha256V1(current ?? null) !==
          editCanonicalSha256V1(summary) ||
        (active && pending !== summary.exportId) ||
        artifacts.some(
          (ref) =>
            !workspace.state.artifacts.some((entry) => entry.key === ref.key)
        )
      )
        await this.#setPublication(
          workspace,
          summary,
          active,
          artifacts,
          signal
        )
      pending = workspace.state.pendingPublication
    }
    if (
      workspace.state.pendingPublication === null &&
      workspace.state.publicationPolicySha256 !==
        AUTHORING_PUBLICATION_POLICY_SHA256_V3
    )
    {
      const remaining = await this.#discoverPublications(workspace)
      if (
        !remaining.publications.some(
          (entry) => entry.status !== 'complete' && entry.status !== 'aborted'
        )
      )
        await this.#save(
          workspace,
          {
            ...workspace.state,
            publicationPolicySha256: AUTHORING_PUBLICATION_POLICY_SHA256_V3,
          },
          signal
        )
    }
  }

  async #readPublicationIntent(
    workspace: Workspace,
    summary: AuthoringPublicationSummaryV1
  ): Promise<AuthoringPublicationIntent>
  {
    if (
      summary.intent.byteLength >
        AUTHORING_PUBLICATION_POLICY_V2.maximumEvidenceBytes ||
      (summary.prepared?.byteLength ?? 0) >
        AUTHORING_PUBLICATION_POLICY_V2.maximumEvidenceBytes ||
      (summary.receipt?.byteLength ?? 0) >
        AUTHORING_PUBLICATION_POLICY_V2.maximumEvidenceBytes
    )
      return fail(
        'authoring.publication_budget_exceeded',
        'publication record exceeds its bounded evidence policy'
      )
    const intent =
      await workspace.retention.readJson<AuthoringPublicationIntent>(
        summary.intent
      )
    if (
      !(
        (intent.schemaVersion === 2 &&
          intent.kind === 'authoring-publication-intent-v2' &&
          intent.policySha256 === AUTHORING_PUBLICATION_POLICY_SHA256_V2) ||
        (intent.schemaVersion === 3 &&
          intent.kind === 'authoring-publication-intent-v3' &&
          intent.policySha256 === AUTHORING_PUBLICATION_POLICY_SHA256_V3)
      ) ||
      intent.exportId !== summary.exportId ||
      intent.workspaceId !== workspace.state.workspaceId ||
      intent.buildId !== summary.buildId ||
      intent.candidate.sha256 !== summary.candidateSha256 ||
      join(intent.directory.canonicalRealpath, intent.finalBasename) !==
        summary.path ||
      intent.permissionsSha256 !== this.#permissionsSha256 ||
      intent.capacity.reservationId !==
        `publications/${summary.exportId}/capacity` ||
      intent.capacity.reservedEntries !==
        AUTHORING_PUBLICATION_POLICY_V2.maximumNewEntries ||
      !Number.isSafeInteger(intent.capacity.reservedBytes) ||
      intent.capacity.reservedBytes !==
        intent.capacity.reservedEntries *
          AUTHORING_PUBLICATION_POLICY_V3.maximumEvidenceBytes +
          2 * intent.capacity.maximumPointerBytes ||
      intent.capacity.reservedBytes >
        this.permissions.limits.maxRetainedBytes ||
      !Number.isSafeInteger(intent.capacity.maximumPointerBytes) ||
      intent.capacity.maximumPointerBytes <= 0 ||
      intent.capacity.maximumPointerBytes >
        this.permissions.limits.maxRetainedBytes ||
      !/^[a-f0-9]{64}$/u.test(intent.previousStateSha256) ||
      !/^[a-f0-9]{64}$/u.test(intent.ownerSha256) ||
      basename(intent.finalBasename) !== intent.finalBasename ||
      !/^\.authoring-[a-f0-9-]+\.tmp$/u.test(intent.tempBasename) ||
      !Number.isSafeInteger(intent.capacity.initialEntries) ||
      intent.capacity.initialEntries < 0 ||
      intent.capacity.initialEntries >
        this.permissions.limits.maxRetainedArtifacts ||
      !Number.isSafeInteger(intent.capacity.initialBytes) ||
      intent.capacity.initialBytes < 0 ||
      intent.capacity.initialBytes > this.permissions.limits.maxRetainedBytes
    )
      return fail(
        'authoring.publication_evidence_changed',
        'publication intent no longer matches its bounded policy or workspace identity'
      )
    if (
      !isAbsolute(intent.directory.canonicalRealpath) ||
      resolve(intent.directory.canonicalRealpath) !==
        intent.directory.canonicalRealpath ||
      !summary.path.endsWith('.sb3') ||
      !this.permissions.outputRoots.some((root) =>
        isPathWithinRootV1(root, summary.path)
      ) ||
      isPathWithinRootV1(this.permissions.evidenceRoot, summary.path)
    )
      return fail(
        'authoring.output_outside_permissions',
        'retained publication destination is outside operator output roots'
      )
    return intent
  }

  #checkPreparation(
    intent: AuthoringPublicationIntent,
    summary: AuthoringPublicationSummaryV1,
    preparation: AuthoringPublicationPreparationV2
  ): void
  {
    if (
      preparation.schemaVersion !== 2 ||
      preparation.exportId !== intent.exportId ||
      preparation.intentSha256 !== summary.intent.sha256 ||
      (preparation.ordinal !== 0 && preparation.ordinal !== 1) ||
      preparation.proof.schemaVersion !== 1 ||
      preparation.proof.nameDurableBeforeWrite !== true ||
      preparation.proof.fileSynced !== true ||
      preparation.proof.readbackVerified !== true ||
      !/^[0-9]+$/u.test(preparation.proof.device) ||
      !/^[0-9]+$/u.test(preparation.proof.inode) ||
      !/^[0-7]{3,4}$/u.test(preparation.proof.mode) ||
      preparation.proof.finalCanonicalPath !== summary.path ||
      preparation.proof.sha256 !== intent.candidate.sha256 ||
      preparation.proof.byteLength !== intent.candidate.byteLength ||
      preparation.proof.tempBasename !==
        (preparation.ordinal === 0
          ? intent.tempBasename
          : `.authoring-${intent.exportId}-replacement.tmp`) ||
      preparation.proof.tempCanonicalPath !==
        join(
          intent.directory.canonicalRealpath,
          preparation.proof.tempBasename
        ) ||
      editCanonicalSha256V1(preparation.proof.directory) !==
        editCanonicalSha256V1(intent.directory)
    )
      return fail(
        'authoring.publication_evidence_changed',
        'retained preparation differs from the intent or exact candidate'
      )
  }

  async #retainPublication(
    workspace: WritableWorkspace,
    key: string,
    value: unknown
  )
  {
    return workspace.retention.retain(
      key,
      authoringPublicationEvidenceBytesV2(value),
      'application/json'
    )
  }

  async #setPublication(
    workspace: WritableWorkspace,
    summary: AuthoringPublicationSummaryV1,
    pending: boolean,
    artifacts: readonly AuthoringArtifactRefV1[] = [],
    signal?: AbortSignal
  )
  {
    const existing = workspace.state.publications.findIndex(
      (entry) => entry.exportId === summary.exportId
    )
    const publications = [...workspace.state.publications]
    if (existing < 0) publications.push(summary)
    else publications[existing] = summary
    const state: CurrentState = {
      ...workspace.state,
      publications,
      pendingPublication: pending ? summary.exportId : null,
      artifacts: this.#catalog(workspace.state.artifacts, artifacts),
    }
    await this.#save(workspace, state, signal)
  }

  async #publicationCapacity(
    workspace: WritableWorkspace,
    intent: AuthoringPublicationIntent,
    allowSettled = false
  ): Promise<void>
  {
    const quota = await workspace.retention.store.quotaOutcome(
      intent.capacity.reservationId
    )
    if (
      (quota.state !== 'active' &&
        !(allowSettled && quota.state === 'settled')) ||
      quota.reservedBytes !== intent.capacity.reservedBytes
    )
      return fail(
        'authoring.publication_budget_exceeded',
        'publication has no matching active capacity reservation'
      )
    const entries = await workspace.retention.store.listImmutable('')
    if (
      entries.length >
        intent.capacity.initialEntries + intent.capacity.reservedEntries ||
      entries.length > this.permissions.limits.maxRetainedArtifacts ||
      new TextEncoder().encode(JSON.stringify(workspace.state)).byteLength >
        intent.capacity.maximumPointerBytes
    )
      return fail(
        'authoring.publication_budget_exceeded',
        'publication consumed more than its reserved evidence entry or pointer capacity'
      )
    const capability = await workspace.retention.store.capability()
    if (
      capability.quota.settledBytes >
      intent.capacity.initialBytes + intent.capacity.reservedBytes
    )
      return fail(
        'authoring.publication_budget_exceeded',
        'publication consumed more than its reserved retained bytes'
      )
  }

  async #retainPreparation(
    workspace: WritableWorkspace,
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent,
    preparation: AuthoringPublicationPreparationV2,
    signal?: AbortSignal
  )
  {
    this.#checkPreparation(intent, summary, preparation)
    await this.#publicationCapacity(workspace, intent)
    assertAuthoringActiveV1(signal)
    const artifact = await this.#retainPublication(
      workspace,
      `exports/${intent.exportId}/prepared-${preparation.ordinal}.json`,
      preparation
    )
    await this.publicationFaultHook?.('prepared-before-state')
    await this.#setPublication(
      workspace,
      {
        ...summary,
        phase: 'prepared',
        status: 'pending',
        prepared: artifact,
        issues: [],
      },
      true,
      [artifact],
      signal
    )
    await this.publicationFaultHook?.('prepared-retained')
    return preparation
  }

  async #preparePublication(
    workspace: WritableWorkspace,
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent,
    bytes: Uint8Array,
    ordinal: 0 | 1,
    signal?: AbortSignal
  )
  {
    await this.#publicationCapacity(workspace, intent)
    assertAuthoringActiveV1(signal)
    const tempBasename =
      ordinal === 0
        ? intent.tempBasename
        : `.authoring-${intent.exportId}-replacement.tmp`
    const recovered = await authoringRecoverPreparationV2({
      directory: intent.directory,
      finalBasename: intent.finalBasename,
      tempBasename,
      sha256: intent.candidate.sha256,
      byteLength: intent.candidate.byteLength,
    })
    assertAuthoringActiveV1(signal)
    const proof =
      recovered ??
      preparePublicationFileV1({
        directory: intent.directory,
        finalBasename: intent.finalBasename,
        tempBasename,
        bytes,
        expectedSha256: intent.candidate.sha256,
        maxBytes: this.permissions.archiveLimits.maxCompressedBytes,
      })
    await this.publicationFaultHook?.('prepared-file-created')
    return this.#retainPreparation(
      workspace,
      summary,
      intent,
      {
        schemaVersion: 2,
        exportId: intent.exportId,
        intentSha256: summary.intent.sha256,
        ordinal,
        proof,
      },
      signal
    )
  }

  async #freshPublicationGate(
    workspace: WritableWorkspace,
    intent: AuthoringPublicationIntent,
    plan: PlanRecord,
    signal?: AbortSignal
  ): Promise<void>
  {
    assertAuthoringActiveV1(signal)
    if (
      intent.schemaVersion !== 3 ||
      intent.policySha256 !== AUTHORING_PUBLICATION_POLICY_SHA256_V3
    )
      return fail(
        'authoring.tools_changed',
        'new publication requires current v3 policy and accepted evaluation'
      )
    await this.#publicationCapacity(workspace, intent)
    const current =
      await workspace.retention.store.hashImmutable('workspace.json')
    if (
      current !== workspace.stateSha256 ||
      workspace.state.pendingPublication !== intent.exportId
    )
      return fail(
        'authoring.workspace_changed',
        'workspace pointer changed before publication'
      )
    const { accepted, evaluation } = await this.#publicationInputs(
      workspace,
      intent.buildId,
      undefined,
      signal
    )
    if (
      accepted.evaluationId !== intent.evaluationId ||
      evaluation.sha256 !== intent.evaluation.sha256
    )
      return fail(
        'authoring.evaluation_changed',
        'latest exact-build evaluation changed before publication'
      )
    await this.#guardPlan(plan, true, signal)
    await authoringResolvePublicationV2(
      join(intent.directory.canonicalRealpath, intent.finalBasename),
      this.permissions.outputRoots,
      this.permissions.evidenceRoot
    )
    assertAuthoringActiveV1(signal)
    assertPublicationDirectoryIdentityV1(intent.directory)
  }

  async #finishPublication(
    workspace: WritableWorkspace,
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent,
    preparation: AuthoringPublicationPreparationV2
  ): Promise<AuthoringPublicationOutcomeV1>
  {
    this.#checkPreparation(intent, summary, preparation)
    await this.#publicationCapacity(workspace, intent, true)
    const verified = verifyCommittedPublicationV1(preparation.proof, {
      maxBytes: intent.candidate.byteLength,
    })
    const published = {
      ...summary,
      phase: 'published' as const,
      status: 'pending' as const,
      issues: [],
    }
    await this.#setPublication(workspace, published, true)
    await this.publicationFaultHook?.('before-receipt')
    const receipt = await this.#retainPublication(
      workspace,
      `exports/${intent.exportId}/receipt.json`,
      this.#publicationReceiptValue(summary, intent, verified)
    )
    await this.publicationFaultHook?.('after-receipt')
    const complete: AuthoringPublicationSummaryV1 = {
      ...published,
      phase: 'complete',
      status: 'complete',
      recoverable: false,
      receipt,
    }
    const publications = workspace.state.publications.map((entry) =>
      entry.exportId === complete.exportId ? complete : entry
    )
    const state: CurrentState = {
      ...workspace.state,
      publications,
      pendingPublication: null,
      exports: this.#catalog(workspace.state.exports, [receipt]),
      artifacts: this.#catalog(workspace.state.artifacts, [receipt]),
    }
    const stateBytes = new TextEncoder().encode(
      JSON.stringify(state)
    ).byteLength
    if (stateBytes > intent.capacity.maximumPointerBytes)
      return fail(
        'authoring.publication_budget_exceeded',
        'completed pointer exceeds its prepublication reservation'
      )
    releasePreparedPublicationV1(preparation.proof)
    const capability = await workspace.retention.store.capability()
    const currentPointerBytes =
      await workspace.retention.store.sizeImmutable('workspace.json')
    const actualBytes = Math.max(
      0,
      capability.quota.settledBytes -
        currentPointerBytes +
        stateBytes -
        intent.capacity.initialBytes
    )
    const quota = await workspace.retention.store.quotaOutcome(
      intent.capacity.reservationId
    )
    if (quota.state === 'active')
      await workspace.retention.store.settleQuota(
        intent.capacity.reservationId,
        actualBytes
      )
    else if (quota.state !== 'settled' || quota.actualBytes !== actualBytes)
      return fail(
        'authoring.publication_evidence_changed',
        'publication byte reservation has an inconsistent recovery outcome'
      )
    await this.publicationFaultHook?.('before-state')
    await this.#save(workspace, state)
    await this.publicationFaultHook?.('after-state')
    return this.#publicationOutcome(complete, intent)
  }

  #publicationReceiptValue(
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent,
    verified: Pick<
      ReturnType<typeof verifyCommittedPublicationV1>,
      'finalCanonicalPath' | 'sha256' | 'byteLength' | 'device' | 'inode'
    >
  )
  {
    return {
      schemaVersion: intent.schemaVersion,
      kind:
        intent.schemaVersion === 3
          ? 'authoring-export-receipt-v3'
          : 'authoring-export-receipt-v2',
      exportId: intent.exportId,
      workspaceId: intent.workspaceId,
      buildId: intent.buildId,
      evaluationId: intent.evaluationId,
      contractSha256: intent.contractSha256,
      sourceClosureSha256: intent.sourceClosureSha256,
      policySha256: intent.policySha256,
      intent: summary.intent,
      prepared: summary.prepared,
      path: verified.finalCanonicalPath,
      sha256: verified.sha256,
      byteLength: verified.byteLength,
      device: verified.device,
      inode: verified.inode,
      directorySynced: true,
    }
  }

  async #abortPublication(
    workspace: WritableWorkspace,
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent,
    error: unknown
  ): Promise<AuthoringPublicationOutcomeV1>
  {
    const aborted: AuthoringPublicationSummaryV1 = {
      ...summary,
      phase: 'aborted',
      status: 'aborted',
      recoverable: false,
      issues: [authoringPublicationIssueV2(error)],
    }
    await this.#setPublication(workspace, aborted, false)
    const outcome = await workspace.retention.store.quotaOutcome(
      intent.capacity.reservationId
    )
    if (outcome.state === 'active')
      await workspace.retention.store.releaseQuota(
        intent.capacity.reservationId
      )
    return this.#publicationOutcome(aborted, intent)
  }

  async #publicationInterrupted(
    workspace: WritableWorkspace,
    summary: AuthoringPublicationSummaryV1,
    intent: AuthoringPublicationIntent,
    error: unknown
  ): Promise<AuthoringPublicationOutcomeV1>
  {
    const current = this.#publication(workspace, summary.exportId)
    if (current.status === 'aborted')
      return this.#publicationOutcome(
        {
          ...current,
          issues: [...current.issues, authoringPublicationIssueV2(error)],
        },
        intent
      )
    let published = false
    if (current.prepared !== null)
    {
      try
      {
        const preparation =
          await workspace.retention.readJson<AuthoringPublicationPreparationV2>(
            current.prepared
          )
        this.#checkPreparation(intent, current, preparation)
        published = inspectPreparedPublicationV1(preparation.proof, {
          maxBytes: intent.candidate.byteLength,
        }).finalMatchesProof
        if (published && current.status === 'complete')
          return this.#publicationOutcome(current, intent)
      }
      catch
      {
        published = false
      }
    }
    const issue = authoringPublicationIssueV2(error)
    const interrupted: AuthoringPublicationSummaryV1 = {
      ...current,
      phase: published ? 'published' : current.phase,
      status:
        issue.includes('interference') || issue.includes('publication.exists')
          ? 'interference'
          : 'recovery-required',
      recoverable: true,
      issues: [issue],
    }
    try
    {
      await this.#setPublication(workspace, interrupted, true)
    }
    catch (persistenceError)
    {
      return this.#publicationOutcome(
        {
          ...interrupted,
          issues: [
            ...interrupted.issues,
            authoringPublicationIssueV2(persistenceError),
          ],
        },
        intent
      )
    }
    return this.#publicationOutcome(interrupted, intent)
  }

  async inspect(input: {
    workspaceId: string
    collection?: AuthoringWorkspaceCollectionV1
    planId?: string
    cursor?: string
    limit?: number
  })
  {
    const workspace = await this.#workspace(input.workspaceId)
    const discovered = await this.#discoverPublications(workspace)
    const collection = input.collection ?? 'status'
    const limit = input.limit ?? 16
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.permissions.limits.maxInspectionPageSize
    )
      return fail(
        'authoring.invalid_page',
        'inspection page size exceeds its host bound'
      )
    let items: readonly unknown[]
    switch (collection)
    {
      case 'status':
        items = [
          {
            workspaceId: input.workspaceId,
            closed: workspace.state.closed,
            plans: workspace.state.plans.length,
            builds: workspace.state.builds.length,
            evaluations: workspace.state.evaluations.length,
            exports: workspace.state.exports.length,
            schemaVersion: workspace.state.schemaVersion,
            publicationPolicySha256:
              workspace.state.schemaVersion === 2
                ? workspace.state.publicationPolicySha256
                : null,
            pendingPublication:
              workspace.state.schemaVersion === 2
                ? (workspace.state.pendingPublication ??
                  discovered.publications.find((entry) => entry.recoverable)
                    ?.exportId ??
                  null)
                : null,
            unclaimedPublicationReservations: discovered.unclaimedReservations,
            manifestPath: workspace.state.manifestPath,
          },
        ]
        break
      case 'plans':
        items = workspace.state.plans
        break
      case 'builds':
        items = workspace.state.builds
        break
      case 'evaluations':
        items = workspace.state.evaluations
        break
      case 'exports':
        items = workspace.state.exports
        break
      case 'publications':
        items = discovered.publications
        break
      case 'artifacts':
        items = this.#catalog(workspace.state.artifacts, discovered.artifacts)
        break
      case 'sources':
      case 'assets':
      case 'clips':
      case 'diff':
      {
        const planId = input.planId ?? workspace.state.plans.at(-1)?.planId
        if (planId === undefined)
        {
          items = []
          break
        }
        const plan = await workspace.retention.readJson<PlanRecord>(
          this.#planRef(workspace, planId)
        )
        items =
          collection === 'sources'
            ? plan.sources
            : collection === 'assets'
              ? plan.preparedAssets
              : collection === 'clips'
                ? plan.plan.clips
                : [plan.diff]
        break
      }
      default:
        return fail(
          'authoring.invalid_page',
          'unknown authoring inspection collection'
        )
    }
    const binding = {
      workspaceId: input.workspaceId,
      collection,
      planId: input.planId ?? null,
      stateSha256: workspace.stateSha256,
      publicationCatalogSha256: discovered.identitySha256,
    }
    let offset = 0
    if (input.cursor !== undefined)
    {
      let decoded: { bindingSha256: string; offset: number }
      try
      {
        decoded = JSON.parse(
          Buffer.from(input.cursor, 'base64url').toString('utf8')
        )
      }
      catch
      {
        return fail('authoring.invalid_page', 'inspection cursor is invalid')
      }
      if (
        decoded.bindingSha256 !== editCanonicalSha256V1(binding) ||
        !Number.isSafeInteger(decoded.offset) ||
        decoded.offset < 0 ||
        decoded.offset > items.length
      )
        return fail(
          'authoring.stale_page',
          'inspection cursor no longer matches this retained collection'
        )
      offset = decoded.offset
    }
    const next = offset + limit
    return {
      workspaceId: input.workspaceId,
      collection,
      stateSha256: workspace.stateSha256,
      total: items.length,
      items: items.slice(offset, next),
      nextCursor:
        next < items.length
          ? Buffer.from(
              JSON.stringify({
                bindingSha256: editCanonicalSha256V1(binding),
                offset: next,
              })
            ).toString('base64url')
          : null,
    }
  }

  async selectArtifactSnapshot(input: { workspaceId: string; key: string })
  {
    const workspace = await this.#workspace(input.workspaceId)
    const artifact =
      workspace.state.artifacts.find((entry) => entry.key === input.key) ??
      (await this.#discoverPublications(workspace)).artifacts.find(
        (entry) => entry.key === input.key
      )
    if (!artifact)
      return fail(
        'authoring.artifact_unavailable',
        'artifact is not published in this workspace catalogue'
      )
    return {
      artifact,
      load: () => workspace.retention.readSnapshotBytes(artifact),
    }
  }

  async readArtifact(input: {
    workspaceId: string
    key: string
    offset?: number
    maxBytes?: number
  })
  {
    const workspace = await this.#workspace(input.workspaceId)
    const artifact =
      workspace.state.artifacts.find((entry) => entry.key === input.key) ??
      (await this.#discoverPublications(workspace)).artifacts.find(
        (entry) => entry.key === input.key
      )
    if (!artifact)
      return fail(
        'authoring.artifact_unavailable',
        'artifact is not published in this workspace catalogue'
      )
    const offset = input.offset ?? 0
    const maxBytes = input.maxBytes ?? 256 * 1024
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > artifact.byteLength ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > this.permissions.limits.maxArtifactReadBytes
    )
      return fail(
        'authoring.invalid_page',
        'artifact read range exceeds its host bound'
      )
    const bytes = await workspace.retention.read(artifact)
    const chunk = bytes.slice(offset, offset + maxBytes)
    return {
      artifact,
      offset,
      bytes: chunk,
      nextOffset:
        offset + chunk.byteLength < bytes.byteLength
          ? offset + chunk.byteLength
          : null,
    }
  }

  async close(input: { workspaceId: string; signal?: AbortSignal })
  {
    return this.#mutate(
      input.workspaceId,
      input.signal,
      async (workspace) =>
      {
        if (!workspace.state.closed)
          await this.#save(
            workspace,
            { ...workspace.state, closed: true },
            input.signal
          )
        return {
          workspaceId: input.workspaceId,
          closed: true,
          retainedArtifacts: workspace.state.artifacts.length,
        }
      },
      false,
      true
    )
  }

  async replay(input: {
    workspaceId: string
    buildId: string
    signal?: AbortSignal
  })
  {
    return this.#withOperationLease(input.signal, async () =>
    {
      const workspace = await this.#workspace(input.workspaceId)
      assertAuthoringActiveV1(input.signal)
      checkId(input.buildId, 'build')
      const selected = workspace.state.builds.find(
        (entry) => entry.buildId === input.buildId
      )
      if (!selected)
        return fail(
          'authoring.build_unavailable',
          'build is not retained by this workspace'
        )
      const build = await workspace.retention.readJson<BuildRecord>(
        selected.artifact
      )
      const record = await workspace.retention.readJson<PlanRecord>(
        build.planRecord
      )
      await this.#guardPlan(record, false, input.signal)
      const compilation = await this.#compileRetainedPlan(
        workspace,
        record,
        input.signal
      )
      const retained = await workspace.retention.read(build.candidate)
      assertAuthoringActiveV1(input.signal)
      if (
        compilation.plan.planSha256 !== record.plan.planSha256 ||
        compilation.plan.candidateSha256 !==
          record.contract.expectedCandidateSha256 ||
        build.candidate.sha256 !== compilation.plan.candidateSha256 ||
        editCanonicalSha256V1(compilation.diff) !== record.plan.diffSha256 ||
        !Buffer.from(retained).equals(Buffer.from(compilation.candidateBytes))
      )
        return fail(
          'authoring.replay_diverged',
          'retained build differs from its exact source, plan or candidate'
        )
      await this.#guardPlan(record, false, input.signal)
      return {
        schemaVersion: 2,
        kind: 'authoring-build-replay-v2',
        disposition: 'matched',
        workspaceId: input.workspaceId,
        buildId: input.buildId,
        candidateSha256: compilation.plan.candidateSha256,
        planSha256: compilation.plan.planSha256,
        sourceClosureSha256: record.sourceClosureSha256,
        replayWrites: 0,
        agents: 0,
        candidate: build.candidate,
      } as const
    })
  }

  async #compileRetainedPlan(
    workspace: Workspace,
    record: PlanRecord,
    signal?: AbortSignal
  )
  {
    const files: WorkspaceSourceFileV2[] = []
    for (const source of record.sources)
    {
      assertAuthoringActiveV1(signal)
      const bytes = await workspace.retention.read(source.artifact)
      files.push({
        path: source.logicalPath,
        bytes,
      })
    }
    const preparedAssets: WorkspacePreparedAssetV2[] = []
    for (const prepared of record.preparedAssets)
    {
      assertAuthoringActiveV1(signal)
      preparedAssets.push({
        ...prepared.asset,
        bytes: await workspace.retention.read(prepared.artifact),
      } as WorkspacePreparedAssetV2)
    }
    assertAuthoringActiveV1(signal)
    return this.#compile(
      {
        manifest: record.manifest,
        files,
        baselineBytes: await workspace.retention.read(record.baseline),
        preparedAssets,
        compilerIdentitySha256: record.tools.compilerIdentitySha256,
        preprocessingCosts: record.preprocessingCosts,
        limits: compilationLimits(this.permissions),
      },
      signal
    )
  }

  async #workspace(workspaceId: string, writable = false): Promise<Workspace>
  {
    checkId(workspaceId, 'authoring')
    const cached = this.#workspaces.get(workspaceId)
    if (writable && cached?.writable) return cached
    const reader = await AuthoringRetentionV1.resume(
      workspaceId,
      join(this.permissions.evidenceRoot, workspaceId),
      false
    )
    const bytes = await reader.store.readImmutable('workspace.json')
    const state = this.#parseState(workspaceId, bytes)
    if (
      writable &&
      (state.schemaVersion !== 2 ||
        ![
          AUTHORING_PUBLICATION_POLICY_SHA256_V2,
          AUTHORING_PUBLICATION_POLICY_SHA256_V3,
        ].includes(state.publicationPolicySha256))
    )
      return fail(
        'authoring.legacy_read_only',
        'legacy workspace history is available for read-only inspection'
      )
    const retention = writable
      ? await AuthoringRetentionV1.resume(workspaceId, reader.root, true)
      : reader
    const workspace = {
      retention,
      state,
      stateSha256: authoringBytesSha256V1(bytes),
      busy: false,
      writable,
    }
    if (writable) this.#workspaces.set(workspaceId, workspace)
    return workspace
  }

  #parseState(workspaceId: string, bytes: Uint8Array): State
  {
    const state = authoringParseJsonV1(bytes) as State
    if (
      (state.schemaVersion !== 1 && state.schemaVersion !== 2) ||
      state.workspaceId !== workspaceId ||
      state.permissionsSha256 !== this.#permissionsSha256 ||
      typeof state.closed !== 'boolean' ||
      typeof state.manifestPath !== 'string' ||
      !Array.isArray(state.plans) ||
      !Array.isArray(state.builds) ||
      !Array.isArray(state.evaluations) ||
      !Array.isArray(state.exports) ||
      !Array.isArray(state.artifacts) ||
      state.artifacts.length > this.permissions.limits.maxRetainedArtifacts ||
      (state.schemaVersion === 2 &&
        (typeof state.publicationPolicySha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(state.publicationPolicySha256) ||
          !Array.isArray(state.publications) ||
          state.publications.length > this.permissions.limits.maxBuilds ||
          (state.pendingPublication !== null &&
            typeof state.pendingPublication !== 'string') ||
          (state.pendingPublication !== null &&
            !state.publications.some(
              (entry) => entry.exportId === state.pendingPublication
            ))))
    )
      return fail(
        'authoring.permissions_changed',
        'retained workspace does not match current operator permissions'
      )
    return state
  }

  async #withOperationLease<T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>
  ): Promise<T>
  {
    assertAuthoringActiveV1(signal)
    if (this.#operationBusy)
      return fail(
        'authoring.workspace_busy',
        'the service still owns an authoring operation'
      )
    this.#operationBusy = true
    try
    {
      return await operation()
    }
    finally
    {
      if (this.#worker.pending)
        void this.#worker.waitForExit().then(() =>
        {
          this.#operationBusy = false
        })
      else this.#operationBusy = false
    }
  }

  async #mutate<T>(
    workspaceId: string,
    signal: AbortSignal | undefined,
    operation: (workspace: WritableWorkspace) => Promise<T>,
    recovery = false,
    allowClosed = false
  ): Promise<T>
  {
    return this.#withOperationLease(signal, async () =>
    {
      const workspace = await this.#workspace(workspaceId, true)
      assertAuthoringActiveV1(signal)
      if (workspace.busy)
        return fail(
          'authoring.workspace_busy',
          'workspace requires sequential lifecycle operations'
        )
      workspace.busy = true
      try
      {
        return await workspace.retention.withRootLease(async () =>
        {
          assertAuthoringActiveV1(signal)
          const bytes =
            await workspace.retention.store.readImmutable('workspace.json')
          const state = this.#parseState(workspaceId, bytes)
          if (
            state.schemaVersion !== 2 ||
            ![
              AUTHORING_PUBLICATION_POLICY_SHA256_V2,
              AUTHORING_PUBLICATION_POLICY_SHA256_V3,
            ].includes(state.publicationPolicySha256)
          )
            return fail(
              'authoring.legacy_read_only',
              'legacy workspace history is available for read-only inspection'
            )
          workspace.state = state
          workspace.stateSha256 = authoringBytesSha256V1(bytes)
          await this.#reconcilePublications(
            workspace as WritableWorkspace,
            signal
          )
          if (state.closed && !recovery && !allowClosed)
            return fail('authoring.workspace_closed', 'workspace is closed')
          if (
            (workspace.state as CurrentState).pendingPublication !== null &&
            !recovery
          )
            return fail(
              'authoring.publication_recovery_required',
              'workspace has a pending publication; reconcile it before another mutation'
            )
          assertAuthoringActiveV1(signal)
          return operation(workspace as WritableWorkspace)
        })
      }
      finally
      {
        workspace.busy = false
      }
    })
  }

  async #save(
    workspace: Workspace,
    state: State,
    signal?: AbortSignal
  ): Promise<void>
  {
    const pointer = await this.#commitState(
      workspace.retention,
      workspace.stateSha256,
      state,
      signal
    )
    workspace.state = state
    workspace.stateSha256 = pointer.sha256
  }

  async #commitState(
    retention: AuthoringRetentionV1,
    expected: string | null,
    state: State,
    signal?: AbortSignal
  )
  {
    assertAuthoringActiveV1(signal)
    const bytes = new TextEncoder().encode(JSON.stringify(state))
    assertAuthoringActiveV1(signal)
    try
    {
      return await retention.store.compareAndSwapPointer(
        'workspace.json',
        expected,
        bytes
      )
    }
    catch (error)
    {
      const reconciliation = await retention.store.reconcilePointer(
        'workspace.json',
        expected,
        bytes
      )
      if (reconciliation.status !== 'new') throw error
      return reconciliation.proposed
    }
  }

  #catalog(
    existing: readonly AuthoringArtifactRefV1[],
    added: readonly AuthoringArtifactRefV1[]
  )
  {
    return [
      ...new Map(
        [...existing, ...added].map((entry) => [entry.key, entry])
      ).values(),
    ]
  }

  #tools(
    targets: readonly WorkspaceRuntimeTargetV2[]
  ): AuthoringToolIdentityV1
  {
    const artifacts = multimodalExecutionArtifactSnapshot()
    if (!executionArtifactSnapshotIsAuthoritative(artifacts))
      return fail(
        'authoring.tool_identity_unavailable',
        artifacts.issue ?? 'compiled toolchain identity unavailable'
      )
    const standardAuthoritySha256 = getStandardAuthoritySha256V2()
    const compilerIdentitySha256 = editCanonicalSha256V1({
      compiler: 'scratch-workspace-v2',
      standardAuthoritySha256,
      executionArtifactsSha256: artifacts.treeSha256,
    })
    const runtimeIdentities = authoringRuntimeIdentitiesV3(targets)
    return {
      semanticAuthorityId: 'standard-v2',
      standardAuthoritySha256,
      compilerIdentitySha256,
      executionArtifactsSha256: artifacts.treeSha256,
      runtimeIdentities,
      runtimeIdentitiesSha256: editCanonicalSha256V1(runtimeIdentities),
    }
  }

  #checkTools(
    expected: AuthoringToolIdentityV1,
    targets: readonly WorkspaceRuntimeTargetV2[]
  ): void
  {
    if (
      editCanonicalSha256V1(this.#tools(targets)) !==
      editCanonicalSha256V1(expected)
    )
      fail(
        'authoring.tools_changed',
        'compiler, authority or execution runtime changed since planning'
      )
  }

  async #checkSources(
    sources: readonly AuthoringSourceSnapshotV1[],
    signal?: AbortSignal
  ): Promise<void>
  {
    for (const source of sources)
    {
      assertAuthoringActiveV1(signal)
      try
      {
        const current = await authoringReadSourceV1(
          source.selectedPath,
          this.permissions.sourceRoots,
          this.permissions.evidenceRoot,
          this.permissions.limits.maxSourceFileBytes
        )
        if (
          current.canonicalPath !== source.canonicalPath ||
          current.sha256 !== source.sha256 ||
          current.bytes.byteLength !== source.byteLength
        )
          fail(
            'authoring.sources_changed',
            `planned source changed: ${source.logicalPath}`
          )
      }
      catch (cause)
      {
        assertAuthoringActiveV1(signal)
        throw new AuthoringWorkspaceErrorV1(
          'authoring.sources_changed',
          `planned source is no longer exact: ${source.logicalPath}`,
          { cause }
        )
      }
    }
    assertAuthoringActiveV1(signal)
  }

  async #guardPlan(
    plan: PlanRecord,
    requireLiveSources = true,
    signal?: AbortSignal
  ): Promise<void>
  {
    assertAuthoringActiveV1(signal)
    this.#checkPlanIdentity(plan)
    if (requireLiveSources) await this.#checkSources(plan.sources, signal)
    await this.#checkAudioDecoders(
      plan.preparedAssets.map((prepared) => prepared.asset),
      signal
    )
    this.#checkTools(plan.tools, plan.plan.runtimeTargets)
    assertAuthoringActiveV1(signal)
  }

  #checkPlanIdentity(plan: PlanRecord): void
  {
    const { contractSha256, ...contractContent } = plan.contract
    if (
      plan.contract.permissionsSha256 !== this.#permissionsSha256 ||
      editCanonicalSha256V1(contractContent) !== contractSha256 ||
      plan.contract.sourceClosureSha256 !== plan.sourceClosureSha256 ||
      editCanonicalSha256V1({
        sources: plan.sources,
        baselineArtifactSha256: plan.baseline.sha256,
      }) !== plan.sourceClosureSha256 ||
      editCanonicalSha256V1(plan.tools) !==
        editCanonicalSha256V1(plan.contract.tools) ||
      editCanonicalSha256V1(plan.tools.runtimeIdentities) !==
        plan.tools.runtimeIdentitiesSha256
    )
      fail(
        'authoring.plan_changed',
        'retained whole-build authorization no longer matches its exact plan'
      )
  }

  async #checkAudioDecoders(
    assets: readonly PreparedAssetEvidence[],
    signal?: AbortSignal
  ): Promise<void>
  {
    const checked = new Set<string>()
    for (const asset of assets)
    {
      assertAuthoringActiveV1(signal)
      if (
        asset.kind !== 'sound' ||
        asset.metadata.decoder.kind !== 'configured-ffmpeg-v1'
      )
        continue
      const decoder = asset.metadata.decoder
      if (
        !decoder.executablePath ||
        !decoder.executableSha256 ||
        !this.permissions.ffmpeg
      )
        return fail(
          'authoring.tools_changed',
          'configured audio decoder identity is unavailable'
        )
      if (checked.has(decoder.executableSha256)) continue
      const current = await authoringReadEvidenceV1(
        this.permissions.ffmpeg.executablePath,
        dirname(decoder.executablePath),
        this.permissions.audioLimits.maxDecoderExecutableBytes
      )
      if (
        current.canonicalPath !== decoder.executablePath ||
        current.sha256 !== decoder.executableSha256
      )
        return fail(
          'authoring.tools_changed',
          'configured audio decoder changed since preparation'
        )
      checked.add(decoder.executableSha256)
    }
    assertAuthoringActiveV1(signal)
  }

  #planRef(workspace: Workspace, planId: string): AuthoringArtifactRefV1
  {
    checkId(planId, 'plan')
    const plan = workspace.state.plans.find((entry) => entry.planId === planId)
    if (!plan)
      return fail(
        'authoring.plan_unavailable',
        'plan is not retained in this workspace'
      )
    return plan.artifact
  }

  async #buildAndPlan(
    workspace: Workspace,
    buildId: string,
    signal?: AbortSignal
  )
  {
    assertAuthoringActiveV1(signal)
    checkId(buildId, 'build')
    const entry = workspace.state.builds.find(
      (build) => build.buildId === buildId
    )
    if (!entry)
      return fail(
        'authoring.build_unavailable',
        'build is not retained in this workspace'
      )
    const build = await workspace.retention.readJson<BuildRecord>(
      entry.artifact
    )
    assertAuthoringActiveV1(signal)
    const plan = await workspace.retention.readJson<PlanRecord>(
      build.planRecord
    )
    assertAuthoringActiveV1(signal)
    if (
      build.workspaceId !== workspace.state.workspaceId ||
      build.buildId !== buildId ||
      build.contractSha256 !== plan.contract.contractSha256 ||
      build.candidate.sha256 !== plan.contract.expectedCandidateSha256
    )
      return fail(
        'authoring.build_changed',
        'retained build no longer matches its whole-build contract'
      )
    return { build, plan }
  }

  #evaluationRequest(
    plan: PlanRecord,
    candidateBytes: Uint8Array
  ): AuthoringCandidateEvaluationRequestV3 & {
    runtimeIdentities: readonly AuthoringRuntimeIdentityV3[]
  }
  {
    const runtimeIdentities = plan.tools.runtimeIdentities
    if (
      !runtimeIdentities.every(
        (value): value is AuthoringRuntimeIdentityV3 =>
          'browserInstallationIdentity' in value &&
          (value.browserInstallationIdentity === null ||
            typeof value.browserInstallationIdentity === 'string')
      )
    )
      return fail(
        'authoring.tools_changed',
        'new work requires a plan with recorded v3 browser installation identities'
      )
    return {
      ...this.#recordedEvaluationRequest(plan, candidateBytes),
      runtimeIdentities,
    }
  }

  #recordedEvaluationRequest(
    plan: PlanRecord,
    candidateBytes: Uint8Array
  ): AuthoringCandidateEvaluationRequestV2 & {
    runtimeIdentities: AuthoringToolIdentityV1['runtimeIdentities']
  }
  {
    return {
      candidateBytes,
      candidateSha256: plan.contract.expectedCandidateSha256,
      standardAuthoritySha256: plan.tools.standardAuthoritySha256,
      compilerIdentitySha256: plan.tools.compilerIdentitySha256,
      runtimeTargets: plan.plan.runtimeTargets,
      runtimeIdentities: plan.tools.runtimeIdentities,
      scenarios: plan.plan.scenarios,
      assertions: plan.plan.assertions,
    }
  }

  async #closure(workspace: Workspace, signal?: AbortSignal)
  {
    const sources: AuthoringSourceSnapshotV1[] = []
    const files: WorkspaceSourceFileV2[] = []
    const seen = new Map<string, WorkspaceSourceFileV2>()
    const base = dirname(workspace.state.manifestPath)
    let totalBytes = 0
    const read = async (
      logicalPath: string,
      role: AuthoringSourceSnapshotV1['role'],
      expectedSha256?: string
    ) =>
    {
      assertAuthoringActiveV1(signal)
      const prior = seen.get(logicalPath)
      if (prior)
      {
        if (
          expectedSha256 !== undefined &&
          authoringBytesSha256V1(prior.bytes) !== expectedSha256
        )
          return fail(
            'authoring.source_digest_mismatch',
            'shared source expected hashes disagree'
          )
        return prior
      }
      if (files.length >= this.permissions.limits.maxSourceFiles)
        return fail(
          'authoring.source_budget_exceeded',
          'source file count exceeds host limit'
        )
      const selectedPath = resolve(base, logicalPath)
      const maximum = Math.min(
        this.permissions.limits.maxSourceFileBytes,
        this.permissions.limits.maxTotalSourceBytes - totalBytes,
        role === 'workspace' || role === 'json'
          ? this.permissions.limits.maxSourceJsonBytes
          : role === 'asset'
            ? this.permissions.archiveLimits.maxAssetBytes
            : this.permissions.archiveLimits.maxCompressedBytes
      )
      const source = await authoringReadSourceV1(
        selectedPath,
        this.permissions.sourceRoots,
        this.permissions.evidenceRoot,
        maximum
      )
      assertAuthoringActiveV1(signal)
      totalBytes += source.bytes.byteLength
      if (
        !Number.isSafeInteger(totalBytes) ||
        totalBytes > this.permissions.limits.maxTotalSourceBytes
      )
        return fail(
          'authoring.source_budget_exceeded',
          'source closure exceeds cumulative host byte limit'
        )
      if (expectedSha256 !== undefined && source.sha256 !== expectedSha256)
        return fail(
          'authoring.source_digest_mismatch',
          `source differs from pinned hash: ${logicalPath}`
        )
      const file: WorkspaceSourceFileV2 = {
        path: logicalPath,
        bytes: source.bytes,
        ...(role === 'workspace' || role === 'json'
          ? { parsedJSON: authoringParseJsonV1(source.bytes) }
          : {}),
      }
      const artifact = await workspace.retention.retain(
        `sources/${source.sha256}.bin`,
        source.bytes,
        role === 'workspace' || role === 'json'
          ? 'application/json'
          : 'application/octet-stream'
      )
      assertAuthoringActiveV1(signal)
      sources.push({
        logicalPath,
        selectedPath,
        canonicalPath: source.canonicalPath,
        sha256: source.sha256,
        byteLength: source.bytes.byteLength,
        role,
        artifact,
      })
      files.push(file)
      seen.set(logicalPath, file)
      return file
    }
    const manifestFile = await read(
      basename(workspace.state.manifestPath),
      'workspace'
    )
    const manifest = parseScratchWorkspaceManifestV2(manifestFile.parsedJSON)
    for (const path of [
      ...(manifest.assetManifestPaths ?? []),
      ...(manifest.clipManifestPaths ?? []),
    ])
      await read(path, 'json')
    const expanded = expandScratchWorkspaceManifestV2(manifest, files)
    if (manifest.baseline.kind === 'selectedProject')
      await read(
        manifest.baseline.path,
        'baseline',
        manifest.baseline.expectedArtifactSha256
      )
    for (const target of expanded.targets)
      for (const logic of [
        ...(target.procedures ?? []),
        ...(target.scripts ?? []),
      ])
        await read(logic.path, 'json')
    for (const asset of expanded.assets ?? [])
      await read(asset.source.path, 'asset', asset.source.expectedSha256)
    assertAuthoringActiveV1(signal)
    sources.sort((a, b) => a.logicalPath.localeCompare(b.logicalPath))
    files.sort((a, b) => a.path.localeCompare(b.path))
    return { manifest, expanded, sources, files }
  }

  async #compile(input: WorkspaceCompilationInputV2, signal?: AbortSignal)
  {
    assertAuthoringActiveV1(signal)
    const metadataBytes = this.permissions.limits.maxSourceJsonBytes * 2
    const parent = workspaceWorkerBytesV1(input, metadataBytes)
    return this.#worker.run(
      {
        kind: 'compile',
        input: {
          ...input,
          files: input.files.map(({ path, bytes }) => ({ path, bytes })),
        },
        archiveLimits: this.permissions.archiveLimits,
        editLimits: this.permissions.editLimits,
      },
      {
        maximumBytes: this.permissions.limits.maxRetainedBytes,
        parentBytes: parent.payloadBytes + 2 * parent.metadataBytes,
        outputBytes: this.permissions.archiveLimits.maxCompressedBytes,
        decodedBytes:
          this.permissions.preprocessingLimits.maxDecodedWorkingBytes +
          2 * this.permissions.archiveLimits.maxTotalAssetBytes,
        metadataBytes,
      },
      signal
    )
  }

  async #prepareAssets(
    workspace: Workspace,
    manifest: ScratchWorkspaceManifestV2,
    files: readonly WorkspaceSourceFileV2[],
    signal?: AbortSignal
  )
  {
    const assets: WorkspacePreparedAssetV2[] = []
    const definitions = manifest.assets ?? []
    const metadataBytes = this.permissions.limits.maxSourceJsonBytes * 2
    const sourceSize = workspaceWorkerBytesV1(
      { manifest, files },
      metadataBytes
    )
    const audioLimits = {
      ...this.permissions.audioLimits,
      maxWorkingBytes: Math.min(
        this.permissions.audioLimits.maxWorkingBytes,
        this.permissions.preprocessingLimits.maxDecodedWorkingBytes
      ),
    }
    let pixelVisits = 0
    let peakDecodedBytes = 0
    let outputBytes = 0
    let offset = 0
    const add = (asset: WorkspacePreparedAssetV2) =>
    {
      outputBytes += asset.bytes.byteLength
      if (outputBytes > this.permissions.archiveLimits.maxTotalAssetBytes)
        return fail(
          'authoring.asset_budget_exceeded',
          'all prepared payloads exceed the aggregate asset budget'
        )
      assets.push(asset)
    }
    while (offset < definitions.length)
    {
      assertAuthoringActiveV1(signal)
      if (workspace.state.closed)
        return fail(
          'authoring.workspace_closed',
          'workspace closed during preparation'
        )
      const preparedSize = workspaceWorkerBytesV1(assets, metadataBytes)
      const remainingOutput =
        this.permissions.archiveLimits.maxTotalAssetBytes - outputBytes
      const parentBytes =
        sourceSize.payloadBytes +
        preparedSize.payloadBytes +
        2 * (sourceSize.metadataBytes + preparedSize.metadataBytes)
      const prepared = await this.#worker.run(
        {
          kind: 'prepare',
          input: {
            assets: definitions.slice(offset).map((asset) => ({
              asset: {
                ...asset,
                source: {
                  path: 'snapshot',
                  expectedSha256: asset.source.expectedSha256,
                },
              },
              bytes: files.find((file) => file.path === asset.source.path)!
                .bytes,
            })),
            preprocessingLimits: {
              ...this.permissions.preprocessingLimits,
              maxPixelVisits:
                this.permissions.preprocessingLimits.maxPixelVisits -
                pixelVisits,
            },
            audioLimits,
            maximumOutputBytes: remainingOutput,
          },
        },
        {
          maximumBytes: this.permissions.limits.maxRetainedBytes,
          parentBytes,
          outputBytes: remainingOutput,
          decodedBytes:
            this.permissions.preprocessingLimits.maxDecodedWorkingBytes,
          metadataBytes,
        },
        signal
      )
      assertAuthoringActiveV1(signal)
      for (const asset of prepared.assets) add(asset)
      pixelVisits += prepared.costs.pixelVisits
      peakDecodedBytes = Math.max(
        peakDecodedBytes,
        prepared.costs.peakDecodedBytes
      )
      offset += prepared.consumed
      if (prepared.nextAudio === null) break
      const asset = definitions[offset]!
      if (asset.kind !== 'sound')
        return fail(
          'authoring.worker_failed',
          'pure preparation stopped outside a sound asset'
        )
      const estimate = prepared.nextAudio
      const audioParent = workspaceWorkerBytesV1(
        { manifest, files, assets },
        metadataBytes
      )
      if (
        outputBytes + estimate.outputByteBound >
          this.permissions.archiveLimits.maxTotalAssetBytes ||
        audioParent.payloadBytes +
          2 * audioParent.metadataBytes +
          estimate.workingByteBound >
          this.permissions.limits.maxRetainedBytes
      )
        return fail(
          'authoring.worker_budget_exceeded',
          'parent audio preparation exceeds its reserved workspace byte budget'
        )
      assertAuthoringActiveV1(signal)
      const bytes = files.find((file) => file.path === asset.source.path)!.bytes
      let normalized
      try
      {
        normalized = await normalizeAudioV1(
          bytes,
          {
            format: asset.format,
            sampleRate: asset.sampleRate,
            channels: asset.channels,
            ffmpeg: this.permissions.ffmpeg ?? undefined,
            limits: audioLimits,
          },
          { signal }
        )
      }
      catch (error)
      {
        assertAuthoringActiveV1(signal)
        throw error
      }
      assertAuthoringActiveV1(signal)
      peakDecodedBytes = Math.max(peakDecodedBytes, estimate.workingByteBound)
      add({
        logicalAssetId: asset.id,
        kind: 'sound',
        bytes: normalized.bytes,
        sourceSha256: normalized.sourceSha256,
        transformSha256: normalized.transformationSha256,
        outputSha256: normalized.outputSha256,
        metadata: {
          identity: normalized.identity,
          settings: normalized.settings,
          decoder: normalized.decoder,
        },
      })
      offset++
    }
    return { assets, costs: { pixelVisits, peakDecodedBytes } }
  }

  async #retainPreparedAssets(
    workspace: Workspace,
    assets: readonly WorkspacePreparedAssetV2[],
    signal?: AbortSignal
  )
  {
    const retained: PreparedAssetRecord[] = []
    for (const asset of assets)
    {
      assertAuthoringActiveV1(signal)
      const { bytes, ...evidence } = asset
      const artifact = await workspace.retention.retain(
        `assets/${asset.outputSha256}.${asset.kind === 'costume' ? 'png' : 'wav'}`,
        bytes,
        asset.kind === 'costume' ? 'image/png' : 'audio/wav'
      )
      retained.push({ asset: evidence, artifact })
    }
    assertAuthoringActiveV1(signal)
    return retained
  }
}
