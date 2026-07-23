// packages/repair/src/benchmark/benchmark.ts
// canonical R1-R5 faults, registered cases, selectors, & reference proposals

import {
  buildCollector,
  buildStateGame,
  blockRef,
  broadcastRef,
  cloneProjectForRepair,
  deleteStatement,
  variableRef,
  type BlockRef,
  type ProjectIR,
  type RepairOp,
  type ScriptRef,
} from '@scratch-agent/ir'
import {
  collectorRendererSpec,
  relayMovementSpec,
  stateLossSpec,
  stateResetSpec,
  stateWinSpec,
  type Assertion,
  type FailureExpectation,
  type RepairTestSpec,
  buildRelay,
} from '@scratch-agent/eval'

import type { RepairProposal, RepairRequest } from '../policy/contracts.js'
import {
  cloneRepairPolicy,
  DEFAULT_REPAIR_POLICY,
  type RepairPolicy,
} from '../policy/policy.js'
import type { RepairCase } from './repair-case.js'

export const REPAIR_BENCHMARK_IDS = ['R1', 'R2', 'R3', 'R4', 'R5'] as const

export type RepairBenchmarkId = (typeof REPAIR_BENCHMARK_IDS)[number]

export interface RepairBenchmarkDefinition
{
  id: RepairBenchmarkId
  healthy: ProjectIR
  broken: ProjectIR
  repairCase: RepairCase
  expectedLocalization: {
    block: BlockRef | null
    script: ScriptRef
  }
  referenceProposal(request: RepairRequest): RepairProposal
}

interface SelectedBlock
{
  targetIndex: number
  blockId: string
  block: Block
}

type Target = ProjectIR['json']['targets'][number]
type Block = Exclude<Target['blocks'][string], unknown[]>

function asBlock(value: unknown): Block | null
{
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Block)
    : null
}

function namedTarget(
  project: ProjectIR,
  name: string,
  isStage: boolean
): { targetIndex: number; target: Target }
{
  const matches = project.json.targets.flatMap((target, targetIndex) =>
    target.name === name && target.isStage === isStage
      ? [{ targetIndex, target }]
      : []
  )
  if (matches.length !== 1)
  {
    throw new Error(`expected one ${isStage ? 'Stage' : 'sprite'} ${name}`)
  }
  return matches[0]!
}

function uniqueBlock(
  project: ProjectIR,
  targetName: string,
  isStage: boolean,
  predicate: (block: Block) => boolean
): SelectedBlock
{
  const { targetIndex, target } = namedTarget(project, targetName, isStage)
  const matches = Object.entries(target.blocks).flatMap(([blockId, entry]) =>
  {
    const block = asBlock(entry)
    return block && predicate(block) ? [{ targetIndex, blockId, block }] : []
  })
  if (matches.length !== 1)
  {
    throw new Error(
      `expected one matching block in ${targetName}; found ${matches.length}`
    )
  }
  return matches[0]!
}

function variableField(block: Block, name: string): boolean
{
  return block.fields?.VARIABLE?.[0] === name
}

function numberLiteralSlot(block: Block, inputName: string): unknown[]
{
  const slot = block.inputs?.[inputName]?.[1]
  if (!Array.isArray(slot) || ![4, 5, 6, 7, 8].includes(slot[0]))
  {
    throw new Error(`${block.opcode}.${inputName} is not an inline number`)
  }
  return slot
}

function literalValue(block: Block, inputName: string): string | number
{
  return numberLiteralSlot(block, inputName)[1] as string | number
}

function replaceNumberLiteral(
  block: Block,
  inputName: string,
  value: string | number
): void
{
  numberLiteralSlot(block, inputName)[1] = value
}

function numberLiteralEquals(
  block: Block,
  inputName: string,
  expected: number
): boolean
{
  const value = literalValue(block, inputName)
  return value !== '' && Number(value) === expected
}

function owningTop(project: ProjectIR, selected: SelectedBlock): string
{
  const target = project.json.targets[selected.targetIndex]!
  let blockId = selected.blockId
  const seen = new Set<string>()
  while (true)
  {
    if (seen.has(blockId)) throw new Error(`cycle while finding top ${blockId}`)
    seen.add(blockId)
    const block = asBlock(target.blocks[blockId])
    if (!block) throw new Error(`missing block while finding top ${blockId}`)
    if (block.topLevel) return blockId
    if (!block.parent) throw new Error(`block ${blockId} has no owning top`)
    blockId = block.parent
  }
}

