// tests/localize/localize.test.ts
// canonical R1-R5 structural localization & deterministic ranking gate

import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildCollector,
  buildStateGame,
  cloneProjectForRepair,
  deleteStatement,
  type BlockRef,
  type ProjectIR,
  type ScriptRef,
  type TargetRef,
} from '@scratch-agent/ir'
import {
  buildRelay,
  collectorCase,
  normalizeDiagnosticFailure,
  stableFingerprint,
  stateGameCase,
  type AssertionFailure,
  type DiagnosticFailure,
  type Matcher,
  type ModelFailureSignal,
  type NormalizedFailure,
  type Probe,
  type RepairTestSpec,
  type VisualFailure,
} from '@scratch-agent/eval'
import { analyzeStaticProject } from '@scratch-agent/static'
import { isBlockEntry, type Block, type Target } from '@scratch-agent/sb3'

import { localizeFailures } from '@scratch-agent/localize'

const HASH = 'a'.repeat(64)

interface BrokenCase
{
  project: ProjectIR
  intendedBlock: BlockRef | null
  intendedScript: ScriptRef
}

function targetRef(project: ProjectIR, targetIndex: number): TargetRef
{
  const target = project.json.targets[targetIndex]!
  return { targetIndex, name: target.name, isStage: target.isStage }
}

function uniqueBlock(
  target: Target,
  predicate: (block: Block) => boolean
): [string, Block]
{
  const matches = Object.entries(target.blocks).flatMap(([id, entry]) =>
    isBlockEntry(entry) && predicate(entry)
      ? [[id, entry] as [string, Block]]
      : []
  )
  assert.equal(matches.length, 1)
  return matches[0]!
}

function owningTop(target: Target, blockId: string): string
{
  let current = blockId
  const seen = new Set<string>()
  while (!seen.has(current))
  {
    seen.add(current)
    const entry = target.blocks[current]
    assert.ok(entry && isBlockEntry(entry))
    if (entry.topLevel === true) return current
    assert.equal(typeof entry.parent, 'string')
    current = entry.parent!
  }
  throw new Error(`block ${blockId} has no unique top-level owner`)
}

function r1(): BrokenCase
{
  const project = cloneProjectForRepair(buildStateGame())
  const targetIndex = project.json.targets.findIndex(
    (target) => target.name === 'Hero'
  )
  const target = project.json.targets[targetIndex]!
  const [blockId, change] = uniqueBlock(
    target,
    (block) =>
      block.opcode === 'data_changevariableby' &&
      block.fields?.VARIABLE?.[0] === 'score'
  )
  change.inputs!.VALUE![1] = [4, '0']
  const targetReference = targetRef(project, targetIndex)
  return {
    project,
    intendedBlock: { target: targetReference, blockId },
    intendedScript: {
      target: targetReference,
      topBlockId: owningTop(target, blockId),
    },
  }
}

function r2(): BrokenCase
{
  const project = cloneProjectForRepair(buildStateGame())
  const targetIndex = project.json.targets.findIndex((target) => target.isStage)
  const target = project.json.targets[targetIndex]!
  const [blockId] = uniqueBlock(
    target,
    (block) =>
      block.opcode === 'data_setvariableto' &&
      block.fields?.VARIABLE?.[0] === 'score'
  )
  const topBlockId = owningTop(target, blockId)
  deleteStatement(target, blockId)
  return {
    project,
    intendedBlock: null,
    intendedScript: { target: targetRef(project, targetIndex), topBlockId },
  }
}

