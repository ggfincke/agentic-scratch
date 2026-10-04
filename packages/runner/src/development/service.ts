// packages/runner/src/development/service.ts
// share strict bounded playtest lifecycle across cli & mcp transports

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import { scanStrictJson } from '@scratch-agent/sb3'
import {
  resolveRuntimeExecutionProfileV1,
  validateRuntimeExecutionProfileV1,
  type RuntimeExecutionProfileV1,
} from './execution-profile.js'
import { openProfileBrowserEngineV1 } from './profile-browser-engine.js'
import {
  DEVELOPMENT_INPUT_POLICY_V1,
  DEVELOPMENT_INPUT_POLICY_V2,
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
  countDevelopmentInputEventsV1,
  isDevelopmentReleaseSourceV1,
} from './input-policy.js'
import {
  createDevelopmentViewerV1,
  prepareDevelopmentClipPreviewV1,
  type DevelopmentViewRequestV1,
  type DevelopmentClipPreviewV1,
  type DevelopmentViewerMediaV1,
} from './viewer.js'
import type { ProfileStateProbeV1 } from './profile-browser-types.js'
import {
  SelectedStateProbeValidationErrorV1,
  validateSelectedStateProbeV1,
} from './selected-state.js'
import {
  DevelopmentRetentionV1,
  DEVELOPMENT_STATUS_BYTES_V2,
  developmentDirectoryV1,
  developmentJsonBytesV1,
  developmentReadSourceV1,
  developmentSha256V1,
  developmentWithinRootV1,
  developmentTerminalReserveBytesV2,
} from './retention.js'
import {
  DevelopmentSessionV1,
  type DevelopmentEngineFactoryV1,
  type DevelopmentStatusV1,
} from './session.js'
import {
  DEVELOPMENT_LIMITS_V1,
  DevelopmentErrorV1,
  type DevelopmentBeginRequestV1,
  type DevelopmentCollectionV1,
  type DevelopmentCommandV1,
  type DevelopmentLimitsV1,
  type DevelopmentOperatorPermissionsV1,
  type DevelopmentTrace,
  type DevelopmentInputRecordV1,
  type DevelopmentInputRecordV2,
  type DevelopmentFrameRecordV1,
  type DevelopmentFrameRecordV2,
  type DevelopmentCommandRecordV1,
  type DevelopmentSegmentV1,
  type DevelopmentMarkV1,
  type DevelopmentMarkV2,
  type DevelopmentArtifactRefV1,
  type DevelopmentSoundRecordV1,
  type DevelopmentPerformanceRecordV1,
} from './types.js'

export * from './types.js'
export * from './viewer-types.js'
export type {
  DevelopmentEngineFactoryV1,
  DevelopmentStatusV1,
} from './session.js'

export interface DevelopmentServiceOptionsV1
{
  readonly permissions: DevelopmentOperatorPermissionsV1
  readonly engineFactory?: DevelopmentEngineFactoryV1
}

export interface DevelopmentInspectRequestV1<
  C extends DevelopmentCollectionV1 = DevelopmentCollectionV1,
>
{
  readonly sessionId: string
  readonly collection?: C
  readonly cursor?: string
  readonly limit?: number
}

export interface DevelopmentCollectionItemsV1
{
  status: DevelopmentStatusV1
  events:
    DevelopmentCommandRecordV1 | (DevelopmentInputRecordV1 & { kind: 'input' })
  inputs: DevelopmentInputRecordV1
  segments: DevelopmentSegmentV1
  marks: DevelopmentMarkV1
  state: DevelopmentFrameRecordV1
  artifacts: DevelopmentArtifactRefV1
  trace: DevelopmentArtifactRefV1
  sounds: DevelopmentSoundRecordV1
  diagnostics: DevelopmentPerformanceRecordV1
}

export interface DevelopmentInspectionV1<
  C extends DevelopmentCollectionV1 = DevelopmentCollectionV1,
>
{
  readonly sessionId: string
  readonly collection: C
  readonly items: readonly DevelopmentCollectionItemsV1[C][]
  readonly nextCursor: string | null
}

interface RetainedSessionV1
{
  readonly retention: DevelopmentRetentionV1
  readonly lifecycleSha256: string
  readonly summary: DevelopmentStatusV1
  readonly trace: DevelopmentTrace
}

interface RetainedLifecycleV1
{
  readonly final: DevelopmentArtifactRefV1 | null
  readonly finalTrace: DevelopmentArtifactRefV1 | null
  readonly checkpoints: readonly DevelopmentArtifactRefV1[]
  readonly sha256: string
}

export class DevelopmentServiceV1
{
  private readonly sessions = new Map<string, DevelopmentSessionV1>()
  private readonly retained = new Map<string, RetainedSessionV1>()
  private opening = 0

  constructor(
    readonly permissions: {
      readonly sourceRoots: readonly string[]
      readonly evidenceRoot: string
      readonly limits: DevelopmentLimitsV1
      readonly profiles: readonly RuntimeExecutionProfileV1[] | null
    },
    private readonly engineFactory: DevelopmentEngineFactoryV1
  )
  {}