function assertionExpectation(assertion: Assertion): FailureExpectation
{
  return {
    kind: 'assertion',
    snapshot: assertion.at,
    probe: structuredClone(assertion.probe),
    matcher: structuredClone(assertion.match),
  }
}

function visualExpectation(assertion: Assertion): FailureExpectation
{
  return {
    kind: 'visual',
    snapshot: assertion.at,
    probe: structuredClone(assertion.probe),
    matcher: structuredClone(assertion.match),
  }
}

function modelExpectation(
  modelId: string,
  edgeId: string,
  checkName: string,
  checkArgs: Array<string | number | boolean>
): FailureExpectation
{
  return {
    kind: 'model',
    modelId,
    edgeId,
    checkName,
    checkArgs,
    checkNegated: false,
    phase: 'effect',
  }
}

function failingTest(
  id: string,
  spec: typeof stateWinSpec,
  failures: FailureExpectation[]
): RepairTestSpec
{
  return {
    ...spec,
    id,
    role: 'repair-target',
    baseline: {
      outcome: 'fail',
      failures,
      allowAdditionalProjectFailures: false,
    },
  }
}

function passingTest(id: string, spec: typeof stateWinSpec): RepairTestSpec
{
  return {
    ...spec,
    id,
    role: 'regression',
    baseline: { outcome: 'pass' },
  }
}

function casePolicy(
  kind: RepairOp['kind'],
  changedBlockRecords: number
): RepairPolicy
{
  const policy = cloneRepairPolicy(DEFAULT_REPAIR_POLICY)
  policy.intentBudget = {
    maxOpsPerProposal: 1,
    maxNewBlocksPerProposal: 1,
    allowedOpKinds: [kind],
  }
  policy.impactBudget = {
    maxTouchedTargets: 1,
    maxTouchedScripts: 1,
    maxChangedAuthoredBlocks: 1,
    maxChangedBlockRecords: changedBlockRecords,
  }
  return policy
}

function proposal(
  request: RepairRequest,
  operations: RepairOp[],
  expectedEffect: string
): RepairProposal
{
  return {
    schemaVersion: 1,
    requestId: request.requestId,
    baseArtifactSha256: request.baseline.artifactSha256,
    rationale:
      'Repair the localized canonical fault with one guarded operation.',
    expectedEffect,
    confidence: 1,
    operations,
  }
}

function r1(): RepairBenchmarkDefinition
{
  const healthy = buildStateGame()
  const broken = cloneProjectForRepair(healthy)
  const scoreWriter = uniqueBlock(
    broken,
    'Hero',
    false,
    (block) =>
      block.opcode === 'data_changevariableby' &&
      variableField(block, 'score') &&
      numberLiteralEquals(block, 'VALUE', 1)
  )
  replaceNumberLiteral(scoreWriter.block, 'VALUE', 0)
  const scoreFailures: FailureExpectation[] = [
    assertionExpectation(stateWinSpec.asserts[0]!),
    assertionExpectation(stateWinSpec.asserts[1]!),
    ...Array.from({ length: 10 }, () =>
      modelExpectation('stategame', 'e_collect', 'VarChange', [
        'Stage',
        'score',
        '+',
      ])
    ),
    modelExpectation('endwin', 'e_end', 'VarComp', [
      'Stage',
      'state',
      '==',
      'won',
    ]),
  ]
  const selectedRef = blockRef(
    broken,
    scoreWriter.targetIndex,
    scoreWriter.blockId
  )
  const topBlockId = owningTop(broken, scoreWriter)
  return {
    id: 'R1',
    healthy,
    broken,
    repairCase: {
      id: 'r1-score-increment',
      objective: 'Restore one score increment for each space-key collection.',
      tests: [
        failingTest('state-win', stateWinSpec, scoreFailures),
        passingTest('state-reset', stateResetSpec),
        passingTest('state-loss', stateLossSpec),
      ],
      policy: casePolicy('replaceLiteral', 1),
    },
    expectedLocalization: {
      block: selectedRef,
      script: { target: selectedRef.target, topBlockId },
    },
    referenceProposal: (request) =>
      proposal(
        request,
        [
          {
            opId: 'restore-score-increment',
            kind: 'replaceLiteral',
            block: selectedRef,
            inputName: 'VALUE',
            expectedOpcode: 'data_changevariableby',
            from: { kind: 'number', value: 0 },
            to: { kind: 'number', value: 1 },
          },
        ],
        'Each space-key event changes score by one again.'
      ),
  }
}

