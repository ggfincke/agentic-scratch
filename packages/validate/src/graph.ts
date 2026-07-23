// packages/validate/src/graph.ts
// validate raw block-graph integrity w/ vm-tolerance severity

import type {
  Block,
  BlockInput,
  InputPrimitive,
  InputSlot,
  Mutation,
  ProjectJson,
  Target,
  TopLevelPrimitive,
} from '@scratch-agent/sb3'
import {
  hasScratchRecordKey,
  scratchRecordEntries,
  scratchRecordKeys,
  scratchRecordValue,
} from '@scratch-agent/sb3'

import type { Diagnostics } from './diagnostics.js'
import {
  isBlock,
  parseMutationArray,
  type ProjectIndex,
} from './project-index.js'

interface GraphOptions
{
  // asset filenames present in the .sb3 archive (md5ext); enables missing-asset
  assetPaths?: Set<string>
}

// block opcodes whose prefix maps to a built-in category (no extension entry needed)
const CORE_EXTENSIONS = new Set([
  'argument',
  'colour',
  'control',
  'data',
  'event',
  'looks',
  'math',
  'motion',
  'operator',
  'procedures',
  'sensing',
  'sound',
])

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export function validateGraph(
  json: ProjectJson,
  index: ProjectIndex,
  diags: Diagnostics,
  opts: GraphOptions = {}
): void
{
  checkStageInvariants(json, diags)
  checkSpriteNames(json, diags)
  checkExtensions(json, diags)
  for (const target of json.targets)
  {
    checkTargetBlocks(target, index, diags)
    checkCurrentCostume(target, diags)
    if (opts.assetPaths) checkAssets(target, opts.assetPaths, diags)
  }
  checkMonitors(json, index, diags)
}

// exactly one Stage, positioned first (globals resolve against it)
function checkStageInvariants(json: ProjectJson, diags: Diagnostics): void
{
  const stages = json.targets.filter((t) => t.isStage)
  if (stages.length !== 1)
  {
    diags.error(
      'stage-count',
      `expected exactly 1 Stage, found ${stages.length}`
    )
    return
  }
  if (!json.targets[0]?.isStage)
  {
    diags.error('stage-count', 'the Stage must be the first target')
  }
}

function checkSpriteNames(json: ProjectJson, diags: Diagnostics): void
{
  const seen = new Set<string>()
  for (const target of json.targets)
  {
    if (target.isStage) continue
    if (seen.has(target.name))
    {
      diags.warn(
        'duplicate-sprite-name',
        `more than one sprite is named "${target.name}"`,
        { target: target.name }
      )
    }
    seen.add(target.name)
  }
}

// every non-core opcode prefix needs an extensions[] entry; unused entries are drift
function checkExtensions(json: ProjectJson, diags: Diagnostics): void
{
  const declared = new Set(json.extensions ?? [])
  const used = new Set<string>()
  for (const target of json.targets)
  {
    for (const [, entry] of scratchRecordEntries(target.blocks))
    {
      if (!isBlock(entry)) continue
      const ext = extensionOf(entry.opcode)
      if (ext) used.add(ext)
    }
  }
  for (const ext of used)
  {
    if (!declared.has(ext))
    {
      diags.warn(
        'undeclared-extension',
        `blocks use extension "${ext}" but it is not listed in extensions[]`
      )
    }
  }
  for (const ext of declared)
  {
    if (!used.has(ext))
    {
      diags.info(
        'unused-extension',
        `extension "${ext}" is declared but no block uses it`
      )
    }
  }
}

function extensionOf(opcode: string): string | null
{
  const i = opcode.indexOf('_')
  if (i <= 0) return null
  const prefix = opcode.slice(0, i)
  return CORE_EXTENSIONS.has(prefix) ? null : prefix
}

function checkCurrentCostume(target: Target, diags: Diagnostics): void
{
  const idx = target.currentCostume
  if (idx === undefined) return
  const n = target.costumes.length
  if (idx < 0 || idx > n - 1)
  {
    diags.info(
      'current-costume-range',
      `currentCostume ${idx} is outside [0, ${n - 1}]; the VM will clamp it`,
      { target: target.name }
    )
  }
}

function checkAssets(
  target: Target,
  assetPaths: Set<string>,
  diags: Diagnostics
): void
{
  const assets = [...target.costumes, ...target.sounds]
  for (const asset of assets)
  {
    const path = asset.md5ext ?? `${asset.assetId}.${asset.dataFormat}`
    if (!assetPaths.has(path))
    {
      diags.warn(
        'missing-asset',
        `asset "${asset.name}" references ${path}, absent from the archive`,
        { target: target.name, asset: asset.name }
      )
    }
  }
}