  async begin(
    request: DevelopmentBeginRequestV1
  ): Promise<DevelopmentStatusV1>
  {
    validateBeginRequest(request)
    assertNotCancelled(request.signal)
    for (const [id, session] of this.sessions)
      if (session.traceArtifact) this.sessions.delete(id)
    const active = [...this.sessions.values()].filter(
      (session) => !session.traceArtifact
    ).length
    if (active + this.opening >= this.permissions.limits.maxSessions)
      throw new DevelopmentErrorV1(
        'development.session_budget_exceeded',
        'operator live-session budget exhausted'
      )
    const inputMode = request.inputMode ?? (request.visible ? 'human' : 'agent')
    let profile = request.profile
      ? validateRuntimeExecutionProfileV1(request.profile)
      : resolveRuntimeExecutionProfileV1(
          request.preset === 'official30'
            ? 'scratch-30'
            : request.preset === 'turboWarp60'
              ? 'turbowarp-60'
              : undefined
        )
    if (request.preset && inputMode === 'human')
      profile = validateRuntimeExecutionProfileV1({
        ...profile,
        scheduler: 'natural',
      })
    if (
      this.permissions.profiles &&
      !this.permissions.profiles.some((allowed) =>
        profileEqual(allowed, profile)
      )
    )
      throw new DevelopmentErrorV1(
        'development.profile_not_allowed',
        'requested execution profile is outside operator permissions'
      )
    this.opening += 1
    try
    {
      const source = await developmentReadSourceV1(
        request.sourcePath,
        this.permissions.sourceRoots,
        this.permissions.evidenceRoot,
        this.permissions.limits.maxSourceBytes
      )
      assertNotCancelled(request.signal)
      if (
        request.expectedSourceSha256 &&
        request.expectedSourceSha256 !== source.sha256
      )
        throw new DevelopmentErrorV1(
          'development.source_mismatch',
          'selected source differs from expectedSourceSha256'
        )
      if (
        this.permissions.limits.maxRetainedArtifacts < 5 ||
        source.bytes.byteLength +
          developmentTerminalReserveBytesV2(
            this.permissions.limits.maxTraceBytes
          ) +
          DEVELOPMENT_STATUS_BYTES_V2 >
          this.permissions.limits.maxRetainedBytes
      )
        throw new DevelopmentErrorV1(
          'development.retention_budget_exceeded',
          `retention requires source bytes, three terminal slots reserving ${developmentTerminalReserveBytesV2(this.permissions.limits.maxTraceBytes)} bytes, and separate ${DEVELOPMENT_STATUS_BYTES_V2}-byte startup checkpoint headroom; allow at least five artifacts and increase retained capacity or lower maxTraceBytes`
        )
      const sessionId = randomUUID()
      const retention = await DevelopmentRetentionV1.create(
        sessionId,
        this.permissions.evidenceRoot,
        this.permissions.limits
      )
      const artifact = await retention.retain(
        'source.sb3',
        source.bytes,
        'application/x.scratch.sb3'
      )
      const session = new DevelopmentSessionV1({
        sessionId,
        request: {
          ...request,
          profile,
          ...(request.probe ? { probe: detached(request.probe) } : {}),
        },
        sourceSha256: source.sha256,
        source: artifact,
        sourceRoots: this.permissions.sourceRoots,
        evidenceRoot: this.permissions.evidenceRoot,
        profile,
        inputMode,
        limits: this.permissions.limits,
        retention,
        engineFactory: this.engineFactory,
      })
      this.sessions.set(sessionId, session)
      return await session.open()
    }
    finally
    {
      this.opening -= 1
    }
  }

  async command(request: {
    readonly sessionId: string
    readonly command: DevelopmentCommandV1
  }): Promise<DevelopmentStatusV1 & { readonly markId?: string }>
  {
    assertObject(request, ['sessionId', 'command'])
    const command = validateCommand(request.command)
    const session = this.sessions.get(request.sessionId)
    if (!session)
      throw new DevelopmentErrorV1(
        'development.runtime_unavailable',
        'live runtime belongs to its original service process; retained evidence remains inspectable'
      )
    return session.run(command)
  }

