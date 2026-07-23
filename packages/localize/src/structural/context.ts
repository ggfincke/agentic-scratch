// packages/localize/src/structural/context.ts
// render bounded script context around ranked structural evidence

import {
  ownRecordKeys,
  ownRecordValue,
  type BlockRef,
  type ProjectIR,
  type ScriptRef,
} from '@scratch-agent/ir'
import {
  isBlockEntry,
  primaryInputSlot,
  type BlockInput,
  type InputSlot,
} from '@scratch-agent/sb3'

import { blockKey, scriptKey, type LocalizationIndexes } from './types.js'
import type {
  ReadableBlockContext,
  ReadableField,
  ReadableInput,
  ScriptContext,
} from './report-types.js'

const MAX_SCALAR_CODE_POINTS = 160
const MAX_IDENTITY_BYTES = 96
const MAX_MEMBERS_PER_BLOCK = 8
const MAX_CONTEXT_BYTES = 8 * 1024
const MAX_ANCESTOR_DEPTH = 8
const RESERVED_TRUNCATION_REASONS = [
  'block-limit',
  'text-budget',
  'member-or-scalar-limit',
  'identity-truncation',
]

interface BoundedText
{
  value: string
  truncated: boolean
}

interface MandatorySelection
{
  refs: BlockRef[]
  ancestorKeys: Set<string>
  dependencyKeys: Set<string>
}

interface RenderedBlock
{
  key: string
  context: ReadableBlockContext
  identityTruncated: boolean
}

function escaped(value: unknown): string
{
  return String(value ?? '')
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
}

function bounded(value: unknown): BoundedText
{
  const rendered = escaped(value)
  const codePoints = [...rendered]
  if (codePoints.length <= MAX_SCALAR_CODE_POINTS)
    return { value: rendered, truncated: false }
  return {
    value: `${codePoints.slice(0, MAX_SCALAR_CODE_POINTS - 3).join('')}...`,
    truncated: true,
  }
}

function boundedIdentity(value: unknown): BoundedText
{
  const rendered = escaped(value)
  if (Buffer.byteLength(rendered, 'utf8') <= MAX_IDENTITY_BYTES)
    return { value: rendered, truncated: false }
  const retained: string[] = []
  let bytes = 3
  for (const codePoint of rendered)
  {
    const size = Buffer.byteLength(codePoint, 'utf8')
    if (bytes + size > MAX_IDENTITY_BYTES) break
    retained.push(codePoint)
    bytes += size
  }
  return { value: `${retained.join('')}...`, truncated: true }
}

function readableTarget(target: BlockRef['target']): {
  target: BlockRef['target']
  truncated: boolean
}
{
  const name = boundedIdentity(target.name)
  return {
    target: { ...target, name: name.value },
    truncated: name.truncated,
  }
}

function readableBlockRef(ref: BlockRef): {
  block: BlockRef
  truncated: boolean
}
{
  const target = readableTarget(ref.target)
  const blockId = boundedIdentity(ref.blockId)
  return {
    block: { target: target.target, blockId: blockId.value },
    truncated: target.truncated || blockId.truncated,
  }
}

function readableScriptRef(ref: ScriptRef): {
  script: ScriptRef
  truncated: boolean
}
{
  const target = readableTarget(ref.target)
  const topBlockId = boundedIdentity(ref.topBlockId)
  return {
    script: { target: target.target, topBlockId: topBlockId.value },
    truncated: target.truncated || topBlockId.truncated,
  }
}

function renderSlot(slot: InputSlot | undefined): {
  value: string
  scalarTruncated: boolean
  identityTruncated: boolean
}
{
  if (slot === undefined || slot === null)
    return {
      value: '<empty>',
      scalarTruncated: false,
      identityTruncated: false,
    }
  if (typeof slot === 'string')
  {
    const id = boundedIdentity(slot)
    return {
      value: `block:${id.value}`,
      scalarTruncated: false,
      identityTruncated: id.truncated,
    }
  }
  const name = bounded(slot[1])
  const id = boundedIdentity(slot[2])
  switch (slot[0])
  {
    case 11:
      return {
        value: `broadcast:${name.value}#${id.value}`,
        scalarTruncated: name.truncated,
        identityTruncated: id.truncated,
      }
    case 12:
      return {
        value: `variable:${name.value}#${id.value}`,
        scalarTruncated: name.truncated,
        identityTruncated: id.truncated,
      }
    case 13:
      return {
        value: `list:${name.value}#${id.value}`,
        scalarTruncated: name.truncated,
        identityTruncated: id.truncated,
      }
    default:
      return {
        value: `literal:${name.value}`,
        scalarTruncated: name.truncated,
        identityTruncated: false,
      }
  }
}