function r3(): BrokenCase & { receiver: BlockRef }
{
  const healthy = buildRelay()
  const wrongId = healthy.stage!.addBroadcast('wrong')
  const project = cloneProjectForRepair(healthy)
  const senderIndex = project.json.targets.findIndex(
    (target) => target.name === 'Sender'
  )
  const receiverIndex = project.json.targets.findIndex(
    (target) => target.name === 'Receiver'
  )
  const sender = project.json.targets[senderIndex]!
  const receiver = project.json.targets[receiverIndex]!
  const [senderBlockId, senderBlock] = uniqueBlock(
    sender,
    (block) => block.opcode === 'event_broadcast'
  )
  senderBlock.inputs!.BROADCAST_INPUT![1] = [11, 'wrong', wrongId]
  const [receiverBlockId] = uniqueBlock(
    receiver,
    (block) => block.opcode === 'event_whenbroadcastreceived'
  )
  const senderTarget = targetRef(project, senderIndex)
  const receiverTarget = targetRef(project, receiverIndex)
  return {
    project,
    intendedBlock: { target: senderTarget, blockId: senderBlockId },
    intendedScript: {
      target: senderTarget,
      topBlockId: owningTop(sender, senderBlockId),
    },
    receiver: { target: receiverTarget, blockId: receiverBlockId },
  }
}

function r4(): BrokenCase
{
  const project = cloneProjectForRepair(buildStateGame())
  const targetIndex = project.json.targets.findIndex((target) => target.isStage)
  const target = project.json.targets[targetIndex]!
  const livesId = Object.entries(target.variables).find(
    ([, entry]) => entry[0] === 'lives'
  )![0]
  const [blockId, comparator] = uniqueBlock(
    target,
    (block) =>
      block.opcode === 'operator_lt' &&
      Object.values(block.inputs ?? {}).some((input) =>
        input.some(
          (slot) => Array.isArray(slot) && slot[0] === 12 && slot[2] === livesId
        )
      )
  )
  comparator.opcode = 'operator_gt'
  const targetReference = targetRef(project, targetIndex)
  return {
    project,
    intendedBlock: { target: targetReference, blockId },
    intendedScript: {
      target: targetReference,
      topBlockId: owningTop(target, blockId),
    },
  }
}

function r5(): BrokenCase
{
  const project = cloneProjectForRepair(buildCollector())
  const targetIndex = project.json.targets.findIndex(
    (target) => target.name === 'Item'
  )
  const target = project.json.targets[targetIndex]!
  const [blockId, falling] = uniqueBlock(
    target,
    (block) => block.opcode === 'motion_changeyby'
  )
  falling.inputs!.DY![1] = [4, '0']
  const targetReference = targetRef(project, targetIndex)
  return {
    project,
    intendedBlock: { target: targetReference, blockId },
    intendedScript: {
      target: targetReference,
      topBlockId: owningTop(target, blockId),
    },
  }
}

function assertion(
  testId: string,
  snapshot: string,
  probe: Probe,
  matcher: Matcher,
  observed = '<failed>'
): AssertionFailure
{
  const fields = { testId, lane: 'vm' as const, snapshot, probe, matcher }
  return {
    kind: 'assertion',
    fingerprint: stableFingerprint('assertion', fields),
    ...fields,
    expected: '<expected>',
    observed,
  }
}

function visual(
  testId: string,
  snapshot: string,
  probe: Probe,
  matcher: Matcher
): VisualFailure
{
  const fields = { testId, lane: 'browser' as const, snapshot, probe, matcher }
  return {
    kind: 'visual',
    fingerprint: stableFingerprint('visual', fields),
    ...fields,
    expected: '<expected>',
    observed: '<failed>',
  }
}

function model(
  testId: string,
  modelId: string,
  edgeId: string,
  checkName: string,
  checkArgs: ModelFailureSignal['checkArgs']
): ModelFailureSignal
{
  const fields = {
    testId,
    modelId,
    edgeId,
    checkName,
    checkArgs,
    checkNegated: false,
    phase: 'effect' as const,
  }
  return {
    kind: 'model',
    fingerprint: stableFingerprint('model', fields),
    lane: 'model',
    ...fields,
    target: typeof checkArgs[0] === 'string' ? checkArgs[0] : null,
    tick: 1,
    message: '<failed>',
  }
}

function repairSpec(
  id: string,
  source: Omit<RepairTestSpec, 'id' | 'role' | 'baseline'>
): RepairTestSpec
{
  return {
    ...source,
    id,
    role: 'repair-target',
    baseline: {
      outcome: 'fail',
      failures: [
        {
          kind: 'schema',
          category: 'artifact-load-failed',
        },
      ],
      allowAdditionalProjectFailures: false,
    },
  }
}