  async inspect<C extends DevelopmentCollectionV1 = 'status'>(
    request: DevelopmentInspectRequestV1<C>
  ): Promise<DevelopmentInspectionV1<C>>
  {
    assertObject(request, ['sessionId', 'collection', 'cursor', 'limit'])
    const collection = request.collection ?? 'status'
    if (
      ![
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
      ].includes(collection)
    )
      throw new DevelopmentErrorV1(
        'development.invalid_collection',
        'unknown development inspection collection'
      )
    const limit = request.limit ?? 32
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > this.permissions.limits.maxInspectionPageSize
    )
      throw new DevelopmentErrorV1(
        'development.invalid_page',
        'inspection page size exceeds the operator limit'
      )
    const live = this.sessions.get(request.sessionId)
    const retained = live ? null : await this.loadRetained(request.sessionId)
    const summary = live ? await live.inspect() : retained!.summary
    const trace = live ? live.trace() : retained!.trace
    const retention = live?.options.retention ?? retained!.retention
    if (live) await retention.refresh()
    const lifecycleSha256 =
      retained?.lifecycleSha256 ?? retainedLifecycle(retention.artifacts).sha256
    let items: readonly unknown[]
    if (collection === 'status') items = [summary]
    else if (collection === 'trace')
      items = summary.trace ? [summary.trace] : []
    else if (collection === 'artifacts') items = retention.artifacts
    else if (collection === 'inputs') items = trace.inputs
    else if (collection === 'segments') items = trace.segments
    else if (collection === 'marks') items = trace.marks
    else if (collection === 'state') items = trace.frames
    else if (collection === 'sounds') items = trace.sounds ?? []
    else if (collection === 'diagnostics') items = trace.diagnostics ?? []
    else
      items = [
        ...trace.commands,
        ...trace.inputs.map((input) => ({ kind: 'input', ...input })),
      ].sort((left, right) => left.order - right.order)
    const identity = developmentSha256V1(
      developmentJsonBytesV1({
        sessionId: request.sessionId,
        collection,
        lifecycleSha256,
        length: items.length,
        last: items.at(-1) ?? null,
      })
    )
    const offset = decodeCursor(request.cursor, identity)
    if (offset > items.length)
      throw new DevelopmentErrorV1(
        'development.invalid_cursor',
        'inspection cursor exceeds retained collection'
      )
    return {
      sessionId: request.sessionId,
      collection: collection as C,
      items: detached(
        items.slice(offset, offset + limit)
      ) as DevelopmentCollectionItemsV1[C][],
      nextCursor:
        offset + limit < items.length ? `${identity}:${offset + limit}` : null,
    }
  }

  async close(request: {
    readonly sessionId: string
  }): Promise<DevelopmentStatusV1>
  {
    assertObject(request, ['sessionId'])
    const live = this.sessions.get(request.sessionId)
    if (!live) return (await this.loadRetained(request.sessionId)).summary
    const summary = await live.close()
    this.sessions.delete(request.sessionId)
    return summary
  }

  async retainedTrace(request: { readonly sessionId: string }): Promise<{
    readonly status: DevelopmentStatusV1
    readonly trace: DevelopmentTrace
    readonly sourceBytes: Uint8Array
  }>
  {
    assertObject(request, ['sessionId'])
    const live = this.sessions.get(request.sessionId)
    const retained = live ? null : await this.loadRetained(request.sessionId)
    const status = live ? await live.inspect() : retained!.summary
    const trace = live ? live.trace() : retained!.trace
    const retention = live?.options.retention ?? retained!.retention
    const sourceBytes = await retention.read(status.source.key)
    if (
      developmentSha256V1(sourceBytes) !== status.sourceSha256 ||
      trace.sourceSha256 !== status.sourceSha256
    )
      throw new DevelopmentErrorV1(
        'development.evidence_mismatch',
        'retained source bytes do not match the development trace'
      )
    return {
      status: detached(status),
      trace: detached(trace),
      sourceBytes,
    }
  }

  async selectArtifactSnapshot(request: {
    readonly sessionId: string
    readonly key: string
  })
  {
    assertObject(request, ['sessionId', 'key'])
    const live = this.sessions.get(request.sessionId)
    const retention =
      live?.options.retention ??
      (await this.loadRetained(request.sessionId)).retention
    if (live) await retention.refresh()
    const artifact = retention.artifacts.find(
      (entry) => entry.key === request.key
    )
    if (!artifact)
      throw new DevelopmentErrorV1(
        'development.artifact_unavailable',
        'artifact is not retained by this session'
      )
    return {
      artifact,
      load: () => retention.readSnapshotBytes(artifact),
    }
  }

  async readArtifact(request: {
    readonly sessionId: string
    readonly key: string
    readonly offset?: number
    readonly maxBytes?: number
  }): Promise<{
    readonly sessionId: string
    readonly key: string
    readonly sha256: string
    readonly byteLength: number
    readonly mimeType: string
    readonly offset: number
    readonly bytes: Uint8Array
    readonly nextOffset: number | null
  }>
  {
    assertObject(request, ['sessionId', 'key', 'offset', 'maxBytes'])
    const live = this.sessions.get(request.sessionId)
    const retention =
      live?.options.retention ??
      (await this.loadRetained(request.sessionId)).retention
    if (live) await retention.refresh()
    const ref = retention.artifacts.find(
      (artifact) => artifact.key === request.key
    )
    if (!ref)
      throw new DevelopmentErrorV1(
        'development.artifact_unavailable',
        'artifact is not retained by this session'
      )
    const offset = request.offset ?? 0
    const maxBytes = request.maxBytes ?? 16384
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > ref.byteLength ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > this.permissions.limits.maxArtifactReadBytes
    )
      throw new DevelopmentErrorV1(
        'development.invalid_artifact_range',
        'artifact range exceeds operator bounds'
      )
    const all = await retention.read(ref.key)
    const bytes = all.slice(offset, Math.min(all.byteLength, offset + maxBytes))
    return {
      sessionId: ref.sessionId,
      key: ref.key,
      sha256: ref.sha256,
      byteLength: ref.byteLength,
      mimeType: ref.mimeType,
      offset,
      bytes,
      nextOffset:
        offset + bytes.byteLength < all.byteLength
          ? offset + bytes.byteLength
          : null,
    }
  }

  async retainEvidence(request: {
    readonly sessionId: string
    readonly kind: 'reproduction' | 'frame' | 'audio' | 'clip'
    readonly bytes: Uint8Array
    readonly mimeType:
      'application/json' | 'image/png' | 'audio/wav' | 'audio/webm'
  }): Promise<DevelopmentArtifactRefV1>
  {
    assertObject(request, ['sessionId', 'kind', 'bytes', 'mimeType'])
    if (
      !(request.bytes instanceof Uint8Array) ||
      request.bytes.byteLength > this.permissions.limits.maxEvidenceBytes ||
      !['reproduction', 'frame', 'audio', 'clip'].includes(request.kind) ||
      (request.kind === 'frame' &&
        !['image/png', 'application/json'].includes(request.mimeType)) ||
      (request.kind === 'audio' &&
        !['audio/wav', 'audio/webm'].includes(request.mimeType)) ||
      ((request.kind === 'reproduction' || request.kind === 'clip') &&
        request.mimeType !== 'application/json')
    )
      throw new DevelopmentErrorV1(
        'development.invalid_evidence',
        'evidence kind, bytes or MIME type are unsupported'
      )
    const retention = await this.retentionFor(request.sessionId)
    this.checkEvidenceBudget(retention, request.bytes.byteLength, 1)
    const suffix =
      request.mimeType === 'image/png'
        ? 'png'
        : request.mimeType === 'audio/webm'
          ? 'webm'
          : request.mimeType === 'audio/wav'
            ? 'wav'
            : 'json'
    return retention.retain(
      `${request.kind}-${randomUUID()}.${suffix}`,
      Uint8Array.from(request.bytes),
      request.mimeType
    )
  }

  async recordAudio(request: {
    readonly sessionId: string
    readonly durationMs?: number
    readonly maxBytes?: number
    readonly signal?: AbortSignal
  }): Promise<{
    readonly sessionId: string
    readonly status: 'available' | 'unavailable'
    readonly diagnosticOnly: true
    readonly metadata: DevelopmentArtifactRefV1
    readonly audio: DevelopmentArtifactRefV1 | null
    readonly issue: string | null
  }>
  {
    assertObject(request, ['sessionId', 'durationMs', 'maxBytes', 'signal'])
    if (
      (request.durationMs !== undefined &&
        (!Number.isSafeInteger(request.durationMs) ||
          request.durationMs < 1 ||
          request.durationMs > 10000)) ||
      (request.maxBytes !== undefined &&
        (!Number.isSafeInteger(request.maxBytes) ||
          request.maxBytes < 1 ||
          request.maxBytes > 5 * 1024 * 1024)) ||
      (request.signal !== undefined && !(request.signal instanceof AbortSignal))
    )
      throw new DevelopmentErrorV1(
        'development.invalid_audio_options',
        'output audio permits at most ten seconds & five MiB'
      )
    const session = this.sessions.get(request.sessionId)
    if (!session)
      throw new DevelopmentErrorV1(
        'development.runtime_unavailable',
        'output audio requires the live original browser'
      )
    const clip = await session.recordAudio({
      durationMs: request.durationMs,
      maxBytes: request.maxBytes,
      signal: request.signal,
    })
    assertNotCancelled(request.signal)
    const retention = session.options.retention
    if (
      clip.sourceSha256 !== session.options.sourceSha256 ||
      clip.byteLength > (request.maxBytes ?? 2 * 1024 * 1024) ||
      (clip.bytes &&
        (clip.sha256 !== developmentSha256V1(clip.bytes) ||
          clip.byteLength !== clip.bytes.byteLength))
    )
      throw new DevelopmentErrorV1(
        'development.evidence_mismatch',
        'output audio differs from its exact source or byte identity'
      )
    const id = randomUUID(),
      audioKey = `audio-${id}.webm`,
      metadataKey = `audio-${id}.json`
    const audio = clip.bytes
      ? {
          sessionId: request.sessionId,
          key: audioKey,
          path: `${retention.root}/${audioKey}`,
          sha256: clip.sha256!,
          byteLength: clip.byteLength,
          mimeType: 'audio/webm',
        }
      : null
    const { bytes: _bytes, ...details } = clip
    const metadataBytes = developmentJsonBytesV1({ ...details, audio })
    this.checkEvidenceBudget(
      retention,
      metadataBytes.byteLength + (clip.bytes?.byteLength ?? 0),
      clip.bytes ? 2 : 1
    )
    const refs = await retention.retainBatch([
      ...(clip.bytes
        ? [{ key: audioKey, bytes: clip.bytes, mimeType: 'audio/webm' }]
        : []),
      { key: metadataKey, bytes: metadataBytes, mimeType: 'application/json' },
    ])
    return {
      sessionId: request.sessionId,
      status: clip.status,
      diagnosticOnly: true,
      audio: clip.bytes ? refs[0]! : null,
      metadata: refs.at(-1)!,
      issue: clip.issue,
    }
  }

  async importClip(request: {
    readonly sessionId: string
    readonly sourcePath: string
    readonly expectedSha256?: string
    readonly signal?: AbortSignal
  }): Promise<{
    readonly sessionId: string
    readonly clip: DevelopmentArtifactRefV1
    readonly frames: readonly DevelopmentArtifactRefV1[]
  }>
  {
    assertObject(request, [
      'sessionId',
      'sourcePath',
      'expectedSha256',
      'signal',
    ])
    assertNotCancelled(request.signal)
    const source = await developmentReadSourceV1(
      request.sourcePath,
      this.permissions.sourceRoots,
      this.permissions.evidenceRoot,
      this.permissions.limits.maxClipSourceBytes
    )
    assertNotCancelled(request.signal)
    if (
      request.expectedSha256 !== undefined &&
      request.expectedSha256 !== source.sha256
    )
      throw new DevelopmentErrorV1(
        'development.source_mismatch',
        'clip source differs from expectedSha256'
      )
    const retained = await this.retainedTrace({ sessionId: request.sessionId })
    assertNotCancelled(request.signal)
    const retention = await this.retentionFor(request.sessionId)
    const prepared = await prepareDevelopmentClipPreviewV1({
      sourceBytes: retained.sourceBytes,
      manifestBytes: source.bytes,
      sessionId: request.sessionId,
      root: retention.root,
      limits: this.permissions.limits,
    })
    assertNotCancelled(request.signal)
    const key = `clip-${randomUUID()}.json`,
      bytes = developmentJsonBytesV1(prepared.preview)
    this.checkEvidenceBudget(
      retention,
      bytes.byteLength +
        prepared.entries.reduce(
          (sum, entry) => sum + entry.bytes.byteLength,
          0
        ),
      prepared.entries.length + 1
    )
    const refs = await retention.retainBatch([
      ...prepared.entries,
      { key, bytes, mimeType: 'application/json' },
    ])
    assertNotCancelled(request.signal)
    return {
      sessionId: request.sessionId,
      clip: refs.at(-1)!,
      frames: refs.slice(0, -1),
    }
  }

  async view(request: DevelopmentViewRequestV1): Promise<{
    readonly sessionId: string
    readonly viewer: DevelopmentArtifactRefV1
    readonly model: DevelopmentArtifactRefV1
  }>
  {
    assertObject(request, [
      'sessionId',
      'compareSessionId',
      'overlays',
      'clipArtifactKey',
      'reproductionArtifactKey',
      'signal',
    ])
    assertNotCancelled(request.signal)
    const primary = await this.retainedTrace({ sessionId: request.sessionId })
    assertNotCancelled(request.signal)
    const comparison = request.compareSessionId
      ? await this.retainedTrace({ sessionId: request.compareSessionId })
      : undefined
    const retention = await this.retentionFor(request.sessionId)
    assertNotCancelled(request.signal)
    let clips: DevelopmentClipPreviewV1 | undefined
    let reproduction: unknown
    const media: (DevelopmentViewerMediaV1 & { bytes: Uint8Array })[] = []
    const seen = new Set<string>()
    let mediaBytes = 0
    const append = async (
      ref: DevelopmentArtifactRefV1,
      details: Partial<DevelopmentViewerMediaV1> = {}
    ) =>
    {
      assertNotCancelled(request.signal)
      if (
        ref.sessionId !== request.sessionId ||
        !retention.artifacts.some(
          (item) => item.key === ref.key && item.sha256 === ref.sha256
        )
      )
        throw new DevelopmentErrorV1(
          'development.evidence_mismatch',
          'viewer media reference is outside the exact session catalog'
        )
      if (seen.has(ref.key)) return
      if (media.length >= 512 || mediaBytes + ref.byteLength > 50 * 1024 * 1024)
        throw new DevelopmentErrorV1(
          'development.viewer_budget_exceeded',
          'viewer media exceeds its 512 artifact or 50 MiB encoded byte budget'
        )
      mediaBytes += ref.byteLength
      seen.add(ref.key)
      media.push({
        ...details,
        artifact: ref,
        bytes: await retention.read(ref.key),
      })
      assertNotCancelled(request.signal)
    }
    if (request.clipArtifactKey)
    {
      const artifact = retention.artifacts.find(
        (ref) => ref.key === request.clipArtifactKey
      )
      if (
        !artifact ||
        artifact.mimeType !== 'application/json' ||
        artifact.byteLength > this.permissions.limits.maxClipSourceBytes
      )
        throw new DevelopmentErrorV1(
          'development.invalid_clip',
          'clip preview must be one bounded catalog JSON artifact'
        )
      clips = parseJson(
        await retention.read(artifact.key)
      ) as DevelopmentClipPreviewV1
      if (
        clips.schemaVersion !== 1 ||
        clips.kind !== 'development-clip-preview-v1' ||
        clips.sourceSha256 !== primary.status.sourceSha256 ||
        !Array.isArray(clips.clips)
      )
        throw new DevelopmentErrorV1(
          'development.invalid_clip',
          'clip preview differs from the selected source'
        )
      for (const clip of clips.clips)
        for (const frame of clip.frames) await append(frame.image)
    }
    if (request.reproductionArtifactKey)
    {
      const artifact = retention.artifacts.find(
        (ref) => ref.key === request.reproductionArtifactKey
      )
      if (
        !artifact ||
        artifact.mimeType !== 'application/json' ||
        artifact.byteLength > this.permissions.limits.maxTraceBytes
      )
        throw new DevelopmentErrorV1(
          'development.invalid_reproduction',
          'reproduction must be one bounded catalog JSON artifact'
        )
      reproduction = parseJson(await retention.read(artifact.key))
      const report = reproduction as {
        schemaVersion?: unknown
        kind?: unknown
        sessionId?: unknown
        sourceSha256?: unknown
        frames?: {
          image: DevelopmentArtifactRefV1
          tick: number
          segmentId: string
          state: DevelopmentViewerMediaV1['state']
          geometry: DevelopmentViewerMediaV1['geometry']
        }[]
      }
      if (
        !(
          (report.schemaVersion === 1 &&
            report.kind === 'development-reproduction-v1') ||
          (report.schemaVersion === 2 &&
            report.kind === 'development-reproduction-v2')
        ) ||
        report.sessionId !== request.sessionId ||
        report.sourceSha256 !== primary.status.sourceSha256 ||
        !Array.isArray(report.frames) ||
        report.frames.length > 240
      )
        throw new DevelopmentErrorV1(
          'development.invalid_reproduction',
          'reproduction source identity or frame budget is invalid'
        )
      for (const frame of report.frames)
        await append(frame.image, {
          tick: frame.tick,
          segmentId: frame.segmentId,
          state: frame.state,
          geometry: frame.geometry,
        })
    }
    for (const audio of retention.artifacts.filter((ref) =>
      ref.mimeType.startsWith('audio/')
    ))
      await append(audio)
    const prepared = await createDevelopmentViewerV1({
      primary,
      ...(comparison ? { comparison } : {}),
      overlays: request.overlays,
      ...(clips ? { clips } : {}),
      reproduction,
      media,
      limits: this.permissions.limits,
    })
    assertNotCancelled(request.signal)
    const id = randomUUID()
    const refs = await retention.retainBatch([
      {
        key: `viewer-${id}.json`,
        bytes: prepared.modelBytes,
        mimeType: 'application/json',
      },
      {
        key: `viewer-${id}.html`,
        bytes: prepared.htmlBytes,
        mimeType: 'text/html',
      },
    ])
    assertNotCancelled(request.signal)
    return { sessionId: request.sessionId, model: refs[0]!, viewer: refs[1]! }
  }

  private async retentionFor(
    sessionId: string
  ): Promise<DevelopmentRetentionV1>
  {
    const retention =
      this.sessions.get(sessionId)?.options.retention ??
      (await this.loadRetained(sessionId)).retention
    retention.assertWritable()
    return retention
  }

  private checkEvidenceBudget(
    retention: DevelopmentRetentionV1,
    bytes: number,
    count: number
  ): void
  {
    const evidence = retention.artifacts.filter((ref) =>
      /^(frame|audio|clip|reproduction)-/.test(ref.key)
    )
    if (
      evidence.length + count > this.permissions.limits.maxEvidenceArtifacts ||
      evidence.reduce((sum, ref) => sum + ref.byteLength, 0) + bytes >
        this.permissions.limits.maxEvidenceBytes
    )
      throw new DevelopmentErrorV1(
        'development.evidence_budget_exceeded',
        'media & reproduction artifacts exceed the global session evidence budget'
      )
  }

  private async loadRetained(sessionId: string): Promise<RetainedSessionV1>
  {
    const cached = this.retained.get(sessionId)
    const retention =
      cached?.retention ??
      (await DevelopmentRetentionV1.resume(
        sessionId,
        this.permissions.evidenceRoot,
        this.permissions.limits
      ))
    if (cached) await retention.refresh()
    const lifecycle = retainedLifecycle(retention.artifacts)
    if (cached?.lifecycleSha256 === lifecycle.sha256) return cached
    const { final, finalTrace, checkpoints } = lifecycle
    let summary: DevelopmentStatusV1
    let trace: DevelopmentTrace
    if (final)
    {
      if (finalTrace === null)
        throw new DevelopmentErrorV1(
          'development.artifact_unavailable',
          'artifact is not in this session catalog'
        )
      summary = parseJson(
        await retention.read(final.key)
      ) as DevelopmentStatusV1
      trace = parseJson(
        await retention.read(finalTrace.key)
      ) as DevelopmentTrace
    }
    else
    {
      if (!checkpoints.length)
        throw new DevelopmentErrorV1(
          'development.evidence_incomplete',
          'session has no retained lifecycle checkpoint'
        )
      const deltas = await Promise.all(
        checkpoints.map(
          async (ref) =>
            parseJson(await retention.read(ref.key)) as {
              schemaVersion: 1 | 2
              chronologyPolicy?: typeof DEVELOPMENT_CHRONOLOGY_POLICY_V2
              captureComplete?: boolean
              sessionId: string
              sequence: number
              status: DevelopmentStatusV1
              segments: DevelopmentTrace['segments']
              inputs: DevelopmentTrace['inputs']
              frames: DevelopmentTrace['frames']
              commands: DevelopmentTrace['commands']
              marks: DevelopmentTrace['marks']
              sounds?: DevelopmentTrace['sounds']
              soundCoverage?: DevelopmentTrace['soundCoverage']
              diagnostics?: DevelopmentTrace['diagnostics']
            }
        )
      )
      const last = deltas.at(-1)!
      if (
        deltas.some(
          (delta, sequence) =>
            delta.sessionId !== sessionId ||
            delta.sequence !== sequence ||
            delta.schemaVersion !== last.schemaVersion ||
            ![1, 2].includes(delta.schemaVersion) ||
            (delta.schemaVersion === 2 &&
              (delta.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
                typeof delta.captureComplete !== 'boolean'))
        )
      )
        throw new DevelopmentErrorV1(
          'development.evidence_mismatch',
          'retained lifecycle checkpoints have inconsistent versions or chronology'
        )
      summary = {
        ...last.status,
        status: 'failed',
        issues: [
          ...last.status.issues,
          'live process unavailable; inspection contains its last durable checkpoint',
        ],
      }
      const common = {
        sessionId,
        sourceSha256: summary.sourceSha256,
        profile: summary.profile,
        inputMode: summary.inputMode,
        ...(summary.probe ? { probe: summary.probe } : {}),
        segments: last.segments,
        inputs: deltas.flatMap((delta) => delta.inputs),
        frames: deltas.flatMap((delta) => delta.frames),
        commands: deltas.flatMap((delta) => delta.commands),
        marks: deltas.flatMap((delta) => delta.marks),
        sounds: deltas.flatMap((delta) => delta.sounds ?? []),
        ...(last.soundCoverage ? { soundCoverage: last.soundCoverage } : {}),
        ...(last.diagnostics ? { diagnostics: last.diagnostics } : {}),
        issues: summary.issues,
      }
      if (last.schemaVersion === 2)
      {
        const { inputs, frames, marks } = common
        if (
          !inputs.every(hasV2InputChronology) ||
          !frames.every(hasV2FrameChronology) ||
          !marks.every(hasV2MarkChronology)
        )
          throw new DevelopmentErrorV1(
            'development.evidence_mismatch',
            'retained v2 checkpoint is missing valid capture chronology'
          )
        trace = {
          ...common,
          schemaVersion: 2,
          kind: 'development-trace-v2',
          chronologyPolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
          captureComplete: deltas.every(
            (delta) => delta.captureComplete === true
          ),
          inputs,
          frames,
          marks,
        }
      }
      else
        trace = { ...common, schemaVersion: 1, kind: 'development-trace-v1' }
    }
    if (
      ![1, 2].includes(trace.schemaVersion) ||
      (trace.schemaVersion === 2 &&
        (trace.kind !== 'development-trace-v2' ||
          trace.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
          typeof trace.captureComplete !== 'boolean' ||
          !trace.inputs.every(hasV2InputChronology) ||
          !trace.frames.every(hasV2FrameChronology) ||
          !trace.marks.every(hasV2MarkChronology))) ||
      (trace.schemaVersion === 1 && trace.kind !== 'development-trace-v1') ||
      summary.sessionId !== sessionId ||
      trace.sessionId !== sessionId ||
      summary.sourceSha256 !== trace.sourceSha256 ||
      summary.source.sessionId !== sessionId
    )
      throw new DevelopmentErrorV1(
        'development.evidence_mismatch',
        'retained trace does not match session source identity'
      )
    if (trace.schemaVersion === 1)
      summary = {
        ...summary,
        issues: [
          ...summary.issues,
          'legacy chronology is inspectable as recorded; exact v2 chronology is unavailable',
        ],
      }
    try
    {
      countDevelopmentInputEventsV1(trace.inputs)
      if (
        trace.inputs.some(
          (input) =>
            !Number.isSafeInteger(input.ordinal) ||
            input.ordinal < 1 ||
            input.ordinal > DEVELOPMENT_INPUT_POLICY_V1.maxAppliedOrdinal
        )
      )
        throw new Error('retained input exceeds its finite application ordinal')
    }
    catch (error)
    {
      throw new DevelopmentErrorV1(
        'development.evidence_mismatch',
        error instanceof Error
          ? error.message
          : 'retained input policy is invalid'
      )
    }
    const result = {
      retention,
      lifecycleSha256: lifecycle.sha256,
      summary,
      trace,
    }
    if (this.retained.size >= this.permissions.limits.maxSessions)
      this.retained.delete(this.retained.keys().next().value!)
    this.retained.set(sessionId, result)
    return result
  }
}