function checkTargetBlocks(
  target: Target,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const blocks = target.blocks
  const argNames = targetArgumentNames(target)
  for (const [id, entry] of scratchRecordEntries(blocks))
  {
    if (!isBlock(entry))
    {
      checkTopLevelPrimitive(target, id, entry, index, diags)
      continue
    }
    checkBlock(target, id, entry, index, argNames, diags)
  }
  checkBlockOwnership(target, diags)
}

interface BlockOwner
{
  ownerId: string
  via: string
}

function checkBlockOwnership(target: Target, diags: Diagnostics): void
{
  const owners = collectBlockOwners(target)
  for (const [id, entry] of scratchRecordEntries(target.blocks))
  {
    if (!isBlock(entry)) continue
    if (entry.topLevel === true || entry.shadow === true) continue

    const loc = { target: target.name, block: id }
    const blockOwners = owners.get(id) ?? []
    if (blockOwners.length === 0)
    {
      const parent = entry.parent
      const msg =
        typeof parent === 'string'
          ? `parent ${parent} has no next/input edge owning this block`
          : 'non-top-level block has no next/input owner'
      diags.warn('missing-block-owner', msg, loc)
      continue
    }
    if (blockOwners.length > 1)
    {
      const refs = blockOwners.map((o) => `${o.ownerId} ${o.via}`).join(', ')
      diags.warn(
        'multiple-block-owners',
        `block is owned by multiple edges: ${refs}`,
        loc
      )
      continue
    }
    const owner = blockOwners[0]!
    if (entry.parent !== owner.ownerId)
    {
      diags.warn(
        'block-parent-mismatch',
        `parent ${String(entry.parent)} does not match ${owner.via} owner ${owner.ownerId}`,
        loc
      )
    }
  }
}

function collectBlockOwners(target: Target): Map<string, BlockOwner[]>
{
  const owners = new Map<string, BlockOwner[]>()
  for (const [id, entry] of scratchRecordEntries(target.blocks))
  {
    if (!isBlock(entry)) continue
    if (
      typeof entry.next === 'string' &&
      isBlock(scratchRecordValue(target.blocks, entry.next))
    )
    {
      addOwner(owners, entry.next, { ownerId: id, via: 'next' })
    }
    for (const [name, input] of scratchRecordEntries(entry.inputs))
    {
      if (!Array.isArray(input)) continue
      for (let i = 1; i < input.length; i++)
      {
        const slot = input[i]
        if (typeof slot !== 'string') continue
        if (isBlock(scratchRecordValue(target.blocks, slot)))
        {
          addOwner(owners, slot, { ownerId: id, via: `input ${name}` })
        }
      }
    }
  }
  return owners
}

function addOwner(
  owners: Map<string, BlockOwner[]>,
  childId: string,
  owner: BlockOwner
): void
{
  const existing = owners.get(childId) ?? []
  if (
    !existing.some((o) => o.ownerId === owner.ownerId && o.via === owner.via)
  )
  {
    existing.push(owner)
  }
  owners.set(childId, existing)
}

// the union of every custom-block parameter name declared in this target
function targetArgumentNames(target: Target): Set<string>
{
  const names = new Set<string>()
  for (const [, entry] of scratchRecordEntries(target.blocks))
  {
    if (!isBlock(entry) || entry.opcode !== 'procedures_prototype') continue
    const parsed = parseMutationArray(entry.mutation?.argumentnames)
    if (parsed) for (const n of parsed) names.add(n)
  }
  return names
}

function checkBlock(
  target: Target,
  id: string,
  block: Block,
  index: ProjectIndex,
  argNames: Set<string>,
  diags: Diagnostics
): void
{
  const blocks = target.blocks
  const loc = { target: target.name, block: id }

  // next/parent referential integrity & adjacency symmetry
  if (typeof block.next === 'string')
  {
    const nextBlock = scratchRecordValue(blocks, block.next)
    if (!isBlock(nextBlock))
    {
      diags.warn(
        'dangling-next',
        `next points at missing block ${block.next}`,
        loc
      )
    }
    else if (nextBlock.parent !== id)
    {
      diags.info(
        'next-parent-asymmetry',
        `next ${block.next} does not point its parent back here`,
        loc
      )
    }
  }
  if (
    typeof block.parent === 'string' &&
    !isBlock(scratchRecordValue(blocks, block.parent))
  )
  {
    diags.warn(
      'dangling-parent',
      `parent points at missing block ${block.parent}`,
      loc
    )
  }

  for (const [name, input] of scratchRecordEntries(block.inputs))
  {
    checkInput(target, id, name, input, index, diags)
  }
  for (const [name, field] of scratchRecordEntries(block.fields))
  {
    checkField(target, id, name, field, index, diags)
  }

  checkMutation(target, id, block, index, argNames, diags)
}

