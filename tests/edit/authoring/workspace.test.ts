// tests/edit/authoring/workspace.test.ts
// protect repeatable bulk authoring, exact runtime acceptance & fail-closed publication

import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  mkdir,
  link,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { clearTimeout, setTimeout } from 'node:timers'
import { promisify } from 'node:util'

import { PNG } from 'pngjs'
import { chromium } from 'playwright'
import {
  inspectSelectedProject,
  validateAuthoringCandidateEvaluationV3,
  authoringRuntimeIdentitiesV2,
  authoringRuntimeIdentitySha256V2,
  authoringEvaluationPolicySha256V2,
  authoringCandidateEvaluationEvidenceSha256V2,
  preparePublicationFileV1,
  commitPreparedPublicationV1,
  type AuthoringCandidateEvaluationV2,
  type AuthoringCandidateEvaluationV3,
  type AuthoringRuntimeIdentityV3,
} from '@scratch-agent/eval'
import {
  compileScratchWorkspaceV2,
  type WorkspaceCompilationInputV2,
  type WorkspacePreparedAssetV2,
  type WorkspaceSourceFileV2,
  type ScratchWorkspaceManifestV2,
  type WorkspaceBlockV2,
  type WorkspaceProcedureFileV2,
  type WorkspaceScriptFileV2,
} from '@scratch-agent/ir/authoring'
import { unpackSb3 } from '@scratch-agent/sb3'

import {
  createAuthoringWorkspaceServiceV1,
  AUTHORING_PUBLICATION_POLICY_SHA256_V2,
  AUTHORING_PUBLICATION_POLICY_SHA256_V3,
  type AuthoringPublicationSummaryV1,
  type AuthoringPublicationFaultPointV1,
  type AuthoringArtifactRefV1,
} from '../../../packages/edit/src/authoring/workspace-service.js'
import { AuthoringRetentionV1 } from '../../../packages/edit/src/authoring/workspace-retention.js'
import type {
  AuthoringPublicationIntent,
  AuthoringPublicationPreparationV2,
} from '../../../packages/edit/src/authoring/workspace-publication.js'
import { editCanonicalSha256V1 } from '../../../packages/edit/src/support/canonical.js'
import { DEVELOPMENT_LIMITS_V1 } from '../../../packages/runner/src/development/types.js'
import {
  prepareDevelopmentClipPreviewV1,
  type DevelopmentClipSourceV1,
} from '../../../packages/runner/src/development/viewer.js'

function digest(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function block(
  opcode: string,
  inputs: Extract<WorkspaceBlockV2, { nodeKind: 'ordinary' }>['inputs'] = [],
  fields: Extract<WorkspaceBlockV2, { nodeKind: 'ordinary' }>['fields'] = []
): WorkspaceBlockV2
{
  return { nodeKind: 'ordinary', opcode, fields, inputs }
}

async function fixture(t: test.TestContext)
{
  const root = await mkdtemp(join(tmpdir(), 'scratch-authoring-workspace-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sources = join(root, 'sources')
  const evidence = join(root, 'evidence')
  const output = join(root, 'output')
  await Promise.all([mkdir(sources), mkdir(evidence), mkdir(output)])
  const image = new PNG({ width: 2, height: 2 })
  image.data = Buffer.from([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 0, 255,
  ])
  const png = PNG.sync.write(image, {
    colorType: 6,
    bitDepth: 8,
    inputHasAlpha: true,
  })
  const procedure: WorkspaceProcedureFileV2 = {
    schemaVersion: 2,
    kind: 'procedure',
    signature: {
      warp: true,
      parts: [
        { kind: 'label', text: 'move' },
        {
          kind: 'parameter',
          localKey: 'amount',
          name: 'amount',
          parameterType: 'number',
          defaultValue: 0,
        },
      ],
    },
    body: {
      blocks: [
        block('motion_changexby', [
          {
            name: 'DX',
            value: {
              valueKind: 'block',
              value: { nodeKind: 'parameterReporter', parameterId: 'amount' },
            },
          },
        ]),
        block(
          'data_setvariableto',
          [
            {
              name: 'VALUE',
              value: {
                valueKind: 'block',
                value: block('operator_add', [
                  {
                    name: 'NUM1',
                    value: {
                      valueKind: 'block',
                      value: block(
                        'data_variable',
                        [],
                        [
                          {
                            name: 'VARIABLE',
                            value: {
                              valueKind: 'entity',
                              value: { entityKind: 'declaration', id: 'score' },
                            },
                          },
                        ]
                      ),
                    },
                  },
                  {
                    name: 'NUM2',
                    value: {
                      valueKind: 'block',
                      value: {
                        nodeKind: 'parameterReporter',
                        parameterId: 'amount',
                      },
                    },
                  },
                ]),
              },
            },
          ],
          [
            {
              name: 'VARIABLE',
              value: {
                valueKind: 'entity',
                value: { entityKind: 'declaration', id: 'score' },
              },
            },
          ]
        ),
      ],
    },
  }
  const script: WorkspaceScriptFileV2 = {
    schemaVersion: 2,
    kind: 'script',
    root: {
      rootKind: 'eventScript',
      hat: block('event_whenflagclicked'),
      body: {
        blocks: [
          {
            nodeKind: 'procedureCall',
            procedureId: 'move',
            arguments: [
              {
                parameterId: 'amount',
                value: { valueKind: 'literal', value: 9 },
              },
            ],
          },
          block('looks_switchcostumeto', [
            {
              name: 'COSTUME',
              value: {
                valueKind: 'entity',
                value: { entityKind: 'media', id: 'frame17' },
              },
            },
          ]),
          block('looks_say', [
            {
              name: 'MESSAGE',
              value: { valueKind: 'literal', value: 'Built' },
            },
          ]),
        ],
      },
    },
  }
  const manifest: ScratchWorkspaceManifestV2 = {
    schemaVersion: 2,
    baseline: { kind: 'greenfield' },
    assets: Array.from({ length: 18 }, (_, i) => ({
      id: `frame${i}`,
      kind: 'costume',
      source: { path: 'actor.png' },
      pivot: { x: 1, y: 1 },
    })),
    targets: [
      {
        id: 'stage',
        kind: 'stage',
        name: 'Stage',
        declarations: [
          { id: 'score', kind: 'variable', name: 'Score', initialValue: 0 },
        ],
      },
      {
        id: 'actor',
        kind: 'sprite',
        name: 'Actor',
        properties: { x: 0, y: 0 },
        costumes: Array.from({ length: 18 }, (_, i) => ({
          assetId: `frame${i}`,
          name: `Frame${i}`,
        })),
        currentCostume: 'Frame0',
        procedures: [{ id: 'move', path: 'move.json' }],
        scripts: [{ id: 'flag', path: 'flag.json' }],
      },
    ],
    clips: [
      {
        id: 'pose',
        name: 'Pose',
        targetId: 'actor',
        loop: false,
        frames: [
          { logicalAssetId: 'frame17', durationMs: 30 },
          { logicalAssetId: 'frame0', durationMs: 45 },
          { logicalAssetId: 'frame9', durationMs: 60 },
        ],
      },
    ],
    runtimeTargets: [
      {
        schemaVersion: 1,
        runtime: 'scratch-official',
        scheduler: 'deterministic',
        tickRate: 60,
      },
      {
        schemaVersion: 1,
        runtime: 'turbowarp',
        scheduler: 'deterministic',
        tickRate: 60,
      },
    ],
    scenarios: [
      {
        id: 'built',
        scenario: {
          seed: 0,
          maxTicks: 2,
          steps: [
            { do: 'greenFlag' },
            { do: 'wait', ticks: 2 },
            { do: 'snapshot', label: 'done' },
          ],
        },
      },
    ],
    assertions: [
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'prop', sprite: 'Actor', prop: 'x' },
          match: { kind: 'equals', value: 9 },
        },
      },
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'prop', sprite: 'Actor', prop: 'costume' },
          match: { kind: 'equals', value: 'Frame17' },
        },
      },
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'var', name: 'Score' },
          match: { kind: 'equals', value: 9 },
        },
      },
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'said', sprite: 'Actor' },
          match: { kind: 'equals', value: 'Built' },
        },
      },
    ],
    output: { path: 'game.sb3' },
  }
  const files = new Map<string, Uint8Array>([
    ['actor.png', png],
    ['move.json', Buffer.from(JSON.stringify(procedure))],
    ['flag.json', Buffer.from(JSON.stringify(script))],
    ['scratch-workspace.json', Buffer.from(JSON.stringify(manifest))],
  ])
  for (const [name, bytes] of files) await writeFile(join(sources, name), bytes)
  return {
    root,
    sources,
    evidence,
    output,
    files,
    manifest,
    manifestPath: join(sources, 'scratch-workspace.json'),
  }
}