// bind one append-only lifecycle selection before any asynchronous evidence reads
function retainedLifecycle(
  artifacts: readonly DevelopmentArtifactRefV1[]
): RetainedLifecycleV1
{
  const final = artifacts.find((ref) => ref.key === 'session.json') ?? null
  const finalTrace = artifacts.find((ref) => ref.key === 'trace.json') ?? null
  const checkpoints = artifacts.filter((ref) =>
    /^checkpoint-\d{6}\.json$/.test(ref.key)
  )
  const sha256 = developmentSha256V1(
    developmentJsonBytesV1(
      final
        ? { kind: 'final', final, trace: finalTrace }
        : { kind: 'checkpoints', checkpoints }
    )
  )
  return { final, finalTrace, checkpoints, sha256 }
}

function assertNotCancelled(signal: AbortSignal | undefined): void
{
  if (signal !== undefined && !(signal instanceof AbortSignal))
    throw new DevelopmentErrorV1(
      'development.invalid_signal',
      'development cancellation requires an AbortSignal'
    )
  if (signal?.aborted)
    throw new DevelopmentErrorV1(
      'development.cancelled',
      'development operation was cancelled'
    )
}

export async function createDevelopmentServiceV1(
  options: DevelopmentServiceOptionsV1
): Promise<DevelopmentServiceV1>
{
  assertObject(options, ['permissions', 'engineFactory'])
  assertObject(options.permissions, [
    'sourceRoots',
    'evidenceRoot',
    'limits',
    'profiles',
  ])
  const permissions = options.permissions
  if (
    !Array.isArray(permissions.sourceRoots) ||
    !permissions.sourceRoots.length ||
    permissions.sourceRoots.length > 32 ||
    typeof permissions.evidenceRoot !== 'string' ||
    !isAbsolute(permissions.evidenceRoot)
  )
    throw new DevelopmentErrorV1(
      'development.invalid_permissions',
      'operator must select source roots & one absolute private evidence root'
    )
  const sourceRoots = await Promise.all(
    permissions.sourceRoots.map(developmentDirectoryV1)
  )
  await mkdir(permissions.evidenceRoot, { recursive: true, mode: 0o700 })
  const evidenceRoot = await developmentDirectoryV1(permissions.evidenceRoot)
  if (sourceRoots.some((root) => developmentWithinRootV1(evidenceRoot, root)))
    throw new DevelopmentErrorV1(
      'development.invalid_permissions',
      'source roots must remain outside private evidence'
    )
  const limits: DevelopmentLimitsV1 = { ...DEVELOPMENT_LIMITS_V1 }
  if (permissions.limits)
  {
    assertObject(permissions.limits, Object.keys(DEVELOPMENT_LIMITS_V1))
    for (const [key, value] of Object.entries(permissions.limits))
    {
      const field = key as keyof DevelopmentLimitsV1
      if (
        !Number.isSafeInteger(value) ||
        value! < 1 ||
        value! > DEVELOPMENT_LIMITS_V1[field]
      )
        throw new DevelopmentErrorV1(
          'development.invalid_permissions',
          `${field} can only lower its finite default cap`
        )
      limits[field] = value!
    }
  }
  let profiles: readonly RuntimeExecutionProfileV1[] | null = null
  if (permissions.profiles !== undefined)
  {
    if (
      !Array.isArray(permissions.profiles) ||
      !permissions.profiles.length ||
      permissions.profiles.length > 8
    )
      throw new DevelopmentErrorV1(
        'development.invalid_permissions',
        'allowed profiles must be a nonempty finite operator list'
      )
    profiles = permissions.profiles.map(validateRuntimeExecutionProfileV1)
  }
  return new DevelopmentServiceV1(
    { sourceRoots, evidenceRoot, limits: Object.freeze(limits), profiles },
    options.engineFactory ?? openProfileBrowserEngineV1
  )
}