function checkInput(
  target: Target,
  blockId: string,
  name: string,
  input: BlockInput,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const loc = { target: target.name, block: blockId }
  if (!Array.isArray(input))
  {
    diags.error('bad-input-encoding', `input ${name} is not an array`, loc)
    return
  }
  const shadowType = input[0]
  if (shadowType !== 1 && shadowType !== 2 && shadowType !== 3)
  {
    diags.error(
      'bad-input-encoding',
      `input ${name} has shadow-type ${String(shadowType)} (expected 1, 2 or 3)`,
      loc
    )
    return
  }
  // arity is not schema-enforced & the VM tolerates it -> warning, not a load error
  const want = shadowType === 3 ? 3 : 2
  if (input.length !== want)
  {
    diags.warn(
      'bad-input-arity',
      `input ${name} (type ${shadowType}) has ${input.length - 1} slot(s), expected ${want - 1}`,
      loc
    )
  }

  for (let i = 1; i < input.length; i++)
  {
    const slot = input[i] as InputSlot
    if (slot === null || slot === undefined) continue
    if (typeof slot === 'string')
    {
      if (!isBlock(scratchRecordValue(target.blocks, slot)))
      {
        diags.warn(
          'dangling-input-block',
          `input ${name} references missing block ${slot}`,
          loc
        )
      }
      continue
    }
    checkPrimitive(target, blockId, name, slot, false, index, diags)
  }
}

// validate an inlined / top-level primitive array & resolve any id it carries
function checkPrimitive(
  target: Target,
  blockId: string,
  where: string,
  prim: InputPrimitive | TopLevelPrimitive,
  topLevel: boolean,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const loc = { target: target.name, block: blockId }
  const head = prim[0]
  const bad = (msg: string): void =>
    diags.error('bad-primitive', `input ${where}: ${msg}`, loc)

  if (head >= 4 && head <= 8)
  {
    if (prim.length !== 2) bad(`number primitive ${head} must have 2 elements`)
    return
  }
  if (head === 9)
  {
    if (prim.length !== 2 || !COLOR_RE.test(String(prim[1])))
    {
      bad('colour primitive must be [9, "#rrggbb"]')
    }
    return
  }
  if (head === 10)
  {
    if (prim.length !== 2) bad('text primitive must be [10, value]')
    return
  }
  if (head === 11)
  {
    if (prim.length !== 3)
    {
      bad('broadcast primitive must be [11, name, id]')
      return
    }
    resolveBroadcast(
      target,
      blockId,
      where,
      String(prim[1]),
      String(prim[2]),
      index,
      diags
    )
    return
  }
  if (head === 12 || head === 13)
  {
    const wantLen = topLevel ? 5 : 3
    if (prim.length !== wantLen)
    {
      bad(
        `${head === 12 ? 'variable' : 'list'} primitive must have ${wantLen} elements`
      )
    }
    const refId = String(prim[2])
    if (head === 12)
    {
      if (!index.resolveVar(target, refId))
      {
        diags.warn(
          'missing-variable',
          `${where} reads variable id ${refId} that no target declares`,
          loc
        )
      }
    }
    else if (!index.resolveList(target, refId))
    {
      diags.warn(
        'missing-list',
        `${where} reads list id ${refId} that no target declares`,
        loc
      )
    }
    return
  }
  bad(`unknown primitive type ${String(head)}`)
}

function resolveBroadcast(
  target: Target,
  blockId: string,
  where: string,
  name: string,
  id: string,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const loc = { target: target.name, block: blockId }
  if (!index.resolveBroadcast(id))
  {
    diags.warn(
      'missing-broadcast',
      `${where} references broadcast id ${id} that no target declares`,
      loc
    )
    return
  }
  const resolution = index.broadcastResolution(id, name)
  if (resolution.idNameMismatch)
  {
    const idName = resolution.idCandidateDeclaration?.name ?? '<missing>'
    const outcome = resolution.declaration
      ? `resolves as "${resolution.declaration.name}" instead`
      : 'does not resolve by name'
    diags.info(
      'broadcast-name-mismatch',
      `broadcast id ${id} declares "${idName}", so name "${name}" ${outcome}`,
      loc
    )
  }
}

