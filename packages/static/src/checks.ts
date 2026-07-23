// packages/static/src/checks.ts
// run advisory checks for wiring, reachability, declarations, & literals

import {
  scratchRecordEntries,
  scratchRecordValue,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'
import {
  isBlock,
  type Diagnostics,
  type ProjectIndex,
} from '@scratch-agent/validate'

import {
  broadcastReceivedName,
  broadcastSentName,
  eachBlock,
  isHat,
  isLiteralPrimitive,
  primarySlot,
} from './helpers.js'

const COMPARISONS = new Set(['operator_equals', 'operator_gt', 'operator_lt'])
const SWITCH_BACKDROP = new Set([
  'looks_switchbackdropto',
  'looks_switchbackdroptoandwait',
])
// non-costume menu options that are always valid for switch-backdrop
const BACKDROP_KEYWORDS = new Set([
  'next backdrop',
  'previous backdrop',
  'random backdrop',
])

interface Facts
{
  sentNames: Set<string>
  receivedNames: Set<string>
  hasDynamicSend: boolean
  referencedVarIds: Set<string>
  callProccodes: Map<Target, Set<string>>
}

// one pass gathering the cross-block facts the checks need
function gather(json: ProjectJson): Facts
{
  const sentNames = new Set<string>()
  const receivedNames = new Set<string>()
  const referencedVarIds = new Set<string>()
  const callProccodes = new Map<Target, Set<string>>()
  let hasDynamicSend = false

  for (const target of json.targets)
  {
    const calls = new Set<string>()
    callProccodes.set(target, calls)

    for (const [, entry] of scratchRecordEntries(target.blocks))
    {
      if (!isBlock(entry))
      {
        // bare top-level var reporter: [12, name, id, x, y]
        if (entry[0] === 12) referencedVarIds.add(String(entry[2]))
        continue
      }
      const varField = scratchRecordValue(entry.fields, 'VARIABLE')
      if (varField && typeof varField[1] === 'string')
        referencedVarIds.add(varField[1])
      for (const [, input] of scratchRecordEntries(entry.inputs))
      {
        const slot = primarySlot(input)
        if (Array.isArray(slot) && slot[0] === 12)
          referencedVarIds.add(String(slot[2]))
      }
      if (
        entry.opcode === 'event_broadcast' ||
        entry.opcode === 'event_broadcastandwait'
      )
      {
        const ref = broadcastSentName(entry, target.blocks)
        if (ref.dynamic) hasDynamicSend = true
        else if (ref.name) sentNames.add(ref.name)
      }
      if (entry.opcode === 'event_whenbroadcastreceived')
      {
        const name = broadcastReceivedName(entry)
        if (name) receivedNames.add(name)
      }
      if (
        entry.opcode === 'procedures_call' &&
        typeof entry.mutation?.proccode === 'string'
      )
      {
        calls.add(entry.mutation.proccode)
      }
    }
  }

  for (const monitor of json.monitors ?? [])
  {
    if (monitor.opcode === 'data_variable') referencedVarIds.add(monitor.id)
  }

  return {
    sentNames,
    receivedNames,
    hasDynamicSend,
    referencedVarIds,
    callProccodes,
  }
}

export function runStaticChecks(
  json: ProjectJson,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const facts = gather(json)

  checkBroadcasts(json, facts, diags)
  checkUnusedVariables(json, facts, diags)
  checkUnusedCustomBlocks(json, facts, diags)
  checkScripts(json, diags)
  checkHideWithoutShow(json, diags)
  checkComparisons(json, diags)
  checkMissingBackdrops(json, index, diags)
  checkAmbiguousSignatures(json, index, diags)
}

function checkBroadcasts(
  json: ProjectJson,
  facts: Facts,
  diags: Diagnostics
): void
{
  eachBlock(json, (target, id, block) =>
  {
    if (
      block.opcode === 'event_broadcast' ||
      block.opcode === 'event_broadcastandwait'
    )
    {
      const ref = broadcastSentName(block, target.blocks)
      if (!ref.dynamic && ref.name && !facts.receivedNames.has(ref.name))
      {
        diags.warn(
          'message-never-received',
          `broadcast "${ref.name}" has no matching "when I receive" hat`,
          { target: target.name, block: id }
        )
      }
    }
    // a dynamic broadcast could send any message, so one anywhere suppresses this
    // project-wide check to stay false-positive-safe
    if (
      block.opcode === 'event_whenbroadcastreceived' &&
      !facts.hasDynamicSend
    )
    {
      const name = broadcastReceivedName(block)
      if (name && !facts.sentNames.has(name))
      {
        diags.warn(
          'message-never-sent',
          `nothing ever broadcasts "${name}", so this hat never runs`,
          { target: target.name, block: id }
        )
      }
    }
  })
}

function checkUnusedVariables(
  json: ProjectJson,
  facts: Facts,
  diags: Diagnostics
): void
{
  for (const target of json.targets)
  {
    for (const [varId, entry] of scratchRecordEntries(target.variables))
    {
      if (!facts.referencedVarIds.has(varId))
      {
        diags.info(
          'unused-variable',
          `variable "${entry[0]}" is declared but never used`,
          { target: target.name }
        )
      }
    }
  }
}

function checkUnusedCustomBlocks(
  json: ProjectJson,
  facts: Facts,
  diags: Diagnostics
): void
{
  for (const target of json.targets)
  {
    const calls = facts.callProccodes.get(target) ?? new Set<string>()
    for (const [id, entry] of scratchRecordEntries(target.blocks))
    {
      if (!isBlock(entry) || entry.opcode !== 'procedures_prototype') continue
      const proccode = entry.mutation?.proccode
      if (typeof proccode === 'string' && !calls.has(proccode))
      {
        diags.info(
          'unused-custom-block',
          `custom block "${proccode}" is defined but never called`,
          { target: target.name, block: id }
        )
      }
    }
  }
}

// dead code: detached non-hat stacks; empty-script: a hat w/ no body;
// empty-control-body: a loop/if whose substack is empty
function checkScripts(json: ProjectJson, diags: Diagnostics): void
{
  eachBlock(json, (target, id, block) =>
  {
    const loc = { target: target.name, block: id }
    if (block.topLevel === true && block.shadow !== true)
    {
      if (isHat(block.opcode))
      {
        if (block.opcode !== 'procedures_definition' && block.next == null)
        {
          diags.info(
            'empty-script',
            `${block.opcode} has no blocks under it`,
            loc
          )
        }
      }
      else if (
        block.opcode !== 'procedures_prototype' &&
        !block.opcode.startsWith('argument_reporter') &&
        !isReporterOpcode(block.opcode)
      )
      {
        diags.info(
          'dead-code',
          `detached stack starting with ${block.opcode} has no hat & never runs`,
          loc
        )
      }
    }

    for (const input of substackInputs(block.opcode))
    {
      const substack = scratchRecordValue(block.inputs, input.name)
      if (substack && primarySlot(substack) == null)
      {
        diags.info(
          'empty-control-body',
          `${block.opcode} has an empty ${input.label} body`,
          loc
        )
      }
    }
  })
}

function isReporterOpcode(opcode: string): boolean
{
  return (
    opcode.startsWith('operator_') ||
    opcode.startsWith('sensing_') ||
    opcode.startsWith('argument_')
  )
}

function substackInputs(opcode: string): { name: string; label: string }[]
{
  if (opcode === 'control_if_else')
  {
    return [
      { name: 'SUBSTACK', label: 'if' },
      { name: 'SUBSTACK2', label: 'else' },
    ]
  }
  if (
    opcode === 'control_if' ||
    opcode === 'control_repeat' ||
    opcode === 'control_forever' ||
    opcode === 'control_repeat_until' ||
    opcode === 'control_while'
  )
  {
    return [{ name: 'SUBSTACK', label: 'body' }]
  }
  return []
}

function checkHideWithoutShow(json: ProjectJson, diags: Diagnostics): void
{
  for (const target of json.targets)
  {
    if (target.isStage) continue
    let hides = 0
    let shows = 0
    for (const [, entry] of scratchRecordEntries(target.blocks))
    {
      if (!isBlock(entry)) continue
      if (entry.opcode === 'looks_hide') hides++
      if (entry.opcode === 'looks_show') shows++
    }
    if (hides > 0 && shows === 0)
    {
      diags.warn(
        'hide-without-show',
        `sprite hides but never shows; it may stay invisible`,
        { target: target.name }
      )
    }
  }
}

function checkComparisons(json: ProjectJson, diags: Diagnostics): void
{
  eachBlock(json, (target, id, block) =>
  {
    if (!COMPARISONS.has(block.opcode)) return
    const a = scratchRecordValue(block.inputs, 'OPERAND1')
    const b = scratchRecordValue(block.inputs, 'OPERAND2')
    if (
      a &&
      b &&
      isLiteralPrimitive(primarySlot(a)) &&
      isLiteralPrimitive(primarySlot(b))
    )
    {
      diags.warn(
        'comparing-literals',
        `${block.opcode} compares two constants; the result never changes`,
        { target: target.name, block: id }
      )
    }
  })
}

// switching to a backdrop the Stage does not have (skips reporter/keyword targets)
function checkMissingBackdrops(
  json: ProjectJson,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const names = new Set((index.stage?.costumes ?? []).map((c) => c.name))
  eachBlock(json, (target, id, block) =>
  {
    if (!SWITCH_BACKDROP.has(block.opcode)) return
    const input = scratchRecordValue(block.inputs, 'BACKDROP')
    if (!input) return
    const slot = primarySlot(input)
    let name: string | null = null
    if (Array.isArray(slot) && slot[0] === 10) name = String(slot[1] ?? '')
    else if (typeof slot === 'string')
    {
      const menu = scratchRecordValue(target.blocks, slot)
      if (isBlock(menu))
      {
        const field = scratchRecordValue(menu.fields, 'BACKDROP')
        if (field) name = String(field[0] ?? '')
      }
    }
    if (!name || BACKDROP_KEYWORDS.has(name)) return
    if (!names.has(name))
    {
      diags.warn(
        'missing-backdrop',
        `switches to backdrop "${name}" that the Stage does not have`,
        { target: target.name, block: id }
      )
    }
  })
}

function checkAmbiguousSignatures(
  json: ProjectJson,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  for (const target of json.targets)
  {
    const protos = index.perTarget.get(target)?.prototypes
    if (!protos) continue
    for (const [proccode, ids] of protos)
    {
      if (ids.length > 1)
      {
        diags.warn(
          'ambiguous-custom-block-signature',
          `custom block "${proccode}" is defined ${ids.length} times in this sprite`,
          { target: target.name, block: ids[0] }
        )
      }
    }
  }
}