function validateBeginRequest(request: DevelopmentBeginRequestV1): void
{
  assertObject(request, [
    'sourcePath',
    'expectedSourceSha256',
    'profile',
    'preset',
    'visible',
    'inputMode',
    'probe',
    'seed',
    'fixedDateMs',
    'signal',
  ])
  if (
    typeof request.sourcePath !== 'string' ||
    request.sourcePath.length > 4096 ||
    !isAbsolute(request.sourcePath) ||
    (request.expectedSourceSha256 !== undefined &&
      !/^[a-f0-9]{64}$/.test(request.expectedSourceSha256)) ||
    (request.visible !== undefined && typeof request.visible !== 'boolean') ||
    (request.inputMode !== undefined &&
      !['agent', 'human'].includes(request.inputMode)) ||
    (request.preset !== undefined &&
      !['official30', 'turboWarp60'].includes(request.preset)) ||
    (request.profile !== undefined && request.preset !== undefined) ||
    (request.seed !== undefined &&
      (!Number.isSafeInteger(request.seed) ||
        request.seed < 0 ||
        request.seed > 0xffffffff)) ||
    (request.fixedDateMs !== undefined &&
      (!Number.isSafeInteger(request.fixedDateMs) ||
        Math.abs(request.fixedDateMs) > 8640000000000000)) ||
    (request.signal !== undefined && !(request.signal instanceof AbortSignal))
  )
    throw new DevelopmentErrorV1(
      'development.invalid_begin',
      'begin requires exact source & supported bounded runtime options'
    )
  if (request.probe !== undefined) validateProbe(request.probe)
}