const winSpec = repairSpec('state-win', {
  name: stateGameCase.name,
  scenario: stateGameCase.scenario,
  asserts: stateGameCase.asserts,
  model: stateGameCase.model,
})

const resetProbe = { on: 'var' as const, name: 'score' }
const resetMatcher = { kind: 'equals' as const, value: 0 }
const resetStateProbe = { on: 'var' as const, name: 'state' }
const playingMatcher = { kind: 'equals' as const, value: 'playing' }
const resetSpec = repairSpec('state-reset', {
  name: 'state game resets on a second flag',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'tapKey', key: 'space' },
      { do: 'tapKey', key: 'space' },
      { do: 'tapKey', key: 'space' },
      { do: 'snapshot', label: 'dirty' },
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'reset' },
    ],
  },
  asserts: [
    { at: 'reset', probe: resetProbe, match: resetMatcher },
    { at: 'reset', probe: resetStateProbe, match: playingMatcher },
  ],
})

const lossSpec = repairSpec('state-loss', {
  name: 'state game loses only after three damage inputs',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'start' },
      { do: 'tapKey', key: 'd' },
      { do: 'snapshot', label: 'damage-1' },
      { do: 'tapKey', key: 'd' },
      { do: 'snapshot', label: 'damage-2' },
      { do: 'tapKey', key: 'd' },
      { do: 'snapshot', label: 'damage-3' },
    ],
  },
  asserts: ['start', 'damage-1', 'damage-2'].map((at) => ({
    at,
    probe: resetStateProbe,
    match: playingMatcher,
  })),
})

const relayProbe = {
  on: 'prop' as const,
  sprite: 'Receiver',
  prop: 'x' as const,
}
const relayMatcher = { kind: 'equals' as const, value: 10 }
const relaySpec = repairSpec('relay-movement', {
  name: 'relay moves receiver',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 2 },
      { do: 'snapshot', label: 'after' },
    ],
  },
  asserts: [{ at: 'after', probe: relayProbe, match: relayMatcher }],
})

const collectorSpec = repairSpec('collector-renderer', {
  name: collectorCase.name,
  scenario: collectorCase.scenario,
  asserts: collectorCase.asserts,
  visual: collectorCase.visual,
})

function stateFailuresR1(): NormalizedFailure[]
{
  const score = assertion(
    'state-win',
    'end',
    { on: 'var', name: 'score' },
    { kind: 'equals', value: 10 },
    '0'
  )
  const state = assertion(
    'state-win',
    'end',
    { on: 'var', name: 'state' },
    { kind: 'equals', value: 'won' },
    'playing'
  )
  const change = model('state-win', 'stategame', 'e_collect', 'VarChange', [
    'Stage',
    'score',
    '+',
  ])
  const end = model('state-win', 'endwin', 'e_end', 'VarComp', [
    'Stage',
    'state',
    '==',
    'won',
  ])
  return [
    score,
    state,
    ...Array.from({ length: 10 }, () => ({ ...change })),
    end,
  ]
}

function diagnostics(project: ProjectIR): DiagnosticFailure[]
{
  return analyzeStaticProject(project).diagnostics.map((diagnostic) =>
    normalizeDiagnosticFailure(project, 'static', diagnostic)
  )
}

function candidateMatches(
  candidate: { script: ScriptRef; implicatedBlock: BlockRef | null },
  expected: BrokenCase
): boolean
{
  return (
    candidate.script.target.targetIndex ===
      expected.intendedScript.target.targetIndex &&
    candidate.script.topBlockId === expected.intendedScript.topBlockId &&
    (!expected.intendedBlock ||
      candidate.implicatedBlock?.blockId === expected.intendedBlock.blockId)
  )
}

