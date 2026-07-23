// packages/localize/src/structural/localize.ts
// deterministically rank failure-related scripts & bounded evidence context

import {
  ownRecordValue,
  type BlockRef,
  type DeclarationRef,
  type ListRef,
  type ScriptRef,
  type TargetRef,
  type VariableRef,
} from '@scratch-agent/ir'
import type {
  DiagnosticFailure,
  NormalizedFailure,
  Probe,
  RepairTestSpec,
} from '@scratch-agent/eval'
import { isBlockEntry } from '@scratch-agent/sb3'

import { buildScriptContext } from './context.js'
import { buildLocalizationIndexes } from './indexes.js'
import {
  blockKey,
  declarationKey,
  scriptKey,
  type BroadcastUse,
  type DeclarationUse,
  type IndexedBlock,
  type IndexedDeclaration,
  type IndexedScript,
  type LocalizationIndexes,
} from './types.js'
import type {
  LocalizationCandidate,
  LocalizationConfidence,
  LocalizationInput,
  LocalizationReason,
  LocalizationReport,
  UnresolvedLocalizationSignal,
} from './report-types.js'

const DEFAULT_MAX_CANDIDATES = 8
const DEFAULT_MAX_CONTEXT_BLOCKS = 48
const HARD_MAX_CANDIDATES = 64
const HARD_MAX_CONTEXT_BLOCKS = 256
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const KEY_ALIASES: Readonly<Record<string, string>> = {
  arrowright: 'right arrow',
  right: 'right arrow',
  'right arrow': 'right arrow',
  arrowleft: 'left arrow',
  left: 'left arrow',
  'left arrow': 'left arrow',
  arrowup: 'up arrow',
  up: 'up arrow',
  'up arrow': 'up arrow',
  arrowdown: 'down arrow',
  down: 'down arrow',
  'down arrow': 'down arrow',
  spacebar: 'space',
  ' ': 'space',
}

interface MutableCandidate
{
  script: ScriptRef
  reasons: Map<string, LocalizationReason>
  implicatedScores: Map<string, { block: BlockRef; score: number }>
  ambiguous: boolean
}

interface FailureSet
{
  ordered: NormalizedFailure[]
  occurrences: Map<string, number>
  currentFingerprints: Set<string>
  diagnosticFingerprints: Set<string>
}

type AnyIndexedDeclaration =
  IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>

function compareText(a: string, b: string): number
{
  return a < b ? -1 : a > b ? 1 : 0
}