function validateCommand(command: DevelopmentCommandV1): DevelopmentCommandV1
{
  if (!command || typeof command !== 'object' || Array.isArray(command))
    throw new DevelopmentErrorV1(
      'development.invalid_command',
      'command must be a discriminated object'
    )
  if (['start', 'pause', 'resume', 'restart'].includes(command.kind))
  {
    assertObject(command, ['kind'])
    return { kind: command.kind as 'start' | 'pause' | 'resume' | 'restart' }
  }
  if (command.kind === 'advance')
  {
    assertObject(command, ['kind', 'ticks'])
    if (
      !Number.isSafeInteger(command.ticks) ||
      command.ticks < 1 ||
      command.ticks > 600
    )
      throw new DevelopmentErrorV1(
        'development.invalid_command',
        'advance requires 1..600 logical ticks'
      )
    return { ...command }
  }
  if (command.kind === 'mark')
  {
    assertObject(command, ['kind', 'label'])
    if (
      typeof command.label !== 'string' ||
      command.label.length < 1 ||
      command.label.length > 240
    )
      throw new DevelopmentErrorV1(
        'development.invalid_command',
        'mark label must contain 1..240 characters'
      )
    return { ...command }
  }
  if (command.kind === 'input')
  {
    assertObject(command, ['kind', 'input'])
    if (command.input?.device === 'keyboard')
    {
      assertObject(command.input, ['device', 'key', 'isDown'])
      const key = command.input.key
      if (
        typeof key !== 'string' ||
        !key.length ||
        key.length > DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits ||
        key.includes('\0') ||
        typeof command.input.isDown !== 'boolean'
      )
        throw new DevelopmentErrorV1(
          'development.invalid_command',
          'keyboard input requires a bounded raw key & boolean isDown'
        )
      return {
        kind: 'input',
        input: { device: 'keyboard', key, isDown: command.input.isDown },
      }
    }
    if (command.input?.device === 'mouse')
    {
      assertObject(command.input, ['device', 'x', 'y', 'isDown'])
      if (
        !Number.isFinite(command.input.x) ||
        !Number.isFinite(command.input.y) ||
        Math.abs(command.input.x) > 10000 ||
        Math.abs(command.input.y) > 10000 ||
        (command.input.isDown !== undefined &&
          typeof command.input.isDown !== 'boolean')
      )
        throw new DevelopmentErrorV1(
          'development.invalid_command',
          'mouse input requires finite bounded Scratch coordinates'
        )
      return { kind: 'input', input: { ...command.input } }
    }
  }
  throw new DevelopmentErrorV1(
    'development.invalid_command',
    'unknown development command'
  )
}