test('retains implicated context when readable identities exceed its budget', () =>
{
  const broken = r1()
  const targetIndex = broken.intendedScript.target.targetIndex
  const target = broken.project.json.targets[targetIndex]!
  const originalBlockId = broken.intendedBlock!.blockId
  const originalTopBlockId = broken.intendedScript.topBlockId
  const oversizedIds = new Map(
    Object.keys(target.blocks).map((blockId, index) => [
      blockId,
      `${'b'.repeat(7_900)}-${index}`,
    ])
  )
  const entries = Object.entries(target.blocks)
  for (const [, entry] of entries)
  {
    if (!isBlockEntry(entry)) continue
    if (typeof entry.parent === 'string')
      entry.parent = oversizedIds.get(entry.parent)!
    if (typeof entry.next === 'string')
      entry.next = oversizedIds.get(entry.next)!
    for (const input of Object.values(entry.inputs ?? {}))
    {
      if (typeof input[1] === 'string') input[1] = oversizedIds.get(input[1])!
      if (input.length > 2 && typeof input[2] === 'string')
        input[2] = oversizedIds.get(input[2])!
    }
  }
  target.blocks = Object.fromEntries(
    entries.map(([blockId, entry]) => [oversizedIds.get(blockId)!, entry])
  )
  target.name = `Hero-${'n'.repeat(7_900)}`
  const reference = targetRef(broken.project, targetIndex)
  broken.intendedBlock = {
    target: reference,
    blockId: oversizedIds.get(originalBlockId)!,
  }
  broken.intendedScript = {
    target: reference,
    topBlockId: oversizedIds.get(originalTopBlockId)!,
  }

  const report = localizeFailures({
    project: broken.project,
    baselineArtifactSha256: HASH,
    failures: stateFailuresR1(),
    tests: [winSpec],
  })
  const candidate = report.candidates.find((entry) =>
    candidateMatches(entry, broken)
  )
  assert.ok(candidate)
  assert.equal(candidate.script.target.name, target.name)
  assert.equal(candidate.implicatedBlock?.blockId, broken.intendedBlock.blockId)
  const implicated = candidate.context.blocks.find(
    (block) => block.relation === 'implicated'
  )
  assert.ok(implicated)
  assert.equal(implicated.opcode, 'data_changevariableby')
  assert.notEqual(implicated.block.blockId, broken.intendedBlock.blockId)
  assert.ok(
    Buffer.byteLength(JSON.stringify(candidate.context), 'utf8') <= 8_192
  )
  assert.ok(candidate.context.truncationReasons.includes('identity-truncation'))
})