test('whole workspace builds more than sixteen costume references repeatably and reopens its accepted exact export', async (t) =>
{
  const input = await fixture(t)
  const costumeName = (index: number) =>
    index === 0 ? 'next costume' : index === 17 ? '1' : `Frame${index}`
  const otherScript: WorkspaceScriptFileV2 = {
    schemaVersion: 2,
    kind: 'script',
    root: {
      rootKind: 'eventScript',
      hat: block('event_whenflagclicked'),
      body: {
        blocks: [
          block('looks_switchcostumeto', [
            {
              name: 'COSTUME',
              value: {
                valueKind: 'entity',
                value: { entityKind: 'media', id: 'frame0' },
              },
            },
          ]),
        ],
      },
    },
  }
  const manifest: ScratchWorkspaceManifestV2 = {
    ...input.manifest,
    targets: [
      input.manifest.targets[0]!,
      {
        ...input.manifest.targets[1]!,
        costumes: Array.from({ length: 18 }, (_, i) => ({
          assetId: `frame${i}`,
          name: costumeName(i),
        })),
        currentCostume: 'next costume',
      },
      {
        id: 'other',
        kind: 'sprite',
        name: 'Other actor',
        costumes: Array.from({ length: 18 }, (_, i) => ({
          assetId: `frame${17 - i}`,
          name: costumeName(17 - i),
        })),
        currentCostume: '1',
        scripts: [{ id: 'other-flag', path: 'other-flag.json' }],
      },
    ],
    clips: [
      ...input.manifest.clips!,
      { ...input.manifest.clips![0]!, targetId: 'other' },
    ],
    assertions: [
      input.manifest.assertions![0]!,
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'prop', sprite: 'Actor', prop: 'costume' },
          match: { kind: 'equals', value: '1' },
        },
      },
      ...input.manifest.assertions!.slice(2),
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'prop', sprite: 'Other actor', prop: 'costume' },
          match: { kind: 'equals', value: 'next costume' },
        },
      },
    ],
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const otherScriptBytes = Buffer.from(JSON.stringify(otherScript))
  input.files.set('other-flag.json', otherScriptBytes)
  input.files.set('scratch-workspace.json', manifestBytes)
  await writeFile(join(input.sources, 'other-flag.json'), otherScriptBytes)
  await writeFile(input.manifestPath, manifestBytes)
  const service = await createAuthoringWorkspaceServiceV1({
    permissions: {
      sourceRoots: [input.sources],
      evidenceRoot: input.evidence,
      outputRoots: [input.output],
    },
  })
  const opened = await service.open({ manifestPath: input.manifestPath })
  const initialState = await readFile(
    join(opened.evidenceRoot, 'workspace.json')
  )
  for (const name of ['_edge_', '_mouse_', '_myself_', '_random_', '_stage_'])
  {
    await writeFile(
      input.manifestPath,
      JSON.stringify({
        ...manifest,
        targets: manifest.targets.map((target) =>
          target.id === 'other' ? { ...target, name } : target
        ),
      })
    )
    await assert.rejects(service.plan({ workspaceId: opened.workspaceId }), {
      code: 'WORKSPACE_SOURCE_INVALID',
      message: /sprite name collides with a reserved runtime target name/u,
    })
    assert.deepEqual(
      await readFile(join(opened.evidenceRoot, 'workspace.json')),
      initialState
    )
  }
  for (const collection of ['plans', 'builds', 'exports'] as const)
    assert.equal(
      (await service.inspect({ workspaceId: opened.workspaceId, collection }))
        .total,
      0
    )
  assert.deepEqual(await readdir(input.output), [])
  await writeFile(input.manifestPath, manifestBytes)
  const planned = await service.plan({ workspaceId: opened.workspaceId })
  assert.equal(planned.preparedAssetCount, 18)
  assert.ok(planned.plan.costs.decodedCostumeBytes! >= 18 * 2 * 2 * 4)
  assert.deepEqual(planned.plan.clips[0]!.tables, {
    costumeNames: ['1', 'next costume', 'Frame9'],
    costumeIndexesOneBased: [18, 1, 10],
    durationsMs: [30, 45, 60],
  })
  assert.deepEqual(planned.plan.clips[1]!.tables, {
    costumeNames: ['1', 'next costume', 'Frame9'],
    costumeIndexesOneBased: [1, 18, 9],
    durationsMs: [30, 45, 60],
  })
  const first = await service.build({
    workspaceId: opened.workspaceId,
    planId: planned.planId,
  })
  const second = await service.build({
    workspaceId: opened.workspaceId,
    planId: planned.planId,
  })
  assert.equal(first.candidateSha256, second.candidateSha256)
  assert.ok(first.developmentClips)
  const clipInput = {
    sourceBytes: await readFile(first.candidate.path),
    manifestBytes: await readFile(first.developmentClips.path),
    sessionId: 'workspace-clips',
    root: input.evidence,
    limits: DEVELOPMENT_LIMITS_V1,
  }
  const imported = await prepareDevelopmentClipPreviewV1(clipInput)
  assert.deepEqual(
    imported.preview.clips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      targetIndex: clip.targetIndex,
      costumeNames: clip.frames.map((frame) => frame.costumeName),
      costumeIndexesOneBased: clip.frames.map(
        (frame) => frame.costumeIndexOneBased
      ),
      durationsMs: clip.frames.map((frame) => frame.durationMs),
    })),
    planned.plan.clips.map((clip) => ({
      id: 'pose',
      name: 'Pose',
      targetIndex: clip.targetIndex,
      ...clip.tables,
    }))
  )
  assert.equal(imported.entries.length, 6)
  assert.deepEqual(
    imported.preview.clips.map((clip) =>
      clip.frames.map((frame) => frame.targetIndex)
    ),
    [
      [1, 1, 1],
      [2, 2, 2],
    ]
  )
  const clipSource = JSON.parse(
    clipInput.manifestBytes.toString('utf8')
  ) as DevelopmentClipSourceV1
  await assert.rejects(
    prepareDevelopmentClipPreviewV1({
      ...clipInput,
      manifestBytes: Buffer.from(
        JSON.stringify({
          ...clipSource,
          clips: [...clipSource.clips, clipSource.clips[0]!],
        })
      ),
    }),
    { code: 'development.viewer_refused' }
  )
  const evaluated = await service.evaluate({
    workspaceId: opened.workspaceId,
    buildId: first.buildId,
  })
  assert.equal(evaluated.disposition, 'accepted')
  const evidence = JSON.parse(
    await readFile(evaluated.result.path, 'utf8')
  ) as AuthoringCandidateEvaluationV3
  const evaluationRequest = {
    candidateBytes: await readFile(first.candidate.path),
    candidateSha256: first.candidateSha256,
    standardAuthoritySha256: planned.plan.standardAuthoritySha256,
    compilerIdentitySha256: planned.plan.compilerIdentitySha256,
    runtimeTargets: planned.plan.runtimeTargets,
    runtimeIdentities: planned.contract.tools
      .runtimeIdentities as readonly AuthoringRuntimeIdentityV3[],
    scenarios: planned.plan.scenarios,
    assertions: planned.plan.assertions,
  }
  assert.deepEqual(
    validateAuthoringCandidateEvaluationV3(evidence, evaluationRequest),
    []
  )
  assert.deepEqual(
    evidence.lanes.map((cell) => cell.lane),
    ['officialHeadless', 'officialBrowser', 'turboWarpBrowser']
  )
  assert.ok(
    evidence.lanes.every(
      (cell) =>
        cell.trace.observations.sourceSb3Sha256 === first.candidateSha256
    )
  )
  assert.equal(evidence.mediaArtifacts.length, 2)
  const evaluationRecord = JSON.parse(
    await readFile(evaluated.artifact.path, 'utf8')
  ) as {
    mediaArtifacts: {
      sourcePath: string
      artifact: { path: string; sha256: string }
    }[]
  }
  assert.equal(
    evaluationRecord.mediaArtifacts.length,
    evidence.mediaArtifacts.length
  )
  for (const [index, media] of evaluationRecord.mediaArtifacts.entries())
  {
    assert.equal(media.sourcePath, evidence.mediaArtifacts[index]!.path)
    assert.equal(media.artifact.sha256, evidence.mediaArtifacts[index]!.sha256)
    assert.equal(
      digest(await readFile(media.artifact.path)),
      media.artifact.sha256
    )
  }
  const incomplete = { ...evidence, lanes: evidence.lanes.slice(0, 1) }
  assert.ok(
    validateAuthoringCandidateEvaluationV3(incomplete, evaluationRequest).some(
      (issue) => issue.includes('required runtime/scenario cell')
    )
  )
  const destination = join(input.output, 'game.sb3')
  const exported = await service.export({
    workspaceId: opened.workspaceId,
    buildId: first.buildId,
    destinationPath: destination,
  })
  const bytes = await readFile(destination)
  assert.equal(digest(bytes), first.candidateSha256)
  assert.equal(exported.candidateSha256, first.candidateSha256)
  const reopened = await inspectSelectedProject(bytes)
  assert.equal(reopened.canRun, true)
  assert.equal(reopened.input.sha256, first.candidateSha256)
  const archive = await unpackSb3(bytes)
  const json = JSON.parse(archive.projectJsonText)
  const actor = json.targets.find(
    (target: { name: string }) => target.name === 'Actor'
  )
  assert.equal(actor.costumes.length, 18)
  assert.deepEqual(
    actor.costumes.map((costume: { name: string }) => costume.name),
    Array.from({ length: 18 }, (_, i) => costumeName(i))
  )
  assert.equal(
    new Set(actor.costumes.map((costume: { md5ext: string }) => costume.md5ext))
      .size,
    1
  )
  assert.ok(
    actor.costumes.every(
      (costume: { rotationCenterX: number; rotationCenterY: number }) =>
        costume.rotationCenterX === 1 && costume.rotationCenterY === 1
    )
  )
  const plans = await service.inspect({
    workspaceId: opened.workspaceId,
    collection: 'plans',
  })
  const builds = await service.inspect({
    workspaceId: opened.workspaceId,
    collection: 'builds',
  })
  const evaluations = await service.inspect({
    workspaceId: opened.workspaceId,
    collection: 'evaluations',
  })
  assert.ok(plans.items.length > 0)
  assert.ok(builds.items.length >= 1)
  assert.equal(evaluations.items.length, 1)
  for (const [name, original] of input.files)
    assert.deepEqual(
      await readFile(join(input.sources, name)),
      Buffer.from(original)
    )
  await service.close({ workspaceId: opened.workspaceId })
})