function validateProbe(probe: ProfileStateProbeV1): void
{
  try
  {
    validateSelectedStateProbeV1(probe)
  }
  catch (error)
  {
    throw new DevelopmentErrorV1(
      error instanceof SelectedStateProbeValidationErrorV1 &&
        error.kind === 'shape'
        ? 'development.invalid_shape'
        : 'development.invalid_probe',
      error instanceof Error ? error.message : 'invalid selected-state probe'
    )
  }
}

function assertObject(value: unknown, keys: readonly string[]): void
{
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new DevelopmentErrorV1(
      'development.invalid_shape',
      'object contains unsupported fields or an invalid shape'
    )
}

function decodeCursor(cursor: string | undefined, identity: string): number
{
  if (cursor === undefined) return 0
  const match = /^([a-f0-9]{64}):(\d{1,8})$/.exec(cursor)
  if (!match || match[1] !== identity)
    throw new DevelopmentErrorV1(
      'development.stale_cursor',
      'inspection collection changed; start pagination again'
    )
  return Number(match[2])
}

function parseJson(bytes: Uint8Array): unknown
{
  return scanStrictJson(
    new TextDecoder('utf8', { fatal: true }).decode(bytes),
    { maxDepth: 64, maxMembersPerContainer: 100000, maxNodes: 2000000 }
  ).value
}