test('localizer ranks R1-R5 code with stable provenance & bounded context', () =>
{
  const case1 = r1()
  const r1Failures = stateFailuresR1()
  const report1 = localizeFailures({
    project: case1.project,
    baselineArtifactSha256: HASH,
    failures: r1Failures,
    tests: [winSpec],
  })
  assert.ok(
    report1.candidates
      .slice(0, 3)
      .some((candidate) => candidateMatches(candidate, case1))
  )
  const r1Candidate = report1.candidates.find((candidate) =>
    candidateMatches(candidate, case1)
  )!
  const changeReason = r1Candidate.reasons.find(
    (reason) =>
      reason.code === 'declaration-writer' &&
      reason.failureFingerprint === r1Failures[2]!.fingerprint
  )
  assert.equal(changeReason?.occurrences, 10)
  assert.equal(
    r1Candidate.reasons.filter(
      (reason) =>
        reason.failureFingerprint === r1Failures[2]!.fingerprint &&
        reason.code === 'declaration-writer'
    ).length,
    1
  )
  const minimalContext = localizeFailures({
    project: case1.project,
    baselineArtifactSha256: HASH,
    failures: r1Failures,
    tests: [winSpec],
    maxContextBlocks: 1,
  })
  const minimalR1 = minimalContext.candidates.find((candidate) =>
    candidateMatches(candidate, case1)
  )!
  assert.deepEqual(
    minimalR1.context.blocks.map((block) => block.block.blockId),
    [case1.intendedBlock!.blockId]
  )
  assert.equal(minimalR1.context.truncated, true)

  const covered = localizeFailures({
    project: case1.project,
    baselineArtifactSha256: HASH,
    failures: r1Failures,
    tests: [winSpec],
    dynamicCoverage: [
      {
        schemaVersion: 1,
        baselineArtifactSha256: HASH,
        testId: 'state-win',
        failureFingerprint: r1Failures[2]!.fingerprint,
        provider: { id: 'test-coverage', version: '1' },
        complete: true,
        truncated: false,
        coveredBlocks: [case1.intendedBlock!],
      },
    ],
  })
  const coveredR1 = covered.candidates.find((candidate) =>
    candidateMatches(candidate, case1)
  )!
  assert.equal(coveredR1.score, r1Candidate.score)
  assert.ok(
    coveredR1.reasons.some(
      (reason) => reason.code === 'dynamic-covered' && reason.score === 0
    )
  )
  const staleEvidence = localizeFailures({
    project: case1.project,
    baselineArtifactSha256: HASH,
    failures: r1Failures,
    tests: [winSpec],
    dynamicCoverage: [
      {
        schemaVersion: 1,
        baselineArtifactSha256: 'b'.repeat(64),
        testId: 'state-win',
        failureFingerprint: r1Failures[2]!.fingerprint,
        provider: { id: 'stale', version: '1' },
        complete: false,
        truncated: true,
        coveredBlocks: [case1.intendedBlock!],
      },
    ],
    priorRejectedBlocks: [
      {
        baselineArtifactSha256: 'b'.repeat(64),
        attemptId: 'attempt-1',
        block: case1.intendedBlock!,
        introducedFailureFingerprints: [r1Failures[2]!.fingerprint],
      },
    ],
  })
  assert.deepEqual(staleEvidence.dynamicProviders, [])
  assert.ok(
    staleEvidence.unresolved.some(
      (entry) => entry.reasonCode === 'dynamic-signal-rejected'
    )
  )
  assert.ok(
    staleEvidence.unresolved.some(
      (entry) => entry.reasonCode === 'prior-patch-signal-rejected'
    )
  )
  assert.ok(
    staleEvidence.candidates.every((candidate) =>
      candidate.reasons.every(
        (reason) =>
          reason.code !== 'dynamic-covered' &&
          reason.code !== 'prior-patch-new-failure'
      )
    )
  )

  const case2 = r2()
  const resetFailure = assertion(
    'state-reset',
    'reset',
    resetProbe,
    resetMatcher,
    '3'
  )
  const report2 = localizeFailures({
    project: case2.project,
    baselineArtifactSha256: HASH,
    failures: [resetFailure],
    tests: [resetSpec],
  })
  const r2Candidate = report2.candidates
    .slice(0, 3)
    .find(
      (candidate) =>
        candidate.script.target.targetIndex ===
          case2.intendedScript.target.targetIndex &&
        candidate.script.topBlockId === case2.intendedScript.topBlockId
    )
  assert.ok(r2Candidate)
  assert.equal(r2Candidate.implicatedBlock, null)
  assert.ok(
    r2Candidate.reasons.some((reason) => reason.code === 'target-named')
  )

  const case3 = r3()
  const relayFailure = assertion(
    'relay-movement',
    'after',
    relayProbe,
    relayMatcher,
    '0'
  )
  const r3Diagnostics = diagnostics(case3.project)
  assert.deepEqual(r3Diagnostics.map((entry) => entry.code).sort(), [
    'message-never-received',
    'message-never-sent',
  ])
  const report3 = localizeFailures({
    project: case3.project,
    baselineArtifactSha256: HASH,
    failures: [relayFailure, ...r3Diagnostics],
    diagnostics: r3Diagnostics,
    tests: [relaySpec],
  })
  assert.ok(
    report3.candidates
      .slice(0, 3)
      .some((candidate) => candidateMatches(candidate, case3))
  )
  assert.ok(
    report3.candidates.some((candidate) =>
      candidate.reasons.some((reason) =>
        reason.relatedBlocks.some(
          (block) =>
            block.target.targetIndex === case3.receiver.target.targetIndex &&
            block.blockId === case3.receiver.blockId
        )
      )
    )
  )
  assert.ok(
    r3Diagnostics.every((diagnostic) =>
      report3.candidates.some((candidate) =>
        candidate.sourceFailureFingerprints.includes(diagnostic.fingerprint)
      )
    )
  )

  const case4 = r4()
  const r4Failures: NormalizedFailure[] = [
    assertion(
      'state-win',
      'end',
      { on: 'var', name: 'state' },
      { kind: 'equals', value: 'won' },
      'lost'
    ),
    model('state-win', 'endwin', 'e_end', 'VarComp', [
      'Stage',
      'state',
      '==',
      'won',
    ]),
    assertion('state-reset', 'reset', resetStateProbe, playingMatcher, 'lost'),
    ...['start', 'damage-1', 'damage-2'].map((snapshot) =>
      assertion('state-loss', snapshot, resetStateProbe, playingMatcher, 'lost')
    ),
  ]
  const report4 = localizeFailures({
    project: case4.project,
    baselineArtifactSha256: HASH,
    failures: r4Failures,
    tests: [winSpec, resetSpec, lossSpec],
  })
  const r4Candidate = report4.candidates
    .slice(0, 3)
    .find(
      (candidate) =>
        candidate.script.target.targetIndex ===
          case4.intendedScript.target.targetIndex &&
        candidate.script.topBlockId === case4.intendedScript.topBlockId
    )
  assert.ok(r4Candidate)
  const contextOpcodes = new Set(
    r4Candidate.context.blocks.map((block) => block.opcode)
  )
  assert.ok(contextOpcodes.has('control_if'))
  assert.ok(contextOpcodes.has('operator_gt'))
  assert.ok(
    r4Candidate.context.blocks.some(
      (block) =>
        block.opcode === 'data_setvariableto' &&
        block.fields.some(
          (field) => field.name === 'VARIABLE' && field.value === 'state'
        )
    )
  )

  const case5 = r5()
  const itemScoreProbe = { on: 'var' as const, name: 'score', sprite: 'Item' }
  const itemScoreMatcher = { kind: 'equals' as const, value: 1 }
  const r5Failures: NormalizedFailure[] = [
    visual('collector-renderer', 'caught', itemScoreProbe, itemScoreMatcher),
    visual(
      'collector-renderer',
      'caught',
      {
        on: 'regionChanged',
        from: 'start',
        region: { x: 200, y: 0, width: 80, height: 360 },
      },
      { kind: 'gt', value: 0 }
    ),
  ]
  const report5 = localizeFailures({
    project: case5.project,
    baselineArtifactSha256: HASH,
    failures: r5Failures,
    tests: [collectorSpec],
  })
  const r5Index = report5.candidates.findIndex(
    (candidate) =>
      candidate.script.target.targetIndex ===
        case5.intendedScript.target.targetIndex &&
      candidate.script.topBlockId === case5.intendedScript.topBlockId
  )
  assert.ok(r5Index >= 0 && r5Index < 3)
  const playerIndexes = report5.candidates.flatMap((candidate, index) =>
    candidate.script.target.name === 'Player' ? [index] : []
  )
  assert.ok(playerIndexes.every((index) => r5Index < index))
  assert.ok(
    report5.candidates[r5Index]!.context.blocks.some(
      (block) => block.block.blockId === case5.intendedBlock!.blockId
    )
  )

  const reversed = localizeFailures({
    project: case3.project,
    baselineArtifactSha256: HASH,
    failures: [relayFailure, ...[...r3Diagnostics].reverse()],
    diagnostics: [...r3Diagnostics].reverse(),
    tests: [relaySpec],
  })
  assert.deepEqual(reversed, report3)
  for (const report of [report1, report2, report3, report4, report5])
  {
    for (let index = 1; index < report.candidates.length; index++)
    {
      const previous = report.candidates[index - 1]!
      const current = report.candidates[index]!
      if (previous.score !== current.score) continue
      const previousKey = [
        previous.script.target.targetIndex,
        previous.script.topBlockId,
        previous.implicatedBlock?.blockId ?? '\uffff',
      ] as const
      const currentKey = [
        current.script.target.targetIndex,
        current.script.topBlockId,
        current.implicatedBlock?.blockId ?? '\uffff',
      ] as const
      assert.ok(
        previousKey[0] < currentKey[0] ||
          (previousKey[0] === currentKey[0] &&
            (previousKey[1] < currentKey[1] ||
              (previousKey[1] === currentKey[1] &&
                previousKey[2] <= currentKey[2])))
      )
    }
  }
})