function r2(): RepairBenchmarkDefinition
{
  const healthy = buildStateGame()
  const broken = cloneProjectForRepair(healthy)
  const removed = uniqueBlock(
    broken,
    'Stage',
    true,
    (block) =>
      block.opcode === 'data_setvariableto' &&
      variableField(block, 'score') &&
      numberLiteralEquals(block, 'VALUE', 0)
  )
  const topBlockId = owningTop(broken, removed)
  deleteStatement(broken.json.targets[removed.targetIndex]!, removed.blockId)
  const anchor = blockRef(broken, removed.targetIndex, topBlockId)
  const score = Object.entries(
    broken.json.targets[removed.targetIndex]!.variables
  ).find(([, value]) => value[0] === 'score')
  if (!score) throw new Error('state game score declaration not found')
  const declaration = variableRef(broken, removed.targetIndex, score[0])
  return {
    id: 'R2',
    healthy,
    broken,
    repairCase: {
      id: 'r2-green-flag-reset',
      objective: 'Restore score reset inside the existing green-flag script.',
      tests: [
        failingTest('state-reset', stateResetSpec, [
          assertionExpectation(stateResetSpec.asserts[0]!),
        ]),
        passingTest('state-win', stateWinSpec),
        passingTest('state-loss', stateLossSpec),
      ],
      policy: casePolicy('insertStatementsAfter', 3),
    },
    expectedLocalization: {
      block: null,
      script: { target: anchor.target, topBlockId },
    },
    referenceProposal: (request) =>
      proposal(
        request,
        [
          {
            opId: 'restore-score-reset',
            kind: 'insertStatementsAfter',
            anchor,
            expectedOpcode: 'event_whenflagclicked',
            statements: [
              {
                opcode: 'data_setvariableto',
                fields: { VARIABLE: declaration },
                inputs: { VALUE: { kind: 'number', value: 0 } },
              },
            ],
          },
        ],
        'The existing green-flag chain resets score before other state.'
      ),
  }
}

function buildRelayWithWrong(): { project: ProjectIR; wrongId: string }
{
  const project = buildRelay()
  const wrongId = project.stage!.addBroadcast('wrong')
  return { project, wrongId }
}

function r3(): RepairBenchmarkDefinition
{
  const built = buildRelayWithWrong()
  const healthy = built.project
  const go = Object.entries(healthy.stage!.raw.broadcasts ?? {}).find(
    ([, name]) => name === 'go'
  )
  if (!go) throw new Error('relay go broadcast not found')
  const broken = cloneProjectForRepair(healthy)
  const sender = uniqueBlock(
    broken,
    'Sender',
    false,
    (block) => block.opcode === 'event_broadcast'
  )
  sender.block.inputs!.BROADCAST_INPUT = [1, [11, 'wrong', built.wrongId]]
  const receiver = uniqueBlock(
    broken,
    'Receiver',
    false,
    (block) => block.opcode === 'event_whenbroadcastreceived'
  )
  const senderRef = blockRef(broken, sender.targetIndex, sender.blockId)
  const receiverRef = blockRef(broken, receiver.targetIndex, receiver.blockId)
  const topBlockId = owningTop(broken, sender)
  return {
    id: 'R3',
    healthy,
    broken,
    repairCase: {
      id: 'r3-broadcast-wiring',
      objective: 'Reconnect Sender to the declared go broadcast.',
      tests: [
        failingTest('relay-movement', relayMovementSpec, [
          assertionExpectation(relayMovementSpec.asserts[0]!),
          {
            kind: 'diagnostic',
            source: 'static',
            code: 'message-never-received',
            locations: [{ kind: 'block', block: senderRef }],
          },
          {
            kind: 'diagnostic',
            source: 'static',
            code: 'message-never-sent',
            locations: [{ kind: 'block', block: receiverRef }],
          },
        ]),
      ],
      policy: casePolicy('replaceBroadcastRef', 1),
    },
    expectedLocalization: {
      block: senderRef,
      script: { target: senderRef.target, topBlockId },
    },
    referenceProposal: (request) =>
      proposal(
        request,
        [
          {
            opId: 'reconnect-go-broadcast',
            kind: 'replaceBroadcastRef',
            block: senderRef,
            expectedOpcode: 'event_broadcast',
            site: { container: 'input', name: 'BROADCAST_INPUT' },
            from: broadcastRef(
              broken,
              namedTarget(broken, 'Stage', true).targetIndex,
              built.wrongId
            ),
            to: broadcastRef(
              broken,
              namedTarget(broken, 'Stage', true).targetIndex,
              go[0]
            ),
          },
        ],
        'Sender broadcasts go and the existing Receiver hat runs.'
      ),
  }
}