function hasV2InputChronology(
  input: DevelopmentInputRecordV1
): input is DevelopmentInputRecordV2
{
  const validKey = (key: unknown): key is string =>
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits &&
    !key.includes('\0')
  return (
    input !== null &&
    typeof input === 'object' &&
    'captureSequence' in input &&
    typeof input.captureSequence === 'number' &&
    Number.isSafeInteger(input.captureSequence) &&
    input.captureSequence >= 1 &&
    'interpretedKey' in input &&
    (input.interpretedKey === null || validKey(input.interpretedKey)) &&
    'releasedKeys' in input &&
    Array.isArray(input.releasedKeys) &&
    input.releasedKeys.length <=
      DEVELOPMENT_INPUT_POLICY_V2.maxReleasedKeysPerInputEvent &&
    input.releasedKeys.every(validKey) &&
    (!isDevelopmentReleaseSourceV1(input.source) ||
      (input.data.isDown === false &&
        input.releasedKeys.length <=
          DEVELOPMENT_INPUT_POLICY_V2.maxReleasedKeysPerCleanupEvent))
  )
}

function hasV2FrameChronology(
  frame: DevelopmentFrameRecordV1
): frame is DevelopmentFrameRecordV2
{
  return (
    frame !== null &&
    typeof frame === 'object' &&
    'captureSequence' in frame &&
    typeof frame.captureSequence === 'number' &&
    Number.isSafeInteger(frame.captureSequence) &&
    frame.captureSequence >= 1 &&
    'inputOrdinal' in frame &&
    typeof frame.inputOrdinal === 'number' &&
    Number.isSafeInteger(frame.inputOrdinal) &&
    frame.inputOrdinal >= 0 &&
    frame.inputOrdinal <= DEVELOPMENT_INPUT_POLICY_V2.maxAppliedOrdinal &&
    'startInputOrdinal' in frame &&
    (frame.startInputOrdinal === null ||
      (typeof frame.startInputOrdinal === 'number' &&
        Number.isSafeInteger(frame.startInputOrdinal) &&
        frame.startInputOrdinal >= 0 &&
        frame.startInputOrdinal <= frame.inputOrdinal)) &&
    'captureKind' in frame &&
    (frame.captureKind === 'post-step' || frame.captureKind === 'observation')
  )
}

function hasV2MarkChronology(
  mark: DevelopmentMarkV1
): mark is DevelopmentMarkV2
{
  return (
    mark !== null &&
    typeof mark === 'object' &&
    hasV2FrameChronology(mark.frame) &&
    mark.frame.captureKind === 'observation' &&
    mark.frame.segmentId === mark.segmentId &&
    mark.frame.tick === mark.tick &&
    mark.frame.inputOrdinal === mark.inputOrdinal &&
    mark.frame.startInputOrdinal === mark.startInputOrdinal
  )
}

function detached<T>(value: T): T
{
  return JSON.parse(JSON.stringify(value)) as T
}

function profileEqual(
  a: RuntimeExecutionProfileV1,
  b: RuntimeExecutionProfileV1
): boolean
{
  return (
    a.runtime === b.runtime &&
    a.scheduler === b.scheduler &&
    a.tickRate === b.tickRate
  )
}