function canonical(value: unknown): string
{
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(',')}}`
}

function sameTarget(a: TargetRef, b: TargetRef): boolean
{
  return (
    a.targetIndex === b.targetIndex &&
    a.name === b.name &&
    a.isStage === b.isStage
  )
}

function sameBlock(a: BlockRef, b: BlockRef): boolean
{
  return sameTarget(a.target, b.target) && a.blockId === b.blockId
}

function sameScript(a: ScriptRef, b: ScriptRef): boolean
{
  return sameTarget(a.target, b.target) && a.topBlockId === b.topBlockId
}

function compareBlock(a: BlockRef, b: BlockRef): number
{
  return (
    a.target.targetIndex - b.target.targetIndex ||
    compareText(a.target.name, b.target.name) ||
    Number(a.target.isStage) - Number(b.target.isStage) ||
    compareText(a.blockId, b.blockId)
  )
}

function uniqueBlocks(blocks: readonly BlockRef[]): BlockRef[]
{
  const byKey = new Map<string, BlockRef>()
  for (const block of blocks) byKey.set(blockKey(block), block)
  return [...byKey.values()].sort(compareBlock)
}

function validLimit(
  value: number | undefined,
  fallback: number,
  hardMaximum: number,
  name: string,
  unresolved: UnresolvedLocalizationSignal[]
): number
{
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0 || value > hardMaximum)
  {
    unresolved.push({
      source: 'index',
      sourceFingerprint: null,
      reasonCode: 'invalid-localization-limit',
      detail: `${name} must be a positive safe integer at most ${hardMaximum}`,
      relatedBlocks: [],
      relatedScripts: [],
    })
    return fallback
  }
  return value
}

function collectFailures(input: LocalizationInput): FailureSet
{
  const failureCounts = new Map<string, number>()
  const diagnosticCounts = new Map<string, number>()
  for (const failure of input.failures)
  {
    failureCounts.set(
      failure.fingerprint,
      (failureCounts.get(failure.fingerprint) ?? 0) + 1
    )
  }
  for (const diagnostic of input.diagnostics ?? [])
  {
    diagnosticCounts.set(
      diagnostic.fingerprint,
      (diagnosticCounts.get(diagnostic.fingerprint) ?? 0) + 1
    )
  }
  const unique = new Map<string, NormalizedFailure>()
  for (const failure of input.failures) unique.set(failure.fingerprint, failure)
  for (const diagnostic of input.diagnostics ?? [])
    if (!unique.has(diagnostic.fingerprint))
      unique.set(diagnostic.fingerprint, diagnostic)
  const occurrences = new Map<string, number>()
  for (const fingerprint of unique.keys())
  {
    occurrences.set(
      fingerprint,
      Math.max(
        failureCounts.get(fingerprint) ?? 0,
        diagnosticCounts.get(fingerprint) ?? 0
      )
    )
  }
  return {
    ordered: [...unique.values()].sort((a, b) =>
      compareText(a.fingerprint, b.fingerprint)
    ),
    occurrences,
    currentFingerprints: new Set(failureCounts.keys()),
    diagnosticFingerprints: new Set(diagnosticCounts.keys()),
  }
}

function testFor(
  tests: readonly RepairTestSpec[],
  testId: string
): RepairTestSpec | null
{
  const matches = tests.filter((test) => test.id === testId)
  return matches.length === 1 ? matches[0]! : null
}

function registeredFailure(
  failure: NormalizedFailure,
  tests: readonly RepairTestSpec[]
): boolean
{
  if (failure.kind === 'schema' || failure.kind === 'diagnostic') return true
  const test = testFor(tests, failure.testId)
  if (!test) return false
  if (failure.kind === 'run') return true
  if (failure.kind === 'assertion' || failure.kind === 'visual')
  {
    const assertions =
      failure.kind === 'assertion' ? test.asserts : (test.visual ?? [])
    return assertions.some(
      (assertion) =>
        assertion.at === failure.snapshot &&
        canonical(assertion.probe) === canonical(failure.probe) &&
        canonical(assertion.match) === canonical(failure.matcher)
    )
  }
  const models = test.model
    ? [...test.model.programModels, ...test.model.endModels]
    : []
  const model = models.filter((entry) => entry.id === failure.modelId)
  if (model.length !== 1) return false
  const edge = model[0]!.edges.filter((entry) => entry.id === failure.edgeId)
  if (edge.length !== 1) return false
  const checks =
    failure.phase === 'condition' ? edge[0]!.conditions : edge[0]!.effects
  return checks.some(
    (check) =>
      check.name === failure.checkName &&
      check.negated === failure.checkNegated &&
      canonical(check.args) === canonical(failure.checkArgs)
  )
}

function snapshotSteps(
  failure: NormalizedFailure,
  test: RepairTestSpec
): RepairTestSpec['scenario']['steps']
{
  if (failure.kind !== 'assertion' && failure.kind !== 'visual')
    return test.scenario.steps
  const index = test.scenario.steps.findIndex(
    (step) => step.do === 'snapshot' && step.label === failure.snapshot
  )
  return index < 0 ? [] : test.scenario.steps.slice(0, index + 1)
}

function canonKey(value: string): string
{
  const key = value.trim().toLowerCase().replaceAll('_', ' ')
  return KEY_ALIASES[key] ?? key
}

function eventScriptMatches(
  project: LocalizationInput['project'],
  script: IndexedScript,
  failure: NormalizedFailure,
  test: RepairTestSpec
): boolean
{
  const target = project.json.targets[script.ref.target.targetIndex]
  const top = target
    ? ownRecordValue(target.blocks, script.ref.topBlockId)
    : undefined
  if (!top || !isBlockEntry(top)) return false
  const steps = snapshotSteps(failure, test)
  for (const step of steps)
  {
    if (step.do === 'greenFlag' && top.opcode === 'event_whenflagclicked')
      return true
    if (
      (step.do === 'keyDown' ||
        step.do === 'pressKey' ||
        step.do === 'tapKey') &&
      top.opcode === 'event_whenkeypressed'
    )
    {
      const expected = canonKey(step.key)
      const actual = canonKey(
        String(ownRecordValue(top.fields, 'KEY_OPTION')?.[0] ?? '')
      )
      if (actual === expected || actual === 'any') return true
    }
    if (
      step.do === 'clickSprite' &&
      !script.ref.target.isStage &&
      script.ref.target.name === step.sprite &&
      top.opcode === 'event_whenthisspriteclicked'
    )
      return true
    if (
      step.do === 'clickStage' &&
      script.ref.target.isStage &&
      top.opcode === 'event_whenstageclicked'
    )
      return true
    if (
      (step.do === 'broadcast' || step.do === 'broadcastAndWait') &&
      top.opcode === 'event_whenbroadcastreceived' &&
      String(ownRecordValue(top.fields, 'BROADCAST_OPTION')?.[0] ?? '') ===
        step.name
    )
      return true
  }
  return false
}

function modelTargetAndSymbol(
  failure: Extract<NormalizedFailure, { kind: 'model' }>
): { target: string; symbol: string } | null
{
  if (failure.checkName !== 'VarComp' && failure.checkName !== 'VarChange')
    return null
  if (
    typeof failure.checkArgs[0] !== 'string' ||
    typeof failure.checkArgs[1] !== 'string'
  )
    return null
  return { target: failure.checkArgs[0], symbol: failure.checkArgs[1] }
}

function declarationMatchesTarget(
  declaration: AnyIndexedDeclaration,
  target: TargetRef,
  name: string
): boolean
{
  return (
    sameTarget(declaration.declaration.declarationTarget, target) &&
    declaration.declaration.name === name
  )
}

function assertionDeclarations(
  indexes: LocalizationIndexes,
  kind: 'variable' | 'list',
  ownerName: string,
  name: string
): AnyIndexedDeclaration[]
{
  const targets = indexes.targets.filter(
    (target) =>
      target.name === ownerName &&
      (ownerName === 'Stage' ? target.isStage : !target.isStage)
  )
  const declarations = kind === 'variable' ? indexes.variables : indexes.lists
  return declarations.filter((declaration) =>
    targets.some((target) =>
      declarationMatchesTarget(declaration, target, name)
    )
  )
}

function modelDeclarations(
  indexes: LocalizationIndexes,
  targetName: string,
  name: string
): AnyIndexedDeclaration[]
{
  const targets = indexes.targets.filter((target) => target.name === targetName)
  const locals = indexes.variables.filter((declaration) =>
    targets.some((target) =>
      declarationMatchesTarget(declaration, target, name)
    )
  )
  if (locals.length > 0) return locals
  return indexes.variables.filter(
    (declaration) =>
      declaration.declaration.declarationTarget.isStage &&
      declaration.declaration.name === name
  )
}

function writerCompatible(
  project: LocalizationInput['project'],
  writer: DeclarationUse,
  failure: NormalizedFailure
): boolean
{
  if (failure.kind !== 'model' || failure.checkName !== 'VarChange') return true
  const target = project.json.targets[writer.block.target.targetIndex]
  const entry = target
    ? ownRecordValue(target.blocks, writer.block.blockId)
    : undefined
  return isBlockEntry(entry) && entry.opcode === 'data_changevariableby'
}

function opcodeRelatedToProbe(opcode: string, probe: Probe): boolean
{
  switch (probe.on)
  {
    case 'prop':
      if (probe.prop === 'x' || probe.prop === 'y')
        return opcode.startsWith('motion_')
      if (probe.prop === 'direction') return opcode.startsWith('motion_point')
      if (probe.prop === 'costume') return opcode.includes('costume')
      if (probe.prop === 'visible')
        return opcode === 'looks_show' || opcode === 'looks_hide'
      if (probe.prop === 'size') return opcode.includes('size')
      if (probe.prop === 'rotationStyle')
        return opcode === 'motion_setrotationstyle'
      if (probe.prop === 'volume') return opcode.includes('volume')
      if (probe.prop === 'draggable') return opcode === 'sensing_setdragmode'
      return false
    case 'said':
      return opcode.startsWith('looks_say') || opcode.startsWith('looks_think')
    case 'spriteRect':
    case 'spriteInRegion':
      return opcode.startsWith('motion_') || opcode.startsWith('looks_')
    case 'timer':
      return opcode === 'sensing_resettimer'
    case 'answer':
      return opcode === 'sensing_askandwait'
    default:
      return false
  }
}

export function localizeFailures(input: LocalizationInput): LocalizationReport
{
  const indexes = buildLocalizationIndexes(input.project)
  const unresolved: UnresolvedLocalizationSignal[] = []
  const unresolvedKeys = new Set<string>()
  const addUnresolved = (entry: UnresolvedLocalizationSignal): void =>
  {
    const key = canonical(entry)
    if (unresolvedKeys.has(key)) return
    unresolvedKeys.add(key)
    unresolved.push(entry)
  }
  const baselineHashValid = SHA256_PATTERN.test(input.baselineArtifactSha256)
  if (!baselineHashValid)
  {
    addUnresolved({
      source: 'index',
      sourceFingerprint: null,
      reasonCode: 'invalid-baseline-artifact-hash',
      detail: 'baseline artifact hash must be lowercase SHA-256',
      relatedBlocks: [],
      relatedScripts: [],
    })
  }
  const maxCandidates = validLimit(
    input.maxCandidates,
    DEFAULT_MAX_CANDIDATES,
    HARD_MAX_CANDIDATES,
    'maxCandidates',
    unresolved
  )
  const maxContextBlocks = validLimit(
    input.maxContextBlocks,
    DEFAULT_MAX_CONTEXT_BLOCKS,
    HARD_MAX_CONTEXT_BLOCKS,
    'maxContextBlocks',
    unresolved
  )
  const failures = collectFailures(input)
  const candidates = new Map<string, MutableCandidate>()

  const candidateFor = (
    script: ScriptRef,
    ambiguous = false
  ): MutableCandidate | null =>
  {
    const indexed = indexes.scriptByKey.get(scriptKey(script))
    if (!indexed || !sameScript(indexed.ref, script)) return null
    const key = scriptKey(script)
    const existing = candidates.get(key)
    if (existing)
    {
      existing.ambiguous ||= ambiguous
      return existing
    }
    const created: MutableCandidate = {
      script,
      reasons: new Map(),
      implicatedScores: new Map(),
      ambiguous,
    }
    candidates.set(key, created)
    return created
  }

  const addReason = (
    candidate: MutableCandidate,
    reason: Omit<LocalizationReason, 'occurrences'>,
    implicated: BlockRef | null
  ): void =>
  {
    const key = `${reason.code}\u0000${reason.failureFingerprint}`
    const existing = candidate.reasons.get(key)
    const occurrences = failures.occurrences.get(reason.failureFingerprint) ?? 1
    if (existing)
    {
      existing.relatedBlocks = uniqueBlocks([
        ...existing.relatedBlocks,
        ...reason.relatedBlocks,
      ])
      if (!existing.declaration && reason.declaration)
        existing.declaration = reason.declaration
    }
    else
    {
      candidate.reasons.set(key, {
        ...reason,
        occurrences,
        relatedBlocks: uniqueBlocks(reason.relatedBlocks),
      })
    }
    if (implicated)
    {
      const block = candidate.implicatedScores.get(blockKey(implicated)) ?? {
        block: implicated,
        score: 0,
      }
      block.score += reason.score
      candidate.implicatedScores.set(blockKey(implicated), block)
    }
  }

  const addForScript = (
    script: ScriptRef,
    reason: Omit<LocalizationReason, 'occurrences'>,
    implicated: BlockRef | null = null,
    ambiguous = false
  ): void =>
  {
    const candidate = candidateFor(script, ambiguous)
    if (!candidate)
    {
      addUnresolved({
        source: 'index',
        sourceFingerprint: reason.failureFingerprint,
        reasonCode: 'script-ref-unresolved',
        detail: 'guarded script reference did not resolve',
        relatedBlocks: implicated ? [implicated] : [],
        relatedScripts: [script],
      })
      return
    }
    addReason(candidate, reason, implicated)
  }

  const addForBlock = (
    block: BlockRef,
    reason: Omit<LocalizationReason, 'occurrences'>
  ): void =>
  {
    const indexed = indexes.blockByKey.get(blockKey(block))
    if (!indexed || !sameBlock(indexed.ref, block))
    {
      addUnresolved({
        source: 'index',
        sourceFingerprint: reason.failureFingerprint,
        reasonCode: 'block-ref-unresolved',
        detail: 'guarded block reference did not resolve',
        relatedBlocks: [block],
        relatedScripts: [],
      })
      return
    }
    if (indexed.topScripts.length === 0)
    {
      addUnresolved({
        source: 'index',
        sourceFingerprint: reason.failureFingerprint,
        reasonCode: 'block-unowned',
        detail: 'block has no top-level script owner',
        relatedBlocks: [block],
        relatedScripts: [],
      })
      return
    }
    if (indexed.ownershipStatus === 'ambiguous')
    {
      addUnresolved({
        source: 'index',
        sourceFingerprint: reason.failureFingerprint,
        reasonCode: 'block-ownership-ambiguous',
        detail: 'block is reachable from multiple top-level scripts',
        relatedBlocks: [block],
        relatedScripts: [...indexed.topScripts],
      })
    }
    for (const script of indexed.topScripts)
      addForScript(
        script,
        reason,
        block,
        indexed.ownershipStatus === 'ambiguous'
      )
  }

  const addTarget = (
    target: TargetRef,
    failure: NormalizedFailure,
    detail: string
  ): void =>
  {
    const live = indexes.targets[target.targetIndex]
    if (!live || !sameTarget(live, target))
    {
      addUnresolved({
        source: 'index',
        sourceFingerprint: failure.fingerprint,
        reasonCode: 'target-ref-unresolved',
        detail: 'guarded target reference did not resolve',
        relatedBlocks: [],
        relatedScripts: [],
      })
      return
    }
    const all = indexes.scripts.filter((script) =>
      sameTarget(script.ref.target, target)
    )
    const test =
      'testId' in failure ? testFor(input.tests, failure.testId) : null
    const matched = test
      ? all.filter((script) =>
          eventScriptMatches(input.project, script, failure, test)
        )
      : []
    const selected = matched.length > 0 ? matched : all
    if (selected.length === 0)
    {
      addUnresolved({
        source: 'failure',
        sourceFingerprint: failure.fingerprint,
        reasonCode: 'named-target-has-no-script',
        detail,
        relatedBlocks: [],
        relatedScripts: [],
      })
      return
    }
    for (const script of selected)
    {
      addForScript(script.ref, {
        code: 'target-named',
        score: 40,
        failureFingerprint: failure.fingerprint,
        detail,
        relatedBlocks: [],
        declaration: null,
      })
    }
  }

  const addRelatedScripts = (
    scripts: readonly ScriptRef[],
    failure: NormalizedFailure,
    relatedBlocks: readonly BlockRef[],
    declaration: DeclarationRef | null,
    detail: string
  ): void =>
  {
    const unique = new Map<string, ScriptRef>()
    for (const script of scripts) unique.set(scriptKey(script), script)
    for (const script of unique.values())
    {
      addForScript(script, {
        code: 'related-symbol-script',
        score: 60,
        failureFingerprint: failure.fingerprint,
        detail,
        relatedBlocks: [...relatedBlocks],
        declaration,
      })
    }
  }

  const addDeclaration = (
    declaration: AnyIndexedDeclaration,
    failure: NormalizedFailure
  ): void =>
  {
    const writers = declaration.writers.filter((writer) =>
      writerCompatible(input.project, writer, failure)
    )
    const relevant = writers.length > 0 ? writers : declaration.writers
    const blocks = uniqueBlocks(relevant.map((writer) => writer.block))
    for (const writer of relevant)
    {
      addForBlock(writer.block, {
        code: 'declaration-writer',
        score: 80,
        failureFingerprint: failure.fingerprint,
        detail: `writer of ${declaration.declaration.kind} ${declaration.declaration.name}`,
        relatedBlocks: blocks,
        declaration: declaration.declaration,
      })
    }
    const scripts = relevant.flatMap((writer) =>
    {
      const indexed = indexes.blockByKey.get(blockKey(writer.block))
      return indexed?.topScripts ?? []
    })
    addRelatedScripts(
      scripts,
      failure,
      blocks,
      declaration.declaration,
      `script containing ${declaration.declaration.kind} ${declaration.declaration.name}`
    )
    addTarget(
      declaration.declaration.declarationTarget,
      failure,
      `target declaring ${declaration.declaration.kind} ${declaration.declaration.name}`
    )
  }

  const addBroadcastEdges = (
    indexed: IndexedBlock,
    failure: NormalizedFailure
  ): void =>
  {
    const uses: BroadcastUse[] = []
    for (const broadcast of indexes.broadcasts)
    {
      uses.push(
        ...broadcast.senders.filter((use) => sameBlock(use.block, indexed.ref)),
        ...broadcast.receivers.filter((use) =>
          sameBlock(use.block, indexed.ref)
        )
      )
    }
    for (const use of uses)
    {
      if (use.resolutionStatus !== 'resolved' || !use.declaration) continue
      const broadcast = indexes.broadcastByKey.get(
        declarationKey(use.declaration)
      )
      if (!broadcast) continue
      const peers = [...broadcast.senders, ...broadcast.receivers]
        .filter((peer) => peer.resolutionStatus === 'resolved')
        .map((peer) => peer.block)
      for (const peer of uniqueBlocks(peers))
      {
        addForBlock(peer, {
          code: 'broadcast-edge',
          score: 80,
          failureFingerprint: failure.fingerprint,
          detail: `resolved broadcast ${broadcast.declaration.name} edge`,
          relatedBlocks: peers,
          declaration: broadcast.declaration,
        })
      }
    }
  }

  const addProcedureEdges = (
    indexed: IndexedBlock,
    failure: NormalizedFailure
  ): void =>
  {
    const procedures = indexes.procedures.filter((procedure) =>
      [
        ...procedure.definitions,
        ...procedure.prototypes,
        ...procedure.calls,
      ].some((block) => sameBlock(block, indexed.ref))
    )
    for (const procedure of procedures)
    {
      const related = uniqueBlocks([
        ...procedure.definitions,
        ...procedure.prototypes,
        ...procedure.calls,
      ])
      for (const block of related)
      {
        addForBlock(block, {
          code: 'procedure-edge',
          score: 75,
          failureFingerprint: failure.fingerprint,
          detail: `procedure ${procedure.proccode} definition/call edge`,
          relatedBlocks: related,
          declaration: null,
        })
      }
    }
  }

  const expandExactBlock = (
    block: BlockRef,
    failure: NormalizedFailure
  ): void =>
  {
    const indexed = indexes.blockByKey.get(blockKey(block))
    if (!indexed) return
    const declarationUses = [...indexes.variables, ...indexes.lists].filter(
      (declaration) =>
        declaration.references.some((use) => sameBlock(use.block, block))
    )
    for (const declaration of declarationUses)
      addDeclaration(declaration, failure)
    addBroadcastEdges(indexed, failure)
    addProcedureEdges(indexed, failure)
  }

  const localizeDiagnostic = (failure: DiagnosticFailure): void =>
  {
    let resolved = false
    for (const location of failure.locations)
    {
      if (location.kind === 'block')
      {
        resolved = true
        addForBlock(location.block, {
          code: 'exact-diagnostic-block',
          score: 100,
          failureFingerprint: failure.fingerprint,
          detail: `${failure.source} diagnostic ${failure.code} exact block`,
          relatedBlocks: [location.block],
          declaration: null,
        })
        expandExactBlock(location.block, failure)
        if (failure.source === 'static' && failure.severity === 'warning')
        {
          const indexed = indexes.blockByKey.get(blockKey(location.block))
          if (indexed?.ownershipStatus === 'unique' && indexed.topScript)
          {
            addForScript(
              indexed.topScript,
              {
                code: 'supporting-static-warning',
                score: 20,
                failureFingerprint: failure.fingerprint,
                detail: `supporting static warning ${failure.code}`,
                relatedBlocks: [location.block],
                declaration: null,
              },
              location.block
            )
          }
        }
      }
      else if (location.kind === 'script')
      {
        resolved = true
        addForScript(location.script, {
          code: 'related-symbol-script',
          score: 60,
          failureFingerprint: failure.fingerprint,
          detail: `${failure.source} diagnostic ${failure.code} exact script`,
          relatedBlocks: [],
          declaration: null,
        })
      }
    }
    if (!resolved)
    {
      addUnresolved({
        source: 'supporting-diagnostic',
        sourceFingerprint: failure.fingerprint,
        reasonCode: 'diagnostic-location-not-code-bearing',
        detail: `${failure.source} diagnostic ${failure.code} has no block or script location`,
        relatedBlocks: [],
        relatedScripts: [],
      })
    }
  }

  const localizeRun = (
    failure: Extract<NormalizedFailure, { kind: 'run' }>
  ): void =>
  {
    if (failure.location?.kind === 'block')
    {
      addForBlock(failure.location.block, {
        code: 'exact-runtime-block',
        score: 100,
        failureFingerprint: failure.fingerprint,
        detail: `runtime issue ${failure.code} exact block`,
        relatedBlocks: [failure.location.block],
        declaration: null,
      })
      expandExactBlock(failure.location.block, failure)
      return
    }
    if (failure.location?.kind === 'script')
    {
      addForScript(failure.location.script, {
        code: 'related-symbol-script',
        score: 60,
        failureFingerprint: failure.fingerprint,
        detail: `runtime issue ${failure.code} exact script`,
        relatedBlocks: [],
        declaration: null,
      })
      return
    }
    addUnresolved({
      source: 'failure',
      sourceFingerprint: failure.fingerprint,
      reasonCode: 'runtime-location-not-code-bearing',
      detail: `runtime issue ${failure.code} has no block or script location`,
      relatedBlocks: [],
      relatedScripts: [],
    })
  }

  const localizeProbe = (
    failure: Extract<NormalizedFailure, { kind: 'assertion' | 'visual' }>
  ): void =>
  {
    const probe = failure.probe
    if (probe.on === 'var' || probe.on === 'list')
    {
      const owner = probe.sprite ?? 'Stage'
      const declarations = assertionDeclarations(
        indexes,
        probe.on === 'var' ? 'variable' : 'list',
        owner,
        probe.name
      )
      if (declarations.length === 0)
      {
        addUnresolved({
          source: 'failure',
          sourceFingerprint: failure.fingerprint,
          reasonCode: 'probe-declaration-unresolved',
          detail: `${probe.on} ${probe.name} on ${owner} did not resolve uniquely`,
          relatedBlocks: [],
          relatedScripts: [],
        })
      }
      for (const declaration of declarations)
        addDeclaration(declaration, failure)
      return
    }
    if (
      probe.on === 'prop' ||
      probe.on === 'said' ||
      probe.on === 'spriteRect' ||
      probe.on === 'spriteInRegion'
    )
    {
      const targets = indexes.targets.filter(
        (target) => !target.isStage && target.name === probe.sprite
      )
      for (const target of targets)
      {
        addTarget(target, failure, `probe names target ${probe.sprite}`)
        const scripts = indexes.scripts.filter(
          (script) =>
            sameTarget(script.ref.target, target) &&
            script.opcodes.some((opcode) => opcodeRelatedToProbe(opcode, probe))
        )
        addRelatedScripts(
          scripts.map((script) => script.ref),
          failure,
          [],
          null,
          `script related to ${probe.on} probe on ${probe.sprite}`
        )
      }
      if (targets.length === 0)
      {
        addUnresolved({
          source: 'failure',
          sourceFingerprint: failure.fingerprint,
          reasonCode: 'probe-target-unresolved',
          detail: `probe target ${probe.sprite} did not resolve`,
          relatedBlocks: [],
          relatedScripts: [],
        })
      }
      return
    }
    if (probe.on === 'timer' || probe.on === 'answer')
    {
      const scripts = indexes.scripts.filter((script) =>
        script.opcodes.some((opcode) => opcodeRelatedToProbe(opcode, probe))
      )
      addRelatedScripts(
        scripts.map((script) => script.ref),
        failure,
        [],
        null,
        `script related to ${probe.on} probe`
      )
      return
    }
    addUnresolved({
      source: 'failure',
      sourceFingerprint: failure.fingerprint,
      reasonCode: 'visual-region-has-no-code-target',
      detail: `${probe.on} evidence is region-only in Phase 6`,
      relatedBlocks: [],
      relatedScripts: [],
    })
  }

  const localizeModel = (
    failure: Extract<NormalizedFailure, { kind: 'model' }>
  ): void =>
  {
    const variable = modelTargetAndSymbol(failure)
    if (variable)
    {
      const declarations = modelDeclarations(
        indexes,
        variable.target,
        variable.symbol
      )
      if (declarations.length === 0)
      {
        addUnresolved({
          source: 'failure',
          sourceFingerprint: failure.fingerprint,
          reasonCode: 'model-declaration-unresolved',
          detail: `model variable ${variable.target}.${variable.symbol} did not resolve`,
          relatedBlocks: [],
          relatedScripts: [],
        })
      }
      for (const declaration of declarations)
        addDeclaration(declaration, failure)
      return
    }
    const targetNames = failure.checkArgs.filter(
      (arg): arg is string => typeof arg === 'string'
    )
    if (
      failure.checkName === 'AttrComp' ||
      failure.checkName === 'AttrChange' ||
      failure.checkName === 'Output' ||
      failure.checkName === 'Click' ||
      failure.checkName === 'SpriteTouching'
    )
    {
      for (const name of targetNames.slice(
        0,
        failure.checkName === 'SpriteTouching' ? 2 : 1
      ))
      {
        for (const target of indexes.targets.filter(
          (entry) => entry.name === name
        ))
          addTarget(
            target,
            failure,
            `model check ${failure.checkName} names ${name}`
          )
      }
      return
    }
    addUnresolved({
      source: 'failure',
      sourceFingerprint: failure.fingerprint,
      reasonCode: 'model-check-not-structurally-localizable',
      detail: `model check ${failure.checkName} has no Phase 6 structural mapping`,
      relatedBlocks: [],
      relatedScripts: [],
    })
  }

  for (const failure of failures.ordered)
  {
    if (!registeredFailure(failure, input.tests))
    {
      addUnresolved({
        source: 'test-context',
        sourceFingerprint: failure.fingerprint,
        reasonCode: 'failure-not-in-registered-test',
        detail:
          'failure did not resolve against immutable registered test context',
        relatedBlocks: [],
        relatedScripts: [],
      })
      continue
    }
    switch (failure.kind)
    {
      case 'schema':
        addUnresolved({
          source: 'failure',
          sourceFingerprint: failure.fingerprint,
          reasonCode: 'schema-failure-has-no-code-location',
          detail: `schema category ${failure.category} has no structural code location`,
          relatedBlocks: [],
          relatedScripts: [],
        })
        break
      case 'diagnostic':
        localizeDiagnostic(failure)
        break
      case 'run':
        localizeRun(failure)
        break
      case 'assertion':
      case 'visual':
        localizeProbe(failure)
        break
      case 'model':
        localizeModel(failure)
        break
    }
  }

  for (const signal of input.priorRejectedBlocks ?? [])
  {
    const current = signal.introducedFailureFingerprints.filter((fingerprint) =>
      failures.currentFingerprints.has(fingerprint)
    )
    if (
      !baselineHashValid ||
      signal.baselineArtifactSha256 !== input.baselineArtifactSha256 ||
      signal.attemptId.length === 0 ||
      current.length === 0
    )
    {
      addUnresolved({
        source: 'prior-patch',
        sourceFingerprint: current[0] ?? null,
        reasonCode: 'prior-patch-signal-rejected',
        detail:
          'prior patch signal did not bind to this baseline and current failure set',
        relatedBlocks: [signal.block],
        relatedScripts: [],
      })
      continue
    }
    for (const fingerprint of [...new Set(current)].sort(compareText))
    {
      addForBlock(signal.block, {
        code: 'prior-patch-new-failure',
        score: 20,
        failureFingerprint: fingerprint,
        detail: `prior attempt ${signal.attemptId} introduced current failure`,
        relatedBlocks: [signal.block],
        declaration: null,
      })
    }
  }

  const dynamicProviders = new Map<string, { id: string; version: string }>()
  for (const signal of input.dynamicCoverage ?? [])
  {
    const test = testFor(input.tests, signal.testId)
    const boundFailure = failures.ordered.find(
      (failure) => failure.fingerprint === signal.failureFingerprint
    )
    if (
      !baselineHashValid ||
      signal.schemaVersion !== 1 ||
      signal.baselineArtifactSha256 !== input.baselineArtifactSha256 ||
      !test ||
      !boundFailure ||
      !('testId' in boundFailure) ||
      boundFailure.testId !== signal.testId ||
      !failures.currentFingerprints.has(signal.failureFingerprint) ||
      signal.provider.id.length === 0 ||
      signal.provider.version.length === 0
    )
    {
      addUnresolved({
        source: 'dynamic',
        sourceFingerprint: signal.failureFingerprint || null,
        reasonCode: 'dynamic-signal-rejected',
        detail:
          'dynamic coverage did not bind to this baseline, test, and failure',
        relatedBlocks: [...signal.coveredBlocks],
        relatedScripts: [],
      })
      continue
    }
    dynamicProviders.set(
      `${signal.provider.id}\u0000${signal.provider.version}`,
      signal.provider
    )
    for (const block of signal.coveredBlocks)
    {
      const indexed = indexes.blockByKey.get(blockKey(block))
      if (!indexed || !sameBlock(indexed.ref, block))
      {
        addUnresolved({
          source: 'dynamic',
          sourceFingerprint: signal.failureFingerprint,
          reasonCode: 'dynamic-block-ref-unresolved',
          detail: 'dynamic coverage block did not resolve against the baseline',
          relatedBlocks: [block],
          relatedScripts: [],
        })
        continue
      }
      for (const script of indexed.topScripts)
      {
        const candidate = candidates.get(scriptKey(script))
        if (!candidate) continue
        addReason(
          candidate,
          {
            code: 'dynamic-covered',
            score: 0,
            failureFingerprint: signal.failureFingerprint,
            detail: `covered by ${signal.provider.id}@${signal.provider.version}`,
            relatedBlocks: [block],
            declaration: null,
          },
          null
        )
      }
    }
  }

  const ranked = [...candidates.values()].map((candidate) =>
  {
    const reasons = [...candidate.reasons.values()].sort(
      (a, b) =>
        b.score - a.score ||
        compareText(a.code, b.code) ||
        compareText(a.failureFingerprint, b.failureFingerprint)
    )
    const score = reasons.reduce((sum, reason) => sum + reason.score, 0)
    const implicated =
      [...candidate.implicatedScores.values()].sort(
        (a, b) => b.score - a.score || compareBlock(a.block, b.block)
      )[0]?.block ?? null
    const exact = reasons.some(
      (reason) =>
        reason.code === 'exact-diagnostic-block' ||
        reason.code === 'exact-runtime-block'
    )
    const dominant = reasons.some(
      (reason) =>
        (reason.code === 'declaration-writer' ||
          reason.code === 'broadcast-edge' ||
          reason.code === 'procedure-edge') &&
        reason.relatedBlocks.length === 1
    )
    const onlyTarget = reasons.every(
      (reason) =>
        reason.code === 'target-named' || reason.code === 'dynamic-covered'
    )
    const confidence: LocalizationConfidence =
      candidate.ambiguous || onlyTarget
        ? 'low'
        : exact || dominant
          ? 'high'
          : 'medium'
    return {
      rank: 0,
      score,
      confidence,
      script: candidate.script,
      implicatedBlock: implicated,
      reasons,
      sourceFailureFingerprints: [
        ...new Set(reasons.map((reason) => reason.failureFingerprint)),
      ].sort(compareText),
    } satisfies Omit<LocalizationCandidate, 'context'>
  })
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.script.target.targetIndex - b.script.target.targetIndex ||
      compareText(a.script.topBlockId, b.script.topBlockId) ||
      (a.implicatedBlock ? 0 : 1) - (b.implicatedBlock ? 0 : 1) ||
      compareText(
        a.implicatedBlock?.blockId ?? '',
        b.implicatedBlock?.blockId ?? ''
      ) ||
      compareText(scriptKey(a.script), scriptKey(b.script))
  )
  const omittedCandidateCount = Math.max(0, ranked.length - maxCandidates)
  const selected = ranked
    .slice(0, maxCandidates)
    .map((candidate, index): LocalizationCandidate => ({
      ...candidate,
      rank: index + 1,
      context: buildScriptContext(
        input.project,
        indexes,
        candidate.script,
        candidate.implicatedBlock,
        maxContextBlocks
      ),
    }))
  unresolved.sort(
    (a, b) =>
      compareText(a.source, b.source) ||
      compareText(a.reasonCode, b.reasonCode) ||
      compareText(a.sourceFingerprint ?? '', b.sourceFingerprint ?? '') ||
      compareText(canonical(a.relatedBlocks), canonical(b.relatedBlocks))
  )
  return {
    schemaVersion: 1,
    baselineArtifactSha256: input.baselineArtifactSha256,
    failures: [...failures.currentFingerprints].sort(compareText),
    diagnostics: [...failures.diagnosticFingerprints].sort(compareText),
    candidates: selected,
    unresolved,
    dynamicProviders: [...dynamicProviders.values()].sort(
      (a, b) => compareText(a.id, b.id) || compareText(a.version, b.version)
    ),
    limits: { maxCandidates, maxContextBlocks },
    omittedCandidateCount,
  }
}