function r4(): RepairBenchmarkDefinition
{
  const healthy = buildStateGame()
  const broken = cloneProjectForRepair(healthy)
  const comparator = uniqueBlock(
    broken,
    'Stage',
    true,
    (block) => block.opcode === 'operator_lt'
  )
  comparator.block.opcode = 'operator_gt'
  const comparatorRef = blockRef(
    broken,
    comparator.targetIndex,
    comparator.blockId
  )
  const topBlockId = owningTop(broken, comparator)
  return {
    id: 'R4',
    healthy,
    broken,
    repairCase: {
      id: 'r4-loss-comparator',
      objective: 'Restore the loss transition only when lives fall below one.',
      tests: [
        failingTest('state-win', stateWinSpec, [
          assertionExpectation(stateWinSpec.asserts[1]!),
          modelExpectation('endwin', 'e_end', 'VarComp', [
            'Stage',
            'state',
            '==',
            'won',
          ]),
        ]),
        failingTest('state-reset', stateResetSpec, [
          assertionExpectation(stateResetSpec.asserts[2]!),
        ]),
        failingTest('state-loss', stateLossSpec, [
          assertionExpectation(stateLossSpec.asserts[1]!),
          assertionExpectation(stateLossSpec.asserts[3]!),
          assertionExpectation(stateLossSpec.asserts[5]!),
        ]),
      ],
      policy: casePolicy('replaceCompatibleOpcode', 1),
    },
    expectedLocalization: {
      block: comparatorRef,
      script: { target: comparatorRef.target, topBlockId },
    },
    referenceProposal: (request) =>
      proposal(
        request,
        [
          {
            opId: 'restore-loss-comparator',
            kind: 'replaceCompatibleOpcode',
            block: comparatorRef,
            fromOpcode: 'operator_gt',
            toOpcode: 'operator_lt',
          },
        ],
        'The loss branch runs at lives zero, not immediately.'
      ),
  }
}

function r5(): RepairBenchmarkDefinition
{
  const healthy = buildCollector()
  const broken = cloneProjectForRepair(healthy)
  const falling = uniqueBlock(
    broken,
    'Item',
    false,
    (block) =>
      block.opcode === 'motion_changeyby' &&
      numberLiteralEquals(block, 'DY', -10)
  )
  replaceNumberLiteral(falling.block, 'DY', 0)
  const fallingRef = blockRef(broken, falling.targetIndex, falling.blockId)
  const topBlockId = owningTop(broken, falling)
  return {
    id: 'R5',
    healthy,
    broken,
    repairCase: {
      id: 'r5-collector-renderer',
      objective: 'Restore the Item fall rate required for renderer collision.',
      tests: [
        failingTest('collector-renderer', collectorRendererSpec, [
          visualExpectation(collectorRendererSpec.visual![0]!),
          visualExpectation(collectorRendererSpec.visual![4]!),
        ]),
      ],
      policy: casePolicy('replaceLiteral', 1),
    },
    expectedLocalization: {
      block: fallingRef,
      script: { target: fallingRef.target, topBlockId },
    },
    referenceProposal: (request) =>
      proposal(
        request,
        [
          {
            opId: 'restore-item-fall-rate',
            kind: 'replaceLiteral',
            block: fallingRef,
            inputName: 'DY',
            expectedOpcode: 'motion_changeyby',
            from: { kind: 'number', value: 0 },
            to: { kind: 'number', value: -10 },
          },
        ],
        'The Item falls into the Player during the renderer scenario.'
      ),
  }
}

export function buildRepairBenchmark(
  id: RepairBenchmarkId
): RepairBenchmarkDefinition
{
  switch (id)
  {
    case 'R1':
      return r1()
    case 'R2':
      return r2()
    case 'R3':
      return r3()
    case 'R4':
      return r4()
    case 'R5':
      return r5()
  }
}

export function assertRepairBenchmarkCorpus(
  actualIds: readonly unknown[],
  expectedIds: readonly string[]
): void
{
  const received = actualIds.every((id) => typeof id === 'string')
    ? (actualIds as readonly string[]).join(', ') || '(empty)'
    : JSON.stringify(actualIds)
  const exactOrder =
    actualIds.length === expectedIds.length &&
    actualIds.every((id, index) => id === expectedIds[index])
  const unique = new Set(actualIds).size === actualIds.length
  if (!exactOrder || !unique)
  {
    throw new Error(
      `canonical repair corpus mismatch: expected ${expectedIds.join(', ')}, received ${received}`
    )
  }
}

export function canonicalRepairBenchmarks(): RepairBenchmarkDefinition[]
{
  return REPAIR_BENCHMARK_IDS.map(buildRepairBenchmark)
}