test('workspace publication survives ownership contention and interrupted receipts without replacing files or cached history', async (t) =>
{
  const input = await fixture(t)
  const outputRoot = await realpath(input.output)
  const manifest = {
    ...input.manifest,
    runtimeTargets: input.manifest.runtimeTargets!.slice(0, 1),
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  input.files.set('scratch-workspace.json', manifestBytes)
  await writeFile(input.manifestPath, manifestBytes)
  const permissions = {
    sourceRoots: [input.sources],
    evidenceRoot: input.evidence,
    outputRoots: [input.output],
  }
  const isCode =
    (code: string) =>
    (error: unknown): boolean =>
      error instanceof Error && 'code' in error && error.code === code
  const snapshot = async (root: string) =>
  {
    const files = new Map<string, string>()
    for (const name of (await readdir(root, { recursive: true })).sort())
    {
      const path = join(root, name)
      if ((await stat(path)).isFile())
        files.set(name, digest(await readFile(path)))
    }
    return files
  }

  // tiny refused closures prove admission runs before payload copies or metadata cloning
  let metadataReads = 0
  const asset: WorkspacePreparedAssetV2 = {
    logicalAssetId: 'probe',
    kind: 'costume',
    bytes: new Uint8Array(2),
    sourceSha256: '0'.repeat(64),
    transformSha256: '0'.repeat(64),
    outputSha256: '0'.repeat(64),
    get metadata(): Extract<
      WorkspacePreparedAssetV2,
      { kind: 'costume' }
    >['metadata']
    {
      metadataReads += 1
      throw new Error('metadata must not be inspected before admission')
    },
  }
  const source: WorkspaceSourceFileV2 = {
    path: 'probe.json',
    bytes: new Uint8Array(2),
  }
  const base: WorkspaceCompilationInputV2 = {
    manifest,
    files: [],
    baselineBytes: new Uint8Array(),
    preparedAssets: [],
  }
  const rejected: WorkspaceCompilationInputV2[] = [
    { ...base, preparedAssets: Array.from({ length: 4097 }, () => asset) },
    { ...base, files: Array.from({ length: 4097 }, () => source) },
    {
      ...base,
      baselineBytes: new Uint8Array(2),
      limits: { maximumSb3Bytes: 1 },
    },
    { ...base, files: [source], limits: { maximumSourceBytes: 1 } },
    { ...base, preparedAssets: [asset], limits: { maximumAssetBytes: 1 } },
  ]
  const originalFrom = Object.getOwnPropertyDescriptor(Uint8Array, 'from')
  let copies = 0
  Object.defineProperty(Uint8Array, 'from', {
    configurable: true,
    writable: true,
    value: () =>
    {
      copies += 1
      throw new Error('payload must not be copied before admission')
    },
  })
  try
  {
    for (const candidate of rejected)
      await assert.rejects(
        compileScratchWorkspaceV2(candidate),
        isCode('WORKSPACE_BUILD_BUDGET_EXCEEDED')
      )
    assert.equal(copies, 0)
    assert.equal(metadataReads, 0)
  }
  finally
  {
    if (originalFrom === undefined) Reflect.deleteProperty(Uint8Array, 'from')
    else Object.defineProperty(Uint8Array, 'from', originalFrom)
  }

  let mode: 'none' | 'source-drift' | 'after-commit' | 'before-state' = 'none'
  let takeoverRefused = false
  const contender = await createAuthoringWorkspaceServiceV1({ permissions })
  let workspaceId = ''
  let planId = ''
  const writer = await createAuthoringWorkspaceServiceV1({
    permissions,
    publicationFaultHook: async (point) =>
    {
      if (mode === 'source-drift' && point === 'before-commit')
      {
        mode = 'none'
        const ownerPath = join(
          input.evidence,
          workspaceId,
          '.durable-owner.json'
        )
        const owner = await readFile(ownerPath)
        await assert.rejects(
          contender.build({ workspaceId, planId }),
          isCode('lock-busy')
        )
        assert.deepEqual(await readFile(ownerPath), owner)
        takeoverRefused = true
        await writeFile(join(input.sources, 'flag.json'), '{}')
      }
      else if (mode === 'after-commit' && point === 'after-commit')
      {
        mode = 'none'
        throw new Error('operator interruption after verified link commit')
      }
      else if (mode === 'before-state' && point === 'before-state')
      {
        mode = 'none'
        throw new Error('operator interruption before completed state pointer')
      }
    },
  })
  const opened = await writer.open({ manifestPath: input.manifestPath })
  workspaceId = opened.workspaceId
  const planned = await writer.plan({ workspaceId })
  planId = planned.planId
  const first = await writer.build({ workspaceId, planId })
  await writer.build({ workspaceId, planId })
  const reader = await createAuthoringWorkspaceServiceV1({ permissions })
  const oldPage = await reader.inspect({
    workspaceId,
    collection: 'builds',
    limit: 1,
  })
  assert.equal(oldPage.total, 2)
  assert.ok(oldPage.nextCursor)
  await writer.build({ workspaceId, planId })
  assert.equal(
    (await reader.inspect({ workspaceId, collection: 'builds' })).total,
    3
  )
  await assert.rejects(
    reader.inspect({
      workspaceId,
      collection: 'builds',
      limit: 1,
      cursor: oldPage.nextCursor!,
    }),
    isCode('authoring.stale_page')
  )

  // a distinct process owns the actual flock until kernel crash cleanup releases it
  const retainedRoot = join(await realpath(input.evidence), workspaceId)
  const holder = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { withNativeArtifactRootLeaseV1 } from '@scratch-agent/eval'
    await withNativeArtifactRootLeaseV1(${JSON.stringify(retainedRoot)}, async () => {
      process.stdout.write('LOCKED\\n')
      await new Promise(() => { setInterval(() => {}, 1000) })
    })
  `,
    ],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }
  )
  t.after(() =>
  {
    if (holder.exitCode === null && holder.signalCode === null)
      holder.kill('SIGKILL')
  })
  await new Promise<void>((resolve, reject) =>
  {
    let output = ''
    let errors = ''
    const timer = setTimeout(
      () =>
        reject(new Error(`native lock child did not become ready: ${errors}`)),
      10000
    )
    holder.stderr.on('data', (chunk: Buffer) =>
    {
      errors = `${errors}${chunk.toString()}`.slice(0, 4096)
    })
    holder.stdout.on('data', (chunk: Buffer) =>
    {
      output = `${output}${chunk.toString()}`.slice(0, 4096)
      if (output.includes('LOCKED\n'))
      {
        clearTimeout(timer)
        resolve()
      }
    })
    holder.once('error', (error) =>
    {
      clearTimeout(timer)
      reject(error)
    })
    holder.once('exit', (code, signal) =>
    {
      clearTimeout(timer)
      reject(
        new Error(
          `native lock child ended before contention: ${code}/${signal}: ${errors}`
        )
      )
    })
  })
  const lockedBefore = await snapshot(retainedRoot)
  await assert.rejects(
    writer.build({ workspaceId, planId }),
    isCode('lock-busy')
  )
  await assert.rejects(
    contender.build({ workspaceId, planId }),
    isCode('lock-busy')
  )
  assert.deepEqual(await snapshot(retainedRoot), lockedBefore)
  const holderExit = once(holder, 'exit')
  holder.kill('SIGKILL')
  assert.deepEqual(await holderExit, [null, 'SIGKILL'])
  await writer.build({ workspaceId, planId })

  // historical reads do not load the optional native writer dependency
  const nativeDisabledBefore = await snapshot(retainedRoot)
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--no-addons',
      '--input-type=module',
      '-e',
      `
      import { createAuthoringWorkspaceServiceV1 } from '@scratch-agent/edit'
      const service = await createAuthoringWorkspaceServiceV1({ permissions: ${JSON.stringify(permissions)} })
      const page = await service.inspect({ workspaceId: ${JSON.stringify(workspaceId)}, collection: 'builds' })
      let code = null
      try { await service.build({ workspaceId: ${JSON.stringify(workspaceId)}, planId: ${JSON.stringify(planId)} }) }
      catch (error) { code = error.code }
      process.stdout.write('RESULT ' + JSON.stringify({ count: page.total, code }) + '\\n')
    `,
    ],
    { cwd: process.cwd(), timeout: 15000, maxBuffer: 64 * 1024 }
  )
  const line = stdout.split('\n').find((value) => value.startsWith('RESULT '))
  assert.ok(line)
  assert.deepEqual(JSON.parse(line.slice(7)), {
    count: 4,
    code: 'lock-unavailable',
  })
  assert.deepEqual(await snapshot(retainedRoot), nativeDisabledBefore)

  const evaluated = await writer.evaluate({
    workspaceId,
    buildId: first.buildId,
  })
  assert.equal(evaluated.disposition, 'accepted')
  const directoryMode = (await stat(input.output)).mode
  mode = 'source-drift'
  const abortedPath = join(outputRoot, 'drift-refused.sb3')
  const interrupted = await writer.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: abortedPath,
  })
  assert.equal(takeoverRefused, true)
  assert.equal(interrupted.status, 'recovery-required')
  await assert.rejects(readFile(abortedPath), isCode('ENOENT'))
  const aborted = await writer.recoverExport({
    workspaceId,
    exportId: interrupted.exportId,
  })
  assert.equal(aborted.status, 'aborted')
  await assert.rejects(readFile(abortedPath), isCode('ENOENT'))
  await writeFile(
    join(input.sources, 'flag.json'),
    input.files.get('flag.json')!
  )

  mode = 'after-commit'
  const destinationPath = join(outputRoot, 'recoverable.sb3')
  const published = await writer.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath,
  })
  assert.equal(published.status, 'recovery-required')
  assert.equal(published.receipt, null)
  assert.equal(digest(await readFile(destinationPath)), first.candidateSha256)
  const committedIdentity = await stat(destinationPath)
  const pending = await reader.inspect({ workspaceId })
  assert.equal(
    (pending.items[0] as { pendingPublication: string }).pendingPublication,
    published.exportId
  )
  await assert.rejects(
    writer.build({ workspaceId, planId }),
    isCode('authoring.publication_recovery_required')
  )
  await writeFile(join(input.sources, 'flag.json'), '{}')
  const recovery = await createAuthoringWorkspaceServiceV1({
    permissions,
    publicationFaultHook: async (point) =>
    {
      if (mode === 'before-state' && point === 'before-state')
      {
        mode = 'none'
        throw new Error('operator interruption after receipt before pointer')
      }
    },
  })
  const originalExecutablePath = chromium.executablePath
  try
  {
    chromium.executablePath = () => '/retained-fixture/chromium-999999/chrome'
    mode = 'before-state'
    const receiptInterrupted = await recovery.recoverExport({
      workspaceId,
      exportId: published.exportId,
    })
    assert.equal(receiptInterrupted.status, 'recovery-required')
    const receiptPath = join(
      retainedRoot,
      'exports',
      published.exportId,
      'receipt.json'
    )
    const retainedReceipt = await readFile(receiptPath)
    const recovered = await recovery.recoverExport({
      workspaceId,
      exportId: published.exportId,
    })
    assert.equal(recovered.status, 'complete')
    assert.ok(recovered.receipt)
    assert.equal(recovered.receipt.sha256, digest(retainedReceipt))
    assert.equal(recovered.exportId, published.exportId)
    assert.equal(recovered.candidateSha256, first.candidateSha256)
    assert.equal(digest(await readFile(destinationPath)), first.candidateSha256)
    const finalIdentity = await stat(destinationPath)
    assert.equal(finalIdentity.dev, committedIdentity.dev)
    assert.equal(finalIdentity.ino, committedIdentity.ino)
    const completedBefore = await snapshot(retainedRoot)
    assert.deepEqual(
      await recovery.recoverExport({
        workspaceId,
        exportId: published.exportId,
      }),
      recovered
    )
    assert.deepEqual(await snapshot(retainedRoot), completedBefore)
  }
  finally
  {
    chromium.executablePath = originalExecutablePath
  }
  await writeFile(
    join(input.sources, 'flag.json'),
    input.files.get('flag.json')!
  )
  assert.equal(
    (await reader.inspect({ workspaceId, collection: 'exports' })).total,
    1
  )
  assert.equal(
    (await reader.inspect({ workspaceId, collection: 'publications' })).total,
    2
  )
  const replayBefore = await snapshot(retainedRoot)
  const replay = await reader.replay({ workspaceId, buildId: first.buildId })
  assert.equal(replay.candidateSha256, first.candidateSha256)
  assert.equal(replay.replayWrites, 0)
  assert.deepEqual(await snapshot(retainedRoot), replayBefore)

  // orphan phase records remain visible without rotating ownership or moving the pointer
  const publicationIds = async () =>
    (
      await reader.inspect({
        workspaceId,
        collection: 'publications',
        limit: 32,
      })
    ).items as readonly AuthoringPublicationSummaryV1[]
  const stateBytes = () => readFile(join(retainedRoot, 'workspace.json'))
  const interruptedWriter = (point: AuthoringPublicationFaultPointV1) =>
    createAuthoringWorkspaceServiceV1({
      permissions,
      publicationFaultHook: (observed) =>
      {
        if (observed === point) throw new Error(`injected ${point}`)
      },
    })
  const quotaWriter = await interruptedWriter('quota-reserved')
  const quotaPath = join(outputRoot, 'quota-only-retry.sb3')
  const quotaPointer = await stateBytes()
  await assert.rejects(
    quotaWriter.export({
      workspaceId,
      buildId: first.buildId,
      destinationPath: quotaPath,
    }),
    /injected quota-reserved/
  )
  assert.deepEqual(await stateBytes(), quotaPointer)
  const quotaReader = await AuthoringRetentionV1.resume(
    workspaceId,
    retainedRoot,
    false
  )
  const orphanReservations = await quotaReader.store.activeQuotaReservations()
  assert.equal(orphanReservations.length, 1)
  const quotaSnapshot = await snapshot(retainedRoot)
  const quotaStatus = await reader.inspect({ workspaceId })
  assert.deepEqual(
    (quotaStatus.items[0] as { unclaimedPublicationReservations: string[] })
      .unclaimedPublicationReservations,
    [orphanReservations[0]!.reservationId]
  )
  assert.deepEqual(await snapshot(retainedRoot), quotaSnapshot)
  const quotaRetry = await createAuthoringWorkspaceServiceV1({ permissions })
  const quotaCompleted = await quotaRetry.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: quotaPath,
  })
  assert.equal(quotaCompleted.status, 'complete')
  assert.notEqual(
    `publications/${quotaCompleted.exportId}/capacity`,
    orphanReservations[0]!.reservationId
  )
  const quotaAfter = await AuthoringRetentionV1.resume(
    workspaceId,
    retainedRoot,
    false
  )
  assert.equal(
    (await quotaAfter.store.quotaOutcome(orphanReservations[0]!.reservationId))
      .state,
    'released'
  )

  const orphanWriter = await interruptedWriter('intent-before-state')
  const orphanPath = join(outputRoot, 'orphan-intent.sb3')
  const orphanPointer = await stateBytes()
  const publicationPage = await reader.inspect({
    workspaceId,
    collection: 'publications',
    limit: 1,
  })
  assert.ok(publicationPage.nextCursor)
  await assert.rejects(
    orphanWriter.export({
      workspaceId,
      buildId: first.buildId,
      destinationPath: orphanPath,
    }),
    /injected intent-before-state/
  )
  assert.deepEqual(await stateBytes(), orphanPointer)
  const orphanSnapshot = await snapshot(retainedRoot)
  const orphan = (await publicationIds()).find(
    (entry) => entry.path === orphanPath
  )!
  assert.ok(orphan)
  assert.equal(orphan.status, 'recovery-required')
  assert.equal(orphan.prepared, null)
  const visibleIntent = await reader.readArtifact({
    workspaceId,
    key: orphan.intent.key,
  })
  assert.equal(digest(visibleIntent.bytes), orphan.intent.sha256)
  await assert.rejects(
    reader.inspect({
      workspaceId,
      collection: 'publications',
      limit: 1,
      cursor: publicationPage.nextCursor!,
    }),
    isCode('authoring.stale_page')
  )
  assert.deepEqual(await snapshot(retainedRoot), orphanSnapshot)
  const orphanQuota = await AuthoringRetentionV1.resume(
    workspaceId,
    retainedRoot,
    false
  )
  assert.equal(
    (
      await orphanQuota.store.quotaOutcome(
        `publications/${orphan.exportId}/capacity`
      )
    ).state,
    'active'
  )
  const orphanRecovery = await createAuthoringWorkspaceServiceV1({
    permissions,
  })
  await assert.rejects(
    orphanRecovery.build({ workspaceId, planId }),
    isCode('authoring.publication_recovery_required')
  )
  const orphanComplete = await orphanRecovery.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: orphanPath,
  })
  assert.equal(orphanComplete.exportId, orphan.exportId)
  assert.equal(orphanComplete.status, 'complete')
  assert.deepEqual(
    await orphanRecovery.recoverExport({
      workspaceId,
      exportId: orphan.exportId,
    }),
    orphanComplete
  )

  const initialPreparation = await interruptedWriter('prepared-before-state')
  const originalPath = join(outputRoot, 'orphan-original-preparation.sb3')
  const original = await initialPreparation.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: originalPath,
  })
  assert.equal(original.status, 'recovery-required')
  assert.equal(original.prepared, null)
  const discoveredOriginal = (await publicationIds()).find(
    (entry) => entry.exportId === original.exportId
  )!
  assert.ok(discoveredOriginal.prepared?.key.endsWith('/prepared-0.json'))
  const originalProof = JSON.parse(
    await readFile(discoveredOriginal.prepared!.path, 'utf8')
  ) as AuthoringPublicationPreparationV2
  const originalRecovery = await createAuthoringWorkspaceServiceV1({
    permissions,
  })
  const originalComplete = await originalRecovery.recoverExport({
    workspaceId,
    exportId: original.exportId,
  })
  assert.equal(originalComplete.status, 'complete')
  assert.equal(
    (await stat(originalPath, { bigint: true })).ino.toString(),
    originalProof.proof.inode
  )

  for (const replacementWindow of [
    'prepared-before-state',
    'prepared-file-created',
  ] as const)
  {
    let fault: AuthoringPublicationFaultPointV1 | null = 'intent-retained'
    const replacing = await createAuthoringWorkspaceServiceV1({
      permissions,
      publicationFaultHook: (point) =>
      {
        if (point === fault) throw new Error(`injected replacement ${point}`)
      },
    })
    const destination = join(outputRoot, `replacement-${replacementWindow}.sb3`)
    const started = await replacing.export({
      workspaceId,
      buildId: first.buildId,
      destinationPath: destination,
    })
    assert.equal(started.status, 'recovery-required')
    fault = replacementWindow
    const interruptedReplacement = await replacing.recoverExport({
      workspaceId,
      exportId: started.exportId,
    })
    assert.equal(interruptedReplacement.status, 'recovery-required')
    const temporary = join(
      outputRoot,
      `.authoring-${started.exportId}-replacement.tmp`
    )
    const replacementIdentity = await stat(temporary, { bigint: true })
    const retainedPreparationPath = join(
      retainedRoot,
      'exports',
      started.exportId,
      'prepared-1.json'
    )
    if (replacementWindow === 'prepared-before-state')
      assert.equal(
        (
          JSON.parse(
            await readFile(retainedPreparationPath, 'utf8')
          ) as AuthoringPublicationPreparationV2
        ).proof.inode,
        replacementIdentity.ino.toString()
      )
    else
      await assert.rejects(readFile(retainedPreparationPath), isCode('ENOENT'))
    const retry = await createAuthoringWorkspaceServiceV1({
      permissions,
      publicationFaultHook: (point) =>
      {
        if (point === 'before-commit')
          throw new Error(
            'retain bounded replacement before missing-temp probe'
          )
      },
    })
    const prepared = await retry.recoverExport({
      workspaceId,
      exportId: started.exportId,
    })
    assert.equal(prepared.status, 'recovery-required')
    assert.ok(prepared.prepared?.key.endsWith('/prepared-1.json'))
    const preserved = `${temporary}.held`
    await link(temporary, preserved)
    await unlink(temporary)
    const missing = await createAuthoringWorkspaceServiceV1({ permissions })
    const refused = await missing.recoverExport({
      workspaceId,
      exportId: started.exportId,
    })
    assert.equal(refused.status, 'interference')
    await assert.rejects(readFile(temporary), isCode('ENOENT'))
    await assert.rejects(readFile(destination), isCode('ENOENT'))
    await link(preserved, temporary)
    await unlink(preserved)
    const completed = await missing.recoverExport({
      workspaceId,
      exportId: started.exportId,
    })
    assert.equal(completed.status, 'complete')
    assert.equal(
      (await stat(destination, { bigint: true })).ino,
      replacementIdentity.ino
    )
    assert.equal(digest(await readFile(destination)), first.candidateSha256)
  }

  const abandonedWriter = await interruptedWriter('intent-before-state')
  const abandonedPath = join(outputRoot, 'legacy-released-intent.sb3')
  await assert.rejects(
    abandonedWriter.export({
      workspaceId,
      buildId: first.buildId,
      destinationPath: abandonedPath,
    }),
    /injected intent-before-state/
  )
  const abandoned = (await publicationIds()).find(
    (entry) => entry.path === abandonedPath
  )!
  const abandonedIntentBytes = await readFile(abandoned.intent.path)
  const oldOwner = await AuthoringRetentionV1.resume(
    workspaceId,
    retainedRoot,
    true
  )
  await oldOwner.withRootLease(() =>
    oldOwner.store.releaseQuota(`publications/${abandoned.exportId}/capacity`)
  )
  const abandonedRecovery = await createAuthoringWorkspaceServiceV1({
    permissions,
  })
  const retired = await abandonedRecovery.recoverExport({
    workspaceId,
    exportId: abandoned.exportId,
  })
  assert.equal(retired.status, 'aborted')
  assert.deepEqual(await readFile(abandoned.intent.path), abandonedIntentBytes)
  await assert.rejects(readFile(abandonedPath), isCode('ENOENT'))
  const freshAfterAbandonment = await abandonedRecovery.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: abandonedPath,
  })
  assert.equal(freshAfterAbandonment.status, 'complete')
  assert.notEqual(freshAfterAbandonment.exportId, abandoned.exportId)

  const freshDrift = await interruptedWriter('before-commit')
  const freshDriftPath = join(outputRoot, 'unpublished-browser-drift.sb3')
  const uncommitted = await freshDrift.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: freshDriftPath,
  })
  assert.equal(uncommitted.status, 'recovery-required')
  try
  {
    chromium.executablePath = () => '/retained-fixture/chromium-999999/chrome'
    const driftRecovery = await createAuthoringWorkspaceServiceV1({
      permissions,
    })
    const stale = await driftRecovery.recoverExport({
      workspaceId,
      exportId: uncommitted.exportId,
    })
    assert.equal(stale.status, 'aborted')
    await assert.rejects(readFile(freshDriftPath), isCode('ENOENT'))
  }
  finally
  {
    chromium.executablePath = originalExecutablePath
  }

  // a separate v2 history binds the old opaque browser identity to an already linked inode
  const legacyOpen = await (
    await createAuthoringWorkspaceServiceV1({ permissions })
  ).open({ manifestPath: input.manifestPath })
  const legacyRoot = join(
    await realpath(input.evidence),
    legacyOpen.workspaceId
  )
  const legacyStore = await AuthoringRetentionV1.resume(
    legacyOpen.workspaceId,
    legacyRoot,
    true
  )
  let legacyExportId = ''
  let legacyOutput = ''
  let legacyPrepared: AuthoringPublicationPreparationV2 | undefined
  const legacyImmutableBefore = new Map<string, string>()
  await legacyStore.withRootLease(async () =>
  {
    const copied = new Map<string, AuthoringArtifactRefV1>()
    const copy = async (ref: AuthoringArtifactRefV1) =>
    {
      const prior = copied.get(ref.key)
      if (prior) return prior
      const retained = await legacyStore.retain(
        ref.key,
        await readFile(ref.path),
        ref.mimeType
      )
      copied.set(retained.key, retained)
      return retained
    }
    const retainJson = async (key: string, value: unknown) =>
    {
      const retained = await legacyStore.retainJson(key, value)
      copied.set(key, retained)
      return retained
    }
    const legacyPlan = JSON.parse(await readFile(planned.artifact.path, 'utf8'))
    legacyPlan.workspaceId = legacyOpen.workspaceId
    for (const source of legacyPlan.sources)
      source.artifact = await copy(source.artifact)
    for (const asset of legacyPlan.preparedAssets)
      asset.artifact = await copy(asset.artifact)
    legacyPlan.baseline = await copy(legacyPlan.baseline)
    legacyPlan.diff = await copy(legacyPlan.diff)
    legacyPlan.sourceClosureSha256 = editCanonicalSha256V1({
      sources: legacyPlan.sources,
      baselineArtifactSha256: legacyPlan.baseline.sha256,
    })
    const oldIdentities = authoringRuntimeIdentitiesV2(manifest.runtimeTargets)
    legacyPlan.tools = {
      ...legacyPlan.tools,
      runtimeIdentities: oldIdentities,
      runtimeIdentitiesSha256: editCanonicalSha256V1(oldIdentities),
    }
    const { contractSha256: priorContractSha256, ...legacyContract } =
      legacyPlan.contract
    assert.equal(priorContractSha256, planned.contractSha256)
    legacyContract.tools = legacyPlan.tools
    legacyContract.sourceClosureSha256 = legacyPlan.sourceClosureSha256
    legacyPlan.contract = {
      ...legacyContract,
      contractSha256: editCanonicalSha256V1(legacyContract),
    }
    const legacyPlanRef = await retainJson(planned.artifact.key, legacyPlan)
    const legacyBuild = JSON.parse(await readFile(first.artifact.path, 'utf8'))
    legacyBuild.workspaceId = legacyOpen.workspaceId
    legacyBuild.planRecord = legacyPlanRef
    legacyBuild.contractSha256 = legacyPlan.contract.contractSha256
    legacyBuild.candidate = await copy(legacyBuild.candidate)
    legacyBuild.diff = await copy(legacyBuild.diff)
    legacyBuild.bootstrap = await copy(legacyBuild.bootstrap)
    if (legacyBuild.developmentClips)
      legacyBuild.developmentClips = await copy(legacyBuild.developmentClips)
    const legacyBuildRef = await retainJson(first.artifact.key, legacyBuild)
    const accepted = JSON.parse(
      await readFile(evaluated.result.path, 'utf8')
    ) as AuthoringCandidateEvaluationV3
    const { evidenceSha256: oldEvidenceSha256, ...acceptedContent } = accepted
    assert.equal(oldEvidenceSha256, evaluated.evidenceSha256)
    const legacyContent = {
      ...acceptedContent,
      schemaVersion: 2 as const,
      kind: 'authoring-candidate-evaluation-v2' as const,
      evaluationPolicySha256: authoringEvaluationPolicySha256V2({
        candidateBytes: await readFile(first.candidate.path),
        candidateSha256: first.candidateSha256,
        compilerIdentitySha256: legacyPlan.tools.compilerIdentitySha256,
        standardAuthoritySha256: legacyPlan.tools.standardAuthoritySha256,
        runtimeIdentities: oldIdentities,
        runtimeTargets: legacyPlan.plan.runtimeTargets,
        scenarios: legacyPlan.plan.scenarios,
        assertions: legacyPlan.plan.assertions,
      }),
      lanes: accepted.lanes.map((cell) =>
      {
        const { browserInstallationIdentity, ...legacyCell } = cell
        assert.ok(
          browserInstallationIdentity === null ||
            typeof browserInstallationIdentity === 'string'
        )
        return {
          ...legacyCell,
          runtimeIdentitySha256: authoringRuntimeIdentitySha256V2(
            cell.runtimeDescriptor
          ),
        }
      }),
    }
    const legacyEvaluation: AuthoringCandidateEvaluationV2 = {
      ...legacyContent,
      evidenceSha256:
        authoringCandidateEvaluationEvidenceSha256V2(legacyContent),
    }
    const legacyResultRef = await retainJson(
      evaluated.result.key,
      legacyEvaluation
    )
    const legacyEvaluationRecord = JSON.parse(
      await readFile(evaluated.artifact.path, 'utf8')
    )
    legacyEvaluationRecord.workspaceId = legacyOpen.workspaceId
    legacyEvaluationRecord.result = legacyResultRef
    for (const media of legacyEvaluationRecord.mediaArtifacts)
      media.artifact = await copy(media.artifact)
    const legacyEvaluationRef = await retainJson(
      evaluated.artifact.key,
      legacyEvaluationRecord
    )
    const initialPointer =
      await legacyStore.store.readImmutable('workspace.json')
    const baseState = {
      ...JSON.parse(Buffer.from(initialPointer).toString('utf8')),
      publicationPolicySha256: AUTHORING_PUBLICATION_POLICY_SHA256_V2,
      plans: [{ planId, artifact: legacyPlanRef }],
      builds: [{ buildId: first.buildId, artifact: legacyBuildRef }],
      evaluations: [
        { evaluationId: evaluated.evaluationId, artifact: legacyEvaluationRef },
      ],
      artifacts: [...copied.values()],
    }
    const basePointer = await legacyStore.store.compareAndSwapPointer(
      'workspace.json',
      digest(initialPointer),
      Buffer.from(JSON.stringify(baseState))
    )
    const originalIntent = JSON.parse(
      await readFile(published.intent.path, 'utf8')
    ) as AuthoringPublicationIntent
    legacyExportId = `export-${randomUUID().replaceAll('-', '')}`
    legacyOutput = join(outputRoot, 'legacy-published-browser-drift.sb3')
    const capability = await legacyStore.store.capability()
    const maximumPointerBytes =
      Buffer.byteLength(JSON.stringify(baseState)) + 64 * 1024
    const legacyIntent: AuthoringPublicationIntent = {
      ...originalIntent,
      schemaVersion: 2,
      kind: 'authoring-publication-intent-v2',
      policySha256: AUTHORING_PUBLICATION_POLICY_SHA256_V2,
      exportId: legacyExportId,
      workspaceId: legacyOpen.workspaceId,
      evaluation: legacyEvaluationRef,
      candidate: legacyBuild.candidate,
      plan: legacyPlanRef,
      contractSha256: legacyPlan.contract.contractSha256,
      sourceClosureSha256: legacyPlan.sourceClosureSha256,
      tools: legacyPlan.tools,
      previousStateSha256: basePointer.sha256,
      ownerSha256: capability.ownershipSha256,
      finalBasename: 'legacy-published-browser-drift.sb3',
      tempBasename: `.authoring-${randomUUID()}.tmp`,
      capacity: {
        reservationId: `publications/${legacyExportId}/capacity`,
        reservedBytes: 4 * 64 * 1024 + 2 * maximumPointerBytes,
        reservedEntries: 4,
        initialEntries: (await legacyStore.store.listImmutable('')).length,
        initialBytes: capability.quota.settledBytes,
        maximumPointerBytes,
      },
    }
    await legacyStore.store.reserveQuota(
      legacyIntent.capacity.reservationId,
      legacyIntent.capacity.reservedBytes
    )
    const intentRef = await retainJson(
      `exports/${legacyExportId}/intent.json`,
      legacyIntent
    )
    const proof = preparePublicationFileV1({
      directory: legacyIntent.directory,
      finalBasename: legacyIntent.finalBasename,
      tempBasename: legacyIntent.tempBasename,
      bytes: await readFile(first.candidate.path),
      expectedSha256: first.candidateSha256,
      maxBytes: first.candidate.byteLength,
    })
    legacyPrepared = {
      schemaVersion: 2,
      exportId: legacyExportId,
      intentSha256: intentRef.sha256,
      ordinal: 0,
      proof,
    }
    const preparedRef = await retainJson(
      `exports/${legacyExportId}/prepared-0.json`,
      legacyPrepared
    )
    commitPreparedPublicationV1(proof)
    const summary: AuthoringPublicationSummaryV1 = {
      schemaVersion: 1,
      exportId: legacyExportId,
      buildId: first.buildId,
      candidateSha256: first.candidateSha256,
      path: legacyOutput,
      phase: 'published',
      status: 'recovery-required',
      recoverable: true,
      intent: intentRef,
      prepared: preparedRef,
      receipt: null,
      issues: ['legacy process ended after publication'],
    }
    await legacyStore.store.compareAndSwapPointer(
      'workspace.json',
      basePointer.sha256,
      Buffer.from(
        JSON.stringify({
          ...baseState,
          pendingPublication: legacyExportId,
          publications: [summary],
          artifacts: [...copied.values()],
        })
      )
    )
    for (const ref of copied.values())
      legacyImmutableBefore.set(ref.path, digest(await readFile(ref.path)))
  })
  assert.ok(legacyPrepared)
  try
  {
    chromium.executablePath = () => '/retained-fixture/chromium-999999/chrome'
    const historical = await createAuthoringWorkspaceServiceV1({ permissions })
    const legacyReadOnly = await snapshot(legacyRoot)
    const oldPolicy = await historical.inspect({
      workspaceId: legacyOpen.workspaceId,
    })
    assert.equal(
      (oldPolicy.items[0] as { publicationPolicySha256: string })
        .publicationPolicySha256,
      AUTHORING_PUBLICATION_POLICY_SHA256_V2
    )
    assert.deepEqual(await snapshot(legacyRoot), legacyReadOnly)
    const completed = await historical.recoverExport({
      workspaceId: legacyOpen.workspaceId,
      exportId: legacyExportId,
    })
    assert.equal(completed.status, 'complete')
    assert.equal(
      (await stat(legacyOutput, { bigint: true })).ino.toString(),
      legacyPrepared.proof.inode
    )
    assert.equal(digest(await readFile(legacyOutput)), first.candidateSha256)
    assert.equal(
      (
        JSON.parse(await readFile(completed.receipt!.path, 'utf8')) as {
          schemaVersion: number
        }
      ).schemaVersion,
      2
    )
    for (const [path, sha256] of legacyImmutableBefore)
      assert.equal(digest(await readFile(path)), sha256)
    await assert.rejects(
      historical.export({
        workspaceId: legacyOpen.workspaceId,
        buildId: first.buildId,
        destinationPath: join(outputRoot, 'legacy-cannot-republish.sb3'),
      }),
      isCode('authoring.invalid_evaluation_evidence')
    )
    const upgraded = await historical.inspect({
      workspaceId: legacyOpen.workspaceId,
    })
    assert.equal(
      (upgraded.items[0] as { publicationPolicySha256: string })
        .publicationPolicySha256,
      AUTHORING_PUBLICATION_POLICY_SHA256_V3
    )
    assert.deepEqual(
      await historical.recoverExport({
        workspaceId: legacyOpen.workspaceId,
        exportId: legacyExportId,
      }),
      completed
    )
  }
  finally
  {
    chromium.executablePath = originalExecutablePath
  }

  const conflicting = await createAuthoringWorkspaceServiceV1({
    permissions,
    publicationFaultHook: (point) =>
    {
      if (point === 'after-commit')
        throw new Error('operator interrupted before final verification')
    },
  })
  const conflictPath = join(outputRoot, 'interference.sb3')
  const conflict = await conflicting.export({
    workspaceId,
    buildId: first.buildId,
    destinationPath: conflictPath,
  })
  assert.equal(conflict.status, 'recovery-required')
  await unlink(conflictPath)
  const externalBytes = Buffer.from(
    'independent existing output must survive recovery'
  )
  await writeFile(conflictPath, externalBytes)
  const conflictBefore = await readFile(conflictPath)
  const interfered = await conflicting.recoverExport({
    workspaceId,
    exportId: conflict.exportId,
  })
  assert.equal(interfered.status, 'interference')
  assert.deepEqual(await readFile(conflictPath), conflictBefore)
  await assert.rejects(
    conflicting.close({ workspaceId }),
    isCode('authoring.publication_recovery_required')
  )
  assert.equal((await stat(input.output)).mode, directoryMode)
  for (const [name, original] of input.files)
    assert.deepEqual(
      await readFile(join(input.sources, name)),
      Buffer.from(original)
    )
  assert.equal(digest(await readFile(destinationPath)), first.candidateSha256)
})

test('stale sources and reference-counted global budgets prevent promotion and export', async (t) =>
{
  const input = await fixture(t)
  const service = await createAuthoringWorkspaceServiceV1({
    permissions: {
      sourceRoots: [input.sources],
      evidenceRoot: input.evidence,
      outputRoots: [input.output],
    },
  })
  const opened = await service.open({ manifestPath: input.manifestPath })
  const planned = await service.plan({ workspaceId: opened.workspaceId })
  await writeFile(join(input.sources, 'flag.json'), Buffer.from('{}'))
  await assert.rejects(
    service.build({ workspaceId: opened.workspaceId, planId: planned.planId })
  )
  assert.deepEqual(await readdir(input.output), [])
  await assert.rejects(
    service.export({
      workspaceId: opened.workspaceId,
      buildId: 'unbuilt',
      destinationPath: join(input.output, 'failed.sb3'),
    })
  )
  await writeFile(
    join(input.sources, 'flag.json'),
    input.files.get('flag.json')!
  )
  const limited = await createAuthoringWorkspaceServiceV1({
    permissions: {
      sourceRoots: [input.sources],
      evidenceRoot: join(input.root, 'limited-evidence'),
      outputRoots: [input.output],
      editLimits: { maxPngDecodedRgbaBytes: 18 * 2 * 2 * 4 - 1 },
    },
  })
  const limitedOpened = await limited.open({ manifestPath: input.manifestPath })
  await assert.rejects(limited.plan({ workspaceId: limitedOpened.workspaceId }))
  assert.deepEqual(await readdir(input.output), [])
  for (const [name, original] of input.files)
    assert.deepEqual(
      await readFile(join(input.sources, name)),
      Buffer.from(original)
    )
  const failingManifest = {
    ...input.manifest,
    runtimeTargets: [],
    assertions: [
      {
        scenarioId: 'built',
        assertion: {
          at: 'done',
          probe: { on: 'prop', sprite: 'Actor', prop: 'x' },
          match: { kind: 'equals', value: 10 },
        },
      },
    ],
  }
  await writeFile(
    input.manifestPath,
    Buffer.from(JSON.stringify(failingManifest))
  )
  const failed = await createAuthoringWorkspaceServiceV1({
    permissions: {
      sourceRoots: [input.sources],
      evidenceRoot: join(input.root, 'failed-evidence'),
      outputRoots: [input.output],
    },
  })
  const failedOpened = await failed.open({ manifestPath: input.manifestPath })
  const failedPlan = await failed.plan({
    workspaceId: failedOpened.workspaceId,
  })
  const failedBuild = await failed.build({
    workspaceId: failedOpened.workspaceId,
    planId: failedPlan.planId,
  })
  const failedEvaluation = await failed.evaluate({
    workspaceId: failedOpened.workspaceId,
    buildId: failedBuild.buildId,
  })
  assert.equal(failedEvaluation.disposition, 'refused')
  await assert.rejects(
    failed.export({
      workspaceId: failedOpened.workspaceId,
      buildId: failedBuild.buildId,
      destinationPath: join(input.output, 'unchecked.sb3'),
    })
  )
  assert.deepEqual(await readdir(input.output), [])
  await writeFile(
    input.manifestPath,
    input.files.get('scratch-workspace.json')!
  )
  await failed.close({ workspaceId: failedOpened.workspaceId })
  await limited.close({ workspaceId: limitedOpened.workspaceId })
  await service.close({ workspaceId: opened.workspaceId })
})