function renderInput(
  name: string,
  input: BlockInput
): {
  input: ReadableInput
  scalarTruncated: boolean
  identityTruncated: boolean
}
{
  const readableName = boundedIdentity(name)
  const primary = renderSlot(primaryInputSlot(input))
  const shadow = input.length > 2 ? renderSlot(input[2]) : null
  return {
    input: {
      name: readableName.value,
      value:
        shadow && shadow.value !== primary.value
          ? `${primary.value} shadow=${shadow.value}`
          : primary.value,
    },
    scalarTruncated:
      primary.scalarTruncated || (shadow?.scalarTruncated ?? false),
    identityTruncated:
      readableName.truncated ||
      primary.identityTruncated ||
      (shadow?.identityTruncated ?? false),
  }
}

function mandatoryRefs(
  script: ScriptRef,
  implicated: BlockRef | null,
  indexes: LocalizationIndexes
): MandatorySelection
{
  const refs: BlockRef[] = []
  const seen = new Set<string>()
  const ancestorKeys = new Set<string>()
  const dependencyKeys = new Set<string>()
  const add = (ref: BlockRef | null | undefined): void =>
  {
    if (!ref || seen.has(blockKey(ref))) return
    seen.add(blockKey(ref))
    refs.push(ref)
  }
  add(implicated)
  const validatedParent = (child: BlockRef): BlockRef | null =>
  {
    const indexed = indexes.blockByKey.get(blockKey(child))
    const parent = indexed?.parent
    if (!parent) return null
    const parentBlock = indexes.blockByKey.get(blockKey(parent))
    if (!parentBlock) return null
    const ownsByNext = parentBlock.successor
      ? blockKey(parentBlock.successor) === blockKey(child)
      : false
    const ownsByInput = parentBlock.inputChildren.some(
      (input) => blockKey(input.block) === blockKey(child)
    )
    return ownsByNext || ownsByInput ? parent : null
  }
  let current = implicated ? validatedParent(implicated) : null
  for (let depth = 0; current && depth < MAX_ANCESTOR_DEPTH; depth++)
  {
    add(current)
    ancestorKeys.add(blockKey(current))
    current = validatedParent(current)
  }
  const indexed = implicated
    ? indexes.blockByKey.get(blockKey(implicated))
    : null
  for (const child of indexed?.inputChildren ?? [])
  {
    if (validatedParent(child.block)?.blockId !== implicated?.blockId) continue
    add(child.block)
    dependencyKeys.add(blockKey(child.block))
  }
  const parentRef = implicated ? validatedParent(implicated) : null
  if (parentRef)
  {
    const parent = indexes.blockByKey.get(blockKey(parentRef))
    for (const child of parent?.inputChildren ?? [])
    {
      add(child.block)
      dependencyKeys.add(blockKey(child.block))
    }
  }
  const validatedPredecessor = (child: BlockRef): BlockRef | null =>
  {
    const block = indexes.blockByKey.get(blockKey(child))
    const previous = block?.predecessor
    if (!previous || block?.predecessorStatus !== 'unique') return null
    return validatedParent(child)?.blockId === previous.blockId
      ? previous
      : null
  }
  const validatedSuccessor = (parent: BlockRef): BlockRef | null =>
  {
    const block = indexes.blockByKey.get(blockKey(parent))
    const next = block?.successor
    if (!next) return null
    return validatedParent(next)?.blockId === parent.blockId ? next : null
  }
  let previous = implicated ? validatedPredecessor(implicated) : null
  let next = implicated ? validatedSuccessor(implicated) : null
  for (let distance = 0; distance < 2; distance++)
  {
    add(previous)
    add(next)
    if (previous) dependencyKeys.add(blockKey(previous))
    if (next) dependencyKeys.add(blockKey(next))
    previous = previous ? validatedPredecessor(previous) : null
    next = next ? validatedSuccessor(next) : null
  }
  add({ target: script.target, blockId: script.topBlockId })
  return { refs, ancestorKeys, dependencyKeys }
}