// the id-bearing fields (VARIABLE/LIST/BROADCAST_OPTION) must resolve to a declaration
function checkField(
  target: Target,
  blockId: string,
  name: string,
  field: readonly (string | number | null)[],
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  const loc = { target: target.name, block: blockId }
  if (!Array.isArray(field))
  {
    diags.warn('bad-field-arity', `field ${name} is not an array`, loc)
    return
  }
  // the schema types fields as an open object & the VM tolerates odd arity -> warning
  if (field.length < 1 || field.length > 2)
  {
    diags.warn(
      'bad-field-arity',
      `field ${name} has ${field.length} element(s), expected 1 or 2`,
      loc
    )
    return
  }
  const id = field.length === 2 ? field[1] : undefined
  if (typeof id !== 'string') return
  if (name === 'VARIABLE' && !index.resolveVar(target, id))
  {
    diags.warn(
      'missing-variable',
      `field VARIABLE id ${id} resolves to nothing`,
      loc
    )
  }
  else if (name === 'LIST' && !index.resolveList(target, id))
  {
    diags.warn('missing-list', `field LIST id ${id} resolves to nothing`, loc)
  }
  else if (name === 'BROADCAST_OPTION' && !index.resolveBroadcast(id))
  {
    diags.warn(
      'missing-broadcast',
      `field BROADCAST_OPTION id ${id} resolves to nothing`,
      loc
    )
  }
}

function checkMutation(
  target: Target,
  id: string,
  block: Block,
  index: ProjectIndex,
  argNames: Set<string>,
  diags: Diagnostics
): void
{
  const loc = { target: target.name, block: id }
  const opcode = block.opcode

  if (
    opcode === 'argument_reporter_string_number' ||
    opcode === 'argument_reporter_boolean'
  )
  {
    const value = scratchRecordValue(block.fields, 'VALUE')?.[0]
    if (
      typeof value === 'string' &&
      argNames.size > 0 &&
      !argNames.has(value)
    )
    {
      diags.info(
        'argument-reporter-unbound',
        `parameter "${value}" matches no custom-block parameter in this sprite`,
        loc
      )
    }
    return
  }

  const mutation = block.mutation

  if (opcode === 'procedures_call')
  {
    // a call w/o a proccode has nothing to dispatch to
    if (!mutation || typeof mutation.proccode !== 'string')
    {
      diags.warn(
        'missing-procedure',
        'procedures_call has no proccode to dispatch to',
        loc
      )
      return
    }
    const proccode = mutation.proccode
    const ids = checkCallArgs(mutation, loc, diags)
    const protos = index.perTarget.get(target)?.prototypes.get(proccode)
    if (!protos || protos.length === 0)
    {
      diags.warn(
        'missing-procedure',
        `call to "${proccode}" has no matching definition in this sprite`,
        loc
      )
      return
    }
    const protoId = protos[0]
    const protoBlock = protoId
      ? scratchRecordValue(target.blocks, protoId)
      : undefined
    if (isBlock(protoBlock) && protoBlock.opcode === 'procedures_prototype')
    {
      const protoIds = parseMutationArray(protoBlock.mutation?.argumentids)
      checkProcedureCallArgs(block, proccode, ids, protoIds, loc, diags)
    }
    return
  }

  if (opcode === 'procedures_prototype' && mutation)
  {
    checkProcArrays(mutation, loc, diags)
  }
}

function checkProcedureCallArgs(
  block: Block,
  proccode: string,
  callIds: string[] | null,
  protoIds: string[] | null,
  loc: { target: string; block: string },
  diags: Diagnostics
): void
{
  if (!protoIds) return
  if (callIds === null)
  {
    if (protoIds.length > 0)
    {
      diags.warn(
        'proc-arg-mismatch',
        `call to "${proccode}" has no argumentids but declares ${protoIds.length}`,
        loc
      )
    }
  }
  else
  {
    if (callIds.length !== protoIds.length)
    {
      diags.warn(
        'proc-arg-mismatch',
        `call passes ${callIds.length} args but "${proccode}" declares ${protoIds.length}`,
        loc
      )
    }
    const n = Math.min(callIds.length, protoIds.length)
    for (let i = 0; i < n; i++)
    {
      if (callIds[i] === protoIds[i]) continue
      diags.warn(
        'proc-arg-mismatch',
        `call arg ${i + 1} id ${callIds[i]} does not match declared id ${protoIds[i]}`,
        loc
      )
    }
  }

  const inputs = block.inputs ?? {}
  const declared = new Set(protoIds)
  for (const id of protoIds)
  {
    if (!hasScratchRecordKey(inputs, id))
    {
      diags.warn(
        'proc-arg-mismatch',
        `call to "${proccode}" is missing input ${id}`,
        loc
      )
    }
  }
  for (const id of scratchRecordKeys(inputs))
  {
    if (!declared.has(id))
    {
      diags.warn(
        'proc-arg-mismatch',
        `call to "${proccode}" has undeclared input ${id}`,
        loc
      )
    }
  }
}