function selectRefs(
  ordered: readonly BlockRef[],
  mandatory: readonly BlockRef[],
  limit: number
): BlockRef[]
{
  const selected = new Set<string>()
  for (const ref of mandatory)
  {
    if (selected.size >= limit) break
    selected.add(blockKey(ref))
  }
  for (const ref of ordered)
  {
    if (selected.size >= limit) break
    selected.add(blockKey(ref))
  }
  return ordered.filter((ref) => selected.has(blockKey(ref)))
}

function renderBlock(
  project: ProjectIR,
  indexes: LocalizationIndexes,
  ref: BlockRef,
  implicated: BlockRef | null,
  ancestors: Set<string>,
  dependencies: Set<string>
): RenderedBlock
{
  const key = blockKey(ref)
  const readableRef = readableBlockRef(ref)
  const target = project.json.targets[ref.target.targetIndex]
  const entry = target ? ownRecordValue(target.blocks, ref.blockId) : undefined
  const indexed = indexes.blockByKey.get(key)
  if (!entry || !isBlockEntry(entry))
  {
    const opcode = indexed?.opcode
      ? boundedIdentity(indexed.opcode)
      : { value: '', truncated: false }
    return {
      key,
      context: {
        block: readableRef.block,
        opcode: indexed?.opcode ? opcode.value : null,
        relation:
          implicated && blockKey(implicated) === key ? 'implicated' : 'context',
        parentBlockId: null,
        nextBlockId: null,
        inputs: [],
        fields: [],
        omittedInputCount: 0,
        omittedFieldCount: 0,
        truncatedScalarCount: 0,
      },
      identityTruncated: readableRef.truncated || opcode.truncated,
    }
  }
  let truncatedScalarCount = 0
  let identityTruncated = readableRef.truncated
  const fieldNames = ownRecordKeys(entry.fields).sort()
  const fields: ReadableField[] = fieldNames
    .slice(0, MAX_MEMBERS_PER_BLOCK)
    .map((name) =>
    {
      const field = ownRecordValue(entry.fields, name)!
      const readableName = boundedIdentity(name)
      const value = bounded(field[0])
      const id = typeof field[1] === 'string' ? boundedIdentity(field[1]) : null
      if (value.truncated) truncatedScalarCount++
      identityTruncated ||= readableName.truncated || (id?.truncated ?? false)
      return {
        name: readableName.value,
        value: value.value,
        id: id?.value ?? null,
      }
    })
  const inputNames = ownRecordKeys(entry.inputs).sort()
  const renderedInputs = inputNames
    .slice(0, MAX_MEMBERS_PER_BLOCK)
    .map((name) => renderInput(name, ownRecordValue(entry.inputs, name)!))
  truncatedScalarCount += renderedInputs.filter(
    (item) => item.scalarTruncated
  ).length
  identityTruncated ||= renderedInputs.some((item) => item.identityTruncated)
  const relation =
    implicated && blockKey(implicated) === key
      ? 'implicated'
      : ancestors.has(key)
        ? 'ancestor'
        : dependencies.has(key)
          ? 'dependency'
          : 'context'
  const opcode = boundedIdentity(entry.opcode)
  const parent =
    typeof entry.parent === 'string' ? boundedIdentity(entry.parent) : null
  const next =
    typeof entry.next === 'string' ? boundedIdentity(entry.next) : null
  identityTruncated ||=
    opcode.truncated ||
    (parent?.truncated ?? false) ||
    (next?.truncated ?? false)
  return {
    key,
    context: {
      block: readableRef.block,
      opcode: opcode.value,
      relation,
      parentBlockId: parent?.value ?? null,
      nextBlockId: next?.value ?? null,
      inputs: renderedInputs.map((item) => item.input),
      fields,
      omittedInputCount: Math.max(0, inputNames.length - renderedInputs.length),
      omittedFieldCount: Math.max(0, fieldNames.length - fields.length),
      truncatedScalarCount,
    },
    identityTruncated,
  }
}

function compactBlock(block: RenderedBlock): RenderedBlock
{
  return {
    ...block,
    context: {
      ...block.context,
      inputs: [],
      fields: [],
      omittedInputCount:
        block.context.omittedInputCount + block.context.inputs.length,
      omittedFieldCount:
        block.context.omittedFieldCount + block.context.fields.length,
    },
  }
}

function serializedBytes(context: ScriptContext): number
{
  return Buffer.byteLength(JSON.stringify(context), 'utf8')
}