// prototype argumentids/argumentnames/argumentdefaults must parse & align
function checkProcArrays(
  mutation: Mutation,
  loc: { target: string; block: string },
  diags: Diagnostics
): void
{
  const ids = parseMutationArray(mutation.argumentids)
  const names = parseMutationArray(mutation.argumentnames)
  const defaults = parseMutationArray(mutation.argumentdefaults)
  if (mutation.argumentids !== undefined && ids === null)
  {
    diags.error(
      'mutation-bad-json',
      'argumentids is not a JSON array string',
      loc
    )
  }
  if (mutation.argumentnames !== undefined && names === null)
  {
    diags.error(
      'mutation-bad-json',
      'argumentnames is not a JSON array string',
      loc
    )
  }
  if (mutation.argumentdefaults !== undefined && defaults === null)
  {
    diags.error(
      'mutation-bad-json',
      'argumentdefaults is not a JSON array string',
      loc
    )
  }
  if (
    ids &&
    names &&
    defaults &&
    !(ids.length === names.length && names.length === defaults.length)
  )
  {
    diags.warn(
      'proc-arg-mismatch',
      `argumentids/names/defaults lengths differ (${ids.length}/${names.length}/${defaults.length})`,
      loc
    )
  }
  // a prototype w/ parameters but no argumentids cannot bind them at call time
  if (
    mutation.argumentids === undefined &&
    (names !== null || defaults !== null)
  )
  {
    diags.warn(
      'proc-arg-mismatch',
      'procedures_prototype has argumentnames/defaults but no argumentids',
      loc
    )
  }
  // each %s/%b/%n placeholder needs exactly one argument id
  if (ids && typeof mutation.proccode === 'string')
  {
    const slots = countPlaceholders(mutation.proccode)
    if (slots !== ids.length)
    {
      diags.warn(
        'proc-arg-mismatch',
        `proccode "${mutation.proccode}" has ${slots} placeholder(s) but ${ids.length} argument id(s)`,
        loc
      )
    }
  }
}

// count %s/%b/%n argument placeholders in a proccode; %% is a literal percent
function countPlaceholders(proccode: string): number
{
  let count = 0
  for (let i = 0; i < proccode.length - 1; i++)
  {
    if (proccode[i] !== '%') continue
    const next = proccode[i + 1]
    if (next === '%')
    {
      i++
      continue
    }
    if (next === 's' || next === 'b' || next === 'n') count++
  }
  return count
}

function checkCallArgs(
  mutation: Mutation,
  loc: { target: string; block: string },
  diags: Diagnostics
): string[] | null
{
  const ids = parseMutationArray(mutation.argumentids)
  if (mutation.argumentids !== undefined && ids === null)
  {
    diags.error(
      'mutation-bad-json',
      'argumentids is not a JSON array string',
      loc
    )
  }
  return ids
}

function checkTopLevelPrimitive(
  target: Target,
  id: string,
  entry: TopLevelPrimitive,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  checkPrimitive(target, id, 'top-level reporter', entry, true, index, diags)
}

function checkMonitors(
  json: ProjectJson,
  index: ProjectIndex,
  diags: Diagnostics
): void
{
  for (const monitor of json.monitors ?? [])
  {
    const loc = { monitor: monitor.id }
    const owner = monitor.spriteName
      ? index.spritesByName.get(monitor.spriteName)
      : index.stage
    if (monitor.spriteName && !owner)
    {
      diags.warn(
        'monitor-missing-sprite',
        `monitor names sprite "${monitor.spriteName}" that does not exist`,
        loc
      )
      continue
    }
    if (!owner) continue
    if (
      monitor.opcode === 'data_variable' &&
      !index.resolveVar(owner, monitor.id)
    )
    {
      diags.warn(
        'monitor-missing-data',
        `variable monitor ${monitor.id} resolves to no variable`,
        loc
      )
    }
    else if (
      monitor.opcode === 'data_listcontents' &&
      !index.resolveList(owner, monitor.id)
    )
    {
      diags.warn(
        'monitor-missing-data',
        `list monitor ${monitor.id} resolves to no list`,
        loc
      )
    }
  }
}