export function buildScriptContext(
  project: ProjectIR,
  indexes: LocalizationIndexes,
  script: ScriptRef,
  implicated: BlockRef | null,
  maxBlocks: number
): ScriptContext
{
  const readableScript = readableScriptRef(script)
  const centered = implicated
    ? boundedIdentity(implicated.blockId)
    : { value: '', truncated: false }
  const indexedScript = indexes.scriptByKey.get(scriptKey(script))
  if (!indexedScript)
  {
    const reasons = ['script-unresolved']
    if (readableScript.truncated || centered.truncated)
      reasons.push('identity-truncation')
    return {
      script: readableScript.script,
      hatOpcode: null,
      centeredOnBlockId: implicated ? centered.value : null,
      blocks: [],
      omittedBlockCount: 0,
      truncated: true,
      truncationReasons: reasons,
    }
  }
  const hatOpcode = indexedScript.hatOpcode
    ? boundedIdentity(indexedScript.hatOpcode)
    : null
  const mandatory = mandatoryRefs(script, implicated, indexes)
  const selected = selectRefs(
    indexedScript.blockRefs,
    mandatory.refs,
    maxBlocks
  )
  const rendered = selected.map((ref) =>
    renderBlock(
      project,
      indexes,
      ref,
      implicated,
      mandatory.ancestorKeys,
      mandatory.dependencyKeys
    )
  )
  const priority = new Map(
    mandatory.refs.map((ref, index) => [blockKey(ref), index])
  )
  const structuralOrder = new Map(
    indexedScript.blockRefs.map((ref, index) => [blockKey(ref), index])
  )
  const createContext = (
    blocks: readonly RenderedBlock[],
    reasons: readonly string[]
  ): ScriptContext => ({
    script: readableScript.script,
    hatOpcode: hatOpcode?.value ?? null,
    centeredOnBlockId: implicated ? centered.value : null,
    blocks: blocks.map((block) => block.context),
    omittedBlockCount: indexedScript.blockRefs.length - blocks.length,
    truncated: reasons.length > 0,
    truncationReasons: [...reasons],
  })
  const fits = (blocks: readonly RenderedBlock[]): boolean =>
    serializedBytes(createContext(blocks, RESERVED_TRUNCATION_REASONS)) <=
    MAX_CONTEXT_BYTES
  const priorityOrdered = [...rendered].sort((a, b) =>
  {
    const aPriority = priority.get(a.key) ?? Number.MAX_SAFE_INTEGER
    const bPriority = priority.get(b.key) ?? Number.MAX_SAFE_INTEGER
    return aPriority - bPriority
  })
  const retained: RenderedBlock[] = []
  const implicatedKey = implicated ? blockKey(implicated) : null
  const implicatedBlock = implicatedKey
    ? rendered.find((block) => block.key === implicatedKey)
    : undefined
  let implicatedCompacted = false
  if (implicatedBlock)
  {
    const compact = compactBlock(implicatedBlock)
    if (fits([implicatedBlock])) retained.push(implicatedBlock)
    else
    {
      retained.push(compact)
      implicatedCompacted = true
    }
  }
  for (const block of priorityOrdered)
  {
    if (block.key === implicatedKey) continue
    if (fits([...retained, block])) retained.push(block)
  }
  retained.sort(
    (a, b) =>
      (structuralOrder.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
      (structuralOrder.get(b.key) ?? Number.MAX_SAFE_INTEGER)
  )
  const omittedBlockCount = indexedScript.blockRefs.length - retained.length
  const memberTruncated = retained.some(
    (block) =>
      block.context.omittedFieldCount > 0 ||
      block.context.omittedInputCount > 0 ||
      block.context.truncatedScalarCount > 0
  )
  const identityTruncated =
    readableScript.truncated ||
    centered.truncated ||
    (hatOpcode?.truncated ?? false) ||
    retained.some((block) => block.identityTruncated)
  const reasons: string[] = []
  if (selected.length < indexedScript.blockRefs.length)
    reasons.push('block-limit')
  if (retained.length < selected.length || implicatedCompacted)
    reasons.push('text-budget')
  if (memberTruncated) reasons.push('member-or-scalar-limit')
  if (identityTruncated) reasons.push('identity-truncation')
  const context = createContext(retained, reasons)
  context.omittedBlockCount = omittedBlockCount
  return context
}
