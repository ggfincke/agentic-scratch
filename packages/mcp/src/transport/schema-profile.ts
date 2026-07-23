// packages/mcp/src/transport/schema-profile.ts
// emit & compact the closed advertised tool schemas for the frozen MCP profile

import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import {
  EDIT_TOOL_DESCRIPTORS,
  EDIT_TOOL_NAMES,
  PROJECT_TOOL_NAMES,
  emitJsonSchema202012,
  toolInputSchemaModel,
  toolOutputSchemaModel,
  type EditToolName,
} from '@scratch-agent/edit'

import {
  projectOutputSchema,
  type JsonSchema,
} from '../project/project-output-schema.js'
import { PROJECT_TOOLS } from '../project/project-tools.js'

// resolve a local $defs pointer back to its definition name
export function referencedDefinitionName(reference: string): string | null
{
  const prefix = '#/$defs/'
  if (!reference.startsWith(prefix)) return null
  return reference
    .slice(prefix.length)
    .replaceAll('~1', '/')
    .replaceAll('~0', '~')
}

const ALIAS_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const ALIAS_INITIAL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

function schemaAlias(index: number): string
{
  let length = 1
  let capacity = ALIAS_INITIAL_ALPHABET.length
  let remaining = index
  while (remaining >= capacity)
  {
    remaining -= capacity
    length++
    capacity *= ALIAS_ALPHABET.length
  }
  const suffixCapacity = ALIAS_ALPHABET.length ** (length - 1)
  let output = ALIAS_INITIAL_ALPHABET[Math.floor(remaining / suffixCapacity)]!
  remaining %= suffixCapacity
  for (let position = length - 2; position >= 0; position--)
  {
    const place = ALIAS_ALPHABET.length ** position
    output += ALIAS_ALPHABET[Math.floor(remaining / place)]!
    remaining %= place
  }
  return output
}

function schemaRecord(value: unknown): value is Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    return false
  }
  const record = value as Record<string, unknown>
  return [
    '$ref',
    'allOf',
    'anyOf',
    'const',
    'enum',
    'if',
    'not',
    'oneOf',
    'type',
  ].some((key) => Object.hasOwn(record, key))
}

interface ClosedObjectBranch
{
  properties: Record<string, unknown>
  required: string[]
  remainder: Record<string, unknown>
}

function closedObjectBranch(value: unknown): ClosedObjectBranch | null
{
  if (!schemaRecord(value)) return null
  if (value.type !== 'object' || value.additionalProperties !== false)
  {
    return null
  }
  if (
    value.properties === null ||
    typeof value.properties !== 'object' ||
    Array.isArray(value.properties)
  )
  {
    return null
  }
  if (
    value.required !== undefined &&
    (!Array.isArray(value.required) ||
      value.required.some((entry) => typeof entry !== 'string'))
  )
  {
    return null
  }
  const remainder = { ...value }
  delete remainder.type
  delete remainder.additionalProperties
  delete remainder.properties
  delete remainder.required
  return {
    properties: value.properties as Record<string, unknown>,
    required: (value.required ?? []) as string[],
    remainder,
  }
}

function factorSharedConstraintProperties(
  keyword: 'anyOf' | 'oneOf',
  constraints: JsonSchema[]
): JsonSchema[]
{
  let branches = constraints
  while (true)
  {
    const groups = new Map<string, { indexes: number[] }>()
    for (const [index, branch] of branches.entries())
    {
      const properties = branch.properties
      if (
        properties === null ||
        typeof properties !== 'object' ||
        Array.isArray(properties)
      )
      {
        continue
      }
      for (const [name, propertySchema] of Object.entries(properties))
      {
        const identity = `${name}\u0000${JSON.stringify(propertySchema)}`
        const group = groups.get(identity) ?? {
          indexes: [] as number[],
        }
        group.indexes.push(index)
        groups.set(identity, group)
      }
    }
    const originalBytes = JSON.stringify(branches).length
    const candidates = [...groups.values()]
      .filter(
        (group) =>
          group.indexes.length > 1 && group.indexes.length < branches.length
      )
      .map((group) =>
      {
        const firstIndex = group.indexes[0]!
        const indexes = new Set(group.indexes)
        const sharedProperties = Object.fromEntries(
          Object.entries(
            branches[firstIndex]!.properties as Record<string, unknown>
          ).filter(([name, schema]) =>
            group.indexes.every((index) =>
            {
              const properties = branches[index]!.properties as Record<
                string,
                unknown
              >
              return JSON.stringify(properties[name]) === JSON.stringify(schema)
            })
          )
        )
        const grouped = group.indexes.map((index) =>
        {
          const branch = structuredClone(branches[index]!)
          const properties = branch.properties as Record<string, unknown>
          for (const name of Object.keys(sharedProperties))
          {
            delete properties[name]
          }
          if (Object.keys(properties).length === 0) delete branch.properties
          return branch
        })
        const wrapper = {
          properties: sharedProperties,
          [keyword]: grouped,
        }
        const candidate = branches
          .map((branch, index) =>
            index === firstIndex ? wrapper : indexes.has(index) ? null : branch
          )
          .filter((branch) => branch !== null) as JsonSchema[]
        return { candidate, bytes: JSON.stringify(candidate).length }
      })
      .filter((entry) => entry.bytes < originalBytes)
      .sort((left, right) => left.bytes - right.bytes)
    const selected = candidates[0]
    if (!selected) return branches
    branches = selected.candidate
  }
}

function factorClosedObjectUnion(
  keyword: 'anyOf' | 'oneOf',
  branches: unknown[]
): JsonSchema | null
{
  if (branches.length < 2) return null
  const objects = branches.map(closedObjectBranch)
  if (objects.some((entry) => entry === null)) return null
  const exact = objects as ClosedObjectBranch[]
  const propertyNames = [
    ...new Set(exact.flatMap((branch) => Object.keys(branch.properties))),
  ].sort()
  const allRequiredByCount = exact.map(
    (branch) =>
      branch.remainder.minProperties === Object.keys(branch.properties).length
  )
  const effectiveRequired = exact.map(
    (branch) =>
      new Set(
        branch.remainder.minProperties === Object.keys(branch.properties).length
          ? Object.keys(branch.properties)
          : branch.required
      )
  )
  const commonRequired = effectiveRequired.reduce(
    (common, required) =>
      new Set([...common].filter((name) => required.has(name)))
  )
  const sharedPropertyNames = propertyNames.filter((name) =>
    exact.every(
      (branch) =>
        Object.hasOwn(branch.properties, name) &&
        JSON.stringify(branch.properties[name]) ===
          JSON.stringify(exact[0]!.properties[name])
    )
  )
  const unevaluated = {
    type: 'object',
    properties: Object.fromEntries(
      sharedPropertyNames.map((name) => [name, exact[0]!.properties[name]])
    ),
    ...(commonRequired.size === 0
      ? {}
      : { required: [...commonRequired].sort() }),
    [keyword]: factorSharedConstraintProperties(
      keyword,
      exact.map((branch, index) =>
      {
        const properties = Object.fromEntries(
          Object.entries(branch.properties).filter(
            ([name]) => !sharedPropertyNames.includes(name)
          )
        )
        const restoreRequired = allRequiredByCount[index] === true
        const required = (
          restoreRequired ? Object.keys(branch.properties) : branch.required
        ).filter((name) => !commonRequired.has(name))
        const remainder = { ...branch.remainder }
        if (restoreRequired) delete remainder.minProperties
        return {
          ...remainder,
          ...(required.length === 0 ? {} : { required }),
          ...(Object.keys(properties).length === 0 ? {} : { properties }),
        }
      })
    ),
    unevaluatedProperties: false,
  }
  const original = { [keyword]: branches }
  const candidate = unevaluated
  return JSON.stringify(candidate).length < JSON.stringify(original).length
    ? candidate
    : null
}

function factorClosedObjectUnions(value: unknown): unknown
{
  if (Array.isArray(value))
  {
    return value.map(factorClosedObjectUnions)
  }
  if (value === null || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const record = Object.fromEntries(
    Object.entries(source).map(([key, entry]) => [
      key,
      factorClosedObjectUnions(entry),
    ])
  )
  for (const keyword of ['anyOf', 'oneOf'] as const)
  {
    const branches = record[keyword]
    if (!Array.isArray(branches)) continue
    const factored = factorClosedObjectUnion(keyword, branches)
    if (!factored) continue
    delete record[keyword]
    return { ...record, ...factored }
  }
  return record
}

function mergeConstVariantUnions(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(mergeConstVariantUnions)
  if (value === null || typeof value !== 'object') return value
  const record = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      mergeConstVariantUnions(entry),
    ])
  )
  for (const keyword of ['anyOf', 'oneOf'] as const)
  {
    const original = record[keyword]
    if (!Array.isArray(original) || original.length < 2) continue
    let branches = [...original]
    let changed = true
    while (changed)
    {
      changed = false
      const propertyNames = new Set<string>()
      for (const branch of branches)
      {
        if (
          branch === null ||
          typeof branch !== 'object' ||
          Array.isArray(branch)
        )
        {
          continue
        }
        const properties = (branch as Record<string, unknown>).properties
        if (
          properties === null ||
          typeof properties !== 'object' ||
          Array.isArray(properties)
        )
        {
          continue
        }
        for (const [name, schema] of Object.entries(properties))
        {
          const enumeratedValues =
            schema !== null &&
            typeof schema === 'object' &&
            !Array.isArray(schema)
              ? (schema as Record<string, unknown>).enum
              : undefined
          if (
            schema !== null &&
            typeof schema === 'object' &&
            !Array.isArray(schema) &&
            Object.keys(schema).length === 1 &&
            (Object.hasOwn(schema, 'const') ||
              (Array.isArray(enumeratedValues) && enumeratedValues.length > 0))
          )
          {
            propertyNames.add(name)
          }
        }
      }
      for (const name of [...propertyNames].sort())
      {
        const groups = new Map<
          string,
          Array<{ index: number; values: unknown[] }>
        >()
        for (const [index, branch] of branches.entries())
        {
          if (
            branch === null ||
            typeof branch !== 'object' ||
            Array.isArray(branch)
          )
          {
            continue
          }
          const properties = (branch as Record<string, unknown>).properties
          if (
            properties === null ||
            typeof properties !== 'object' ||
            Array.isArray(properties)
          )
          {
            continue
          }
          const schema = (properties as Record<string, unknown>)[name]
          if (
            schema === null ||
            typeof schema !== 'object' ||
            Array.isArray(schema) ||
            Object.keys(schema).length !== 1 ||
            (!Object.hasOwn(schema, 'const') &&
              !Array.isArray((schema as Record<string, unknown>).enum))
          )
          {
            continue
          }
          const normalized = structuredClone(branch) as Record<string, unknown>
          ;(normalized.properties as Record<string, unknown>)[name] = {
            const: '__phase8_const_variant__',
          }
          const identity = JSON.stringify(normalized)
          const group = groups.get(identity) ?? []
          const schemaRecord = schema as Record<string, unknown>
          group.push({
            index,
            values: Object.hasOwn(schemaRecord, 'const')
              ? [schemaRecord.const]
              : (schemaRecord.enum as unknown[]),
          })
          groups.set(identity, group)
        }
        const group = [...groups.values()]
          .filter(
            (entries) =>
              entries.length > 1 &&
              (keyword === 'anyOf' ||
                new Set(
                  entries.flatMap((entry) =>
                    entry.values.map((entryValue) => JSON.stringify(entryValue))
                  )
                ).size ===
                  entries.reduce(
                    (count, entry) => count + entry.values.length,
                    0
                  ))
          )
          .sort((left, right) => right.length - left.length)[0]
        if (!group) continue
        const first = group[0]!
        const merged = structuredClone(branches[first.index]) as Record<
          string,
          unknown
        >
        const values = [
          ...new Map(
            group
              .flatMap((entry) => entry.values)
              .map((entry) => [JSON.stringify(entry), entry])
          ).values(),
        ]
        ;(merged.properties as Record<string, unknown>)[name] =
          values.length === 1 ? { const: values[0] } : { enum: values }
        const removed = new Set(group.slice(1).map((entry) => entry.index))
        const candidate = branches
          .map((branch, index) => (index === first.index ? merged : branch))
          .filter((_, index) => !removed.has(index))
        if (
          JSON.stringify(candidate).length < JSON.stringify(branches).length
        )
        {
          branches = candidate
          changed = true
          break
        }
      }
    }
    record[keyword] = branches
  }
  return record
}

function minimizeLogicalSchemas(
  value: unknown,
  allowRequiredCompaction: boolean
): unknown
{
  if (Array.isArray(value))
    return value.map((entry) =>
      minimizeLogicalSchemas(entry, allowRequiredCompaction)
    )
  if (value === null || typeof value !== 'object') return value
  const record = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      minimizeLogicalSchemas(entry, allowRequiredCompaction),
    ])
  )
  if (
    (Object.hasOwn(record, 'const') || Array.isArray(record.enum)) &&
    typeof record.type === 'string'
  )
  {
    delete record.type
  }
  if (Array.isArray(record.enum) && record.enum.length === 1)
  {
    record.const = record.enum[0]
    delete record.enum
  }
  if (Array.isArray(record.required) && record.required.length === 0)
  {
    delete record.required
  }
  const fixedStringPatterns = new Map([
    ['^[0-9a-f]{64}$', 64],
    ['^[A-Za-z0-9_-]{87}$', 87],
    ['^[A-Za-z0-9_-]{108}$', 108],
    ['^scratch-edit://artifact/[A-Za-z0-9_-]{108}$', 132],
  ])
  const pattern = typeof record.pattern === 'string' ? record.pattern : null
  const fixedLength = pattern ? fixedStringPatterns.get(pattern) : undefined
  if (
    fixedLength !== undefined &&
    record.minLength === fixedLength &&
    record.maxLength === fixedLength
  )
  {
    record.pattern = `${pattern!.slice(0, -1)}(?![^])`
    delete record.minLength
    delete record.maxLength
  }
  if (record.minItems === 0) delete record.minItems
  if (record.minLength === 0) delete record.minLength
  if (record.minProperties === 0) delete record.minProperties
  if (record.uniqueItems === false) delete record.uniqueItems
  if (
    allowRequiredCompaction &&
    record.additionalProperties === false &&
    record.properties !== null &&
    typeof record.properties === 'object' &&
    !Array.isArray(record.properties) &&
    Array.isArray(record.required)
  )
  {
    const names = Object.keys(record.properties)
    const required = record.required as string[]
    if (
      names.length > 0 &&
      names.length === required.length &&
      names.every((name) => required.includes(name))
    )
    {
      const candidate = { minProperties: names.length }
      if (
        JSON.stringify(candidate).length < JSON.stringify({ required }).length
      )
      {
        delete record.required
        record.minProperties = names.length
      }
    }
  }
  if (Array.isArray(record.oneOf) && record.oneOf.length > 1)
  {
    const branches = record.oneOf
      .map(closedObjectBranch)
      .filter((branch) => branch !== null)
    if (branches.length === record.oneOf.length)
    {
      const exact = branches as ClosedObjectBranch[]
      const discriminator = Object.keys(exact[0]!.properties).find((name) =>
      {
        const seen = new Set<string>()
        for (const branch of exact)
        {
          const schema = branch.properties[name]
          if (
            schema === null ||
            typeof schema !== 'object' ||
            Array.isArray(schema)
          )
          {
            return false
          }
          const schemaRecord = schema as Record<string, unknown>
          const values = Object.hasOwn(schemaRecord, 'const')
            ? [schemaRecord.const]
            : Array.isArray(schemaRecord.enum)
              ? schemaRecord.enum
              : null
          const allPropertiesRequired =
            branch.remainder.minProperties ===
            Object.keys(branch.properties).length
          if (
            !values ||
            (!branch.required.includes(name) && !allPropertiesRequired)
          )
          {
            return false
          }
          for (const entry of values)
          {
            const identity = JSON.stringify(entry)
            if (seen.has(identity)) return false
            seen.add(identity)
          }
        }
        return true
      })
      if (discriminator)
      {
        record.anyOf = record.oneOf
        delete record.oneOf
      }
    }
  }
  for (const keyword of ['allOf', 'anyOf'] as const)
  {
    const branches = record[keyword]
    if (!Array.isArray(branches)) continue
    const flattened = branches.flatMap((branch) =>
    {
      if (
        branch !== null &&
        typeof branch === 'object' &&
        !Array.isArray(branch) &&
        Object.keys(branch).length === 1 &&
        Array.isArray((branch as Record<string, unknown>)[keyword])
      )
      {
        return (branch as Record<string, unknown[]>)[keyword]
      }
      return [branch]
    })
    const identities = [
      ...new Map(
        flattened.map((branch) => [JSON.stringify(branch), branch])
      ).values(),
    ]
    const isTrueSchema = (branch: unknown): boolean =>
      branch === true ||
      (branch !== null &&
        typeof branch === 'object' &&
        !Array.isArray(branch) &&
        Object.keys(branch).length === 0)
    if (keyword === 'anyOf' && identities.some(isTrueSchema))
    {
      delete record.anyOf
      continue
    }
    if (keyword === 'allOf' && identities.some((branch) => branch === false))
    {
      return false
    }
    record[keyword] = identities.filter((branch) =>
      keyword === 'anyOf' ? branch !== false : !isTrueSchema(branch)
    )
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const)
  {
    const branches = record[keyword]
    if (!Array.isArray(branches) || branches.length !== 1) continue
    delete record[keyword]
    const branch = branches[0]
    if (
      branch === null ||
      typeof branch !== 'object' ||
      Array.isArray(branch)
    )
    {
      record[keyword] = branches
      continue
    }
    if (Object.keys(record).length === 0)
    {
      return branch
    }
    return { allOf: [record, branch] }
  }
  return record
}

const NULL_SAFE_SCHEMA_KEYWORDS = new Set([
  'additionalProperties',
  'contains',
  'dependentRequired',
  'dependentSchemas',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maxContains',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minContains',
  'minItems',
  'minLength',
  'minProperties',
  'minimum',
  'multipleOf',
  'pattern',
  'patternProperties',
  'prefixItems',
  'properties',
  'propertyNames',
  'required',
  'type',
  'unevaluatedItems',
  'unevaluatedProperties',
  'uniqueItems',
])

function mergeSimpleUnions(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(mergeSimpleUnions)
  if (value === null || typeof value !== 'object') return value
  const record = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      mergeSimpleUnions(entry),
    ])
  )
  for (const keyword of ['anyOf', 'oneOf'] as const)
  {
    const branches = record[keyword]
    if (!Array.isArray(branches) || branches.length < 2) continue
    if (
      branches.every(
        (branch) =>
          branch !== null &&
          typeof branch === 'object' &&
          !Array.isArray(branch) &&
          Object.keys(branch).length === 1 &&
          Object.hasOwn(branch, 'const')
      ) &&
      (keyword === 'anyOf' ||
        new Set(
          branches.map((branch) =>
            JSON.stringify((branch as Record<string, unknown>).const)
          )
        ).size === branches.length)
    )
    {
      const candidate: Record<string, unknown> = {
        ...record,
        enum: branches.map(
          (branch) => (branch as Record<string, unknown>).const
        ),
      }
      delete candidate[keyword]
      return candidate
    }
    if (
      branches.every(
        (branch) =>
          branch !== null &&
          typeof branch === 'object' &&
          !Array.isArray(branch) &&
          Object.keys(branch).length === 1 &&
          typeof (branch as Record<string, unknown>).type === 'string'
      ) &&
      (keyword === 'anyOf' ||
        new Set(
          branches.map((branch) => (branch as Record<string, unknown>).type)
        ).size === branches.length)
    )
    {
      const candidate: Record<string, unknown> = {
        ...record,
        type: branches.map(
          (branch) => (branch as Record<string, unknown>).type
        ),
      }
      delete candidate[keyword]
      return candidate
    }
    const nullIndex = branches.findIndex(
      (branch) =>
        branch !== null &&
        typeof branch === 'object' &&
        !Array.isArray(branch) &&
        Object.keys(branch).length === 1 &&
        (branch as Record<string, unknown>).type === 'null'
    )
    if (nullIndex < 0 || branches.length !== 2) continue
    const other = branches[1 - nullIndex]
    if (other === null || typeof other !== 'object' || Array.isArray(other))
    {
      continue
    }
    const otherRecord = other as Record<string, unknown>
    const types =
      typeof otherRecord.type === 'string'
        ? [otherRecord.type]
        : Array.isArray(otherRecord.type) &&
            otherRecord.type.every((entry) => typeof entry === 'string')
          ? otherRecord.type
          : null
    if (
      !types ||
      types.includes('null') ||
      Object.keys(otherRecord).some(
        (key) => !NULL_SAFE_SCHEMA_KEYWORDS.has(key)
      )
    )
    {
      continue
    }
    const candidate: Record<string, unknown> = {
      ...record,
      ...otherRecord,
      type: ['null', ...types],
    }
    delete candidate[keyword]
    return candidate
  }
  return record
}

interface StringTrie
{
  terminal: boolean
  children: Map<string, StringTrie>
}

function regexLiteral(value: string): string
{
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

function regexClassLiteral(value: string): string
{
  return value.replace(/[\\\]^-]/g, '\\$&')
}

function stringTriePattern(values: string[]): string
{
  const root: StringTrie = { terminal: false, children: new Map() }
  for (const value of [...new Set(values)].sort())
  {
    let node = root
    for (const character of value)
    {
      let child = node.children.get(character)
      if (!child)
      {
        child = { terminal: false, children: new Map() }
        node.children.set(character, child)
      }
      node = child
    }
    node.terminal = true
  }
  const render = (node: StringTrie): string =>
  {
    const suffixes = new Map<string, string[]>()
    for (const [character, child] of node.children)
    {
      const suffix = render(child)
      const characters = suffixes.get(suffix) ?? []
      characters.push(character)
      suffixes.set(suffix, characters)
    }
    const alternatives = [...suffixes.entries()].map(([suffix, characters]) =>
    {
      const alternation = `(?:${characters
        .map(regexLiteral)
        .join('|')})${suffix}`
      const characterClass = `[${characters
        .map(regexClassLiteral)
        .join('')}]${suffix}`
      return characters.length === 1
        ? regexLiteral(characters[0]!) + suffix
        : characterClass.length < alternation.length
          ? characterClass
          : alternation
    })
    const descendants =
      alternatives.length === 0
        ? ''
        : alternatives.length === 1
          ? alternatives[0]!
          : `(?:${alternatives.join('|')})`
    if (!node.terminal) return descendants
    return descendants === '' ? '' : `(?:${descendants})?`
  }
  return `^${render(root)}(?![^])`
}

function compressSchemaSurface(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(compressSchemaSurface)
  if (value === null || typeof value !== 'object') return value
  const record = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      compressSchemaSurface(entry),
    ])
  )
  if (
    Array.isArray(record.enum) &&
    record.enum.length > 1 &&
    record.enum.every((entry) => typeof entry === 'string') &&
    record.pattern === undefined
  )
  {
    const candidate: Record<string, unknown> = {
      ...record,
      type: 'string',
      pattern: stringTriePattern(record.enum as string[]),
    }
    delete candidate.enum
    if (JSON.stringify(candidate).length < JSON.stringify(record).length)
    {
      return candidate
    }
  }
  if (
    record.properties !== null &&
    typeof record.properties === 'object' &&
    !Array.isArray(record.properties)
  )
  {
    const properties = record.properties as Record<string, unknown>
    const groups = new Map<string, { names: string[]; schema: unknown }>()
    for (const [name, schema] of Object.entries(properties))
    {
      const identity = JSON.stringify(schema)
      const group = groups.get(identity)
      if (group) group.names.push(name)
      else groups.set(identity, { names: [name], schema })
    }
    const remaining = { ...properties }
    const patterns = {
      ...((record.patternProperties as Record<string, unknown> | undefined) ??
        {}),
    }
    for (const group of groups.values())
    {
      if (group.names.length < 2) continue
      const pattern = stringTriePattern(group.names)
      const explicit = Object.fromEntries(
        group.names.map((name) => [name, group.schema])
      )
      if (
        JSON.stringify({ [pattern]: group.schema }).length >=
        JSON.stringify(explicit).length
      )
      {
        continue
      }
      for (const name of group.names) delete remaining[name]
      patterns[pattern] = group.schema
    }
    const candidate = { ...record }
    if (Object.keys(remaining).length === 0) delete candidate.properties
    else candidate.properties = remaining
    if (Object.keys(patterns).length > 0)
    {
      candidate.patternProperties = patterns
    }
    if (JSON.stringify(candidate).length < JSON.stringify(record).length)
    {
      return candidate
    }
  }
  return record
}

function inlineEconomicDefinitions(schema: JsonSchema): JsonSchema
{
  const root = { ...schema }
  const definitions = {
    ...((root.$defs as Record<string, unknown> | undefined) ?? {}),
  }
  delete root.$defs
  const referenceCounts = (): {
    counts: Map<string, number>
    nonreplaceable: Set<string>
  } =>
  {
    const counts = new Map<string, number>()
    const nonreplaceable = new Set<string>()
    const visit = (value: unknown): void =>
    {
      if (Array.isArray(value))
      {
        value.forEach(visit)
        return
      }
      if (value === null || typeof value !== 'object') return
      const record = value as Record<string, unknown>
      if (typeof record.$ref === 'string')
      {
        const name = referencedDefinitionName(record.$ref)
        if (name)
        {
          counts.set(name, (counts.get(name) ?? 0) + 1)
          if (Object.keys(record).length !== 1) nonreplaceable.add(name)
        }
      }
      Object.values(record).forEach(visit)
    }
    visit(root)
    Object.values(definitions).forEach(visit)
    return { counts, nonreplaceable }
  }
  const dependencies = (): Map<string, Set<string>> =>
  {
    const graph = new Map<string, Set<string>>()
    for (const [name, definition] of Object.entries(definitions))
    {
      const targets = new Set<string>()
      const visit = (value: unknown): void =>
      {
        if (Array.isArray(value))
        {
          value.forEach(visit)
          return
        }
        if (value === null || typeof value !== 'object') return
        const record = value as Record<string, unknown>
        if (typeof record.$ref === 'string')
        {
          const target = referencedDefinitionName(record.$ref)
          if (target) targets.add(target)
        }
        Object.values(record).forEach(visit)
      }
      visit(definition)
      graph.set(name, targets)
    }
    return graph
  }
  const recursiveNames = (graph: Map<string, Set<string>>): Set<string> =>
  {
    const recursive = new Set<string>()
    for (const name of graph.keys())
    {
      const pending = [...(graph.get(name) ?? [])]
      const seen = new Set<string>()
      while (pending.length > 0)
      {
        const current = pending.pop()!
        if (current === name)
        {
          recursive.add(name)
          break
        }
        if (seen.has(current)) continue
        seen.add(current)
        pending.push(...(graph.get(current) ?? []))
      }
    }
    return recursive
  }
  const replaceReference = (value: unknown, name: string): unknown =>
  {
    if (Array.isArray(value))
    {
      return value.map((entry) => replaceReference(entry, name))
    }
    if (value === null || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    if (
      Object.keys(record).length === 1 &&
      referencedDefinitionName(String(record.$ref ?? '')) === name
    )
    {
      return structuredClone(definitions[name])
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [
        key,
        replaceReference(entry, name),
      ])
    )
  }
  while (true)
  {
    const { counts, nonreplaceable } = referenceCounts()
    for (const name of Object.keys(definitions))
    {
      if ((counts.get(name) ?? 0) === 0) delete definitions[name]
    }
    const graph = dependencies()
    const recursive = recursiveNames(graph)
    const candidates = Object.entries(definitions)
      .filter(([name]) => !recursive.has(name) && !nonreplaceable.has(name))
      .map(([name, definition]) =>
      {
        const count = counts.get(name) ?? 0
        const inlineBytes = count * JSON.stringify(definition).length
        const anchoredDefinition = {
          [name]: { $anchor: name, ...(definition as Record<string, unknown>) },
        }
        const retainedBytes =
          JSON.stringify(anchoredDefinition).length +
          count * JSON.stringify({ $ref: `#${name}` }).length
        return { name, saving: retainedBytes - inlineBytes }
      })
      .filter((entry) => entry.saving > 0)
      .sort((left, right) =>
        left.saving !== right.saving
          ? right.saving - left.saving
          : left.name < right.name
            ? -1
            : left.name > right.name
              ? 1
              : 0
      )
    const selected = candidates[0]
    if (!selected) break
    const rewrittenRoot = replaceReference(root, selected.name) as JsonSchema
    for (const key of Object.keys(root)) delete root[key]
    Object.assign(root, rewrittenRoot)
    for (const [name, definition] of Object.entries(definitions))
    {
      if (name === selected.name) continue
      definitions[name] = replaceReference(definition, selected.name)
    }
    delete definitions[selected.name]
  }
  return { ...root, $defs: definitions }
}

function deduplicateSchemaSubtrees(schema: JsonSchema): JsonSchema
{
  const schemaMapKeywords = new Set([
    '$defs',
    'dependentSchemas',
    'patternProperties',
    'properties',
  ])
  const schemaArrayKeywords = new Set([
    'allOf',
    'anyOf',
    'oneOf',
    'prefixItems',
  ])
  const schemaValueKeywords = new Set([
    'additionalItems',
    'additionalProperties',
    'contains',
    'contentSchema',
    'else',
    'if',
    'items',
    'not',
    'propertyNames',
    'then',
    'unevaluatedItems',
    'unevaluatedProperties',
  ])
  const counts = new Map<
    string,
    { count: number; schema: Record<string, unknown>; byteLength: number }
  >()
  const collect = (value: unknown): void =>
  {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value))
    {
      value.forEach(collect)
      return
    }
    const record = value as Record<string, unknown>
    if (typeof record.$ref !== 'string')
    {
      const identity = JSON.stringify(record)
      const current = counts.get(identity)
      if (current) current.count += 1
      else
      {
        counts.set(identity, {
          count: 1,
          schema: record,
          byteLength: Buffer.byteLength(identity, 'utf8'),
        })
      }
    }
    for (const [key, entry] of Object.entries(record))
    {
      if (schemaMapKeywords.has(key))
      {
        if (
          entry !== null &&
          typeof entry === 'object' &&
          !Array.isArray(entry)
        )
        {
          Object.values(entry).forEach(collect)
        }
      }
      else if (schemaArrayKeywords.has(key))
      {
        if (Array.isArray(entry)) entry.forEach(collect)
      }
      else if (schemaValueKeywords.has(key))
      {
        collect(entry)
      }
    }
  }
  collect(schema)
  const selected = [...counts.entries()]
    .filter(
      ([, entry]) =>
        entry.count >= 2 &&
        (entry.count - 1) * entry.byteLength > entry.count * 13 + 18
    )
    .sort(([leftIdentity, left], [rightIdentity, right]) =>
    {
      if (left.byteLength !== right.byteLength)
      {
        return right.byteLength - left.byteLength
      }
      return leftIdentity < rightIdentity
        ? -1
        : leftIdentity > rightIdentity
          ? 1
          : 0
    })
  const occupiedAliases = new Set(Object.keys(schema.$defs as object))
  let aliasIndex = 0
  const aliases = new Map(
    selected.map(([identity]) =>
    {
      while (occupiedAliases.has(schemaAlias(aliasIndex))) aliasIndex++
      const alias = schemaAlias(aliasIndex++)
      occupiedAliases.add(alias)
      return [identity, alias] as const
    })
  )
  const rewrite = (value: unknown, ownIdentity?: string): unknown =>
  {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map((entry) => rewrite(entry))
    const record = value as Record<string, unknown>
    if (typeof record.$ref !== 'string')
    {
      const identity = JSON.stringify(record)
      const alias = aliases.get(identity)
      if (alias && identity !== ownIdentity)
      {
        return { $ref: `#/$defs/${alias}` }
      }
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) =>
      {
        if (
          schemaMapKeywords.has(key) &&
          entry !== null &&
          typeof entry === 'object' &&
          !Array.isArray(entry)
        )
        {
          return [
            key,
            Object.fromEntries(
              Object.entries(entry).map(([name, child]) => [
                name,
                rewrite(child),
              ])
            ),
          ]
        }
        if (schemaArrayKeywords.has(key) && Array.isArray(entry))
        {
          return [key, entry.map((child) => rewrite(child))]
        }
        if (schemaValueKeywords.has(key)) return [key, rewrite(entry)]
        return [key, entry]
      })
    )
  }
  const originalDefinitions = schema.$defs as Record<string, unknown>
  const root = { ...schema }
  delete root.$defs
  const definitions = Object.fromEntries(
    Object.entries(originalDefinitions).map(([name, value]) => [
      name,
      rewrite(value),
    ])
  )
  for (const [identity, entry] of selected)
  {
    definitions[aliases.get(identity)!] = rewrite(entry.schema, identity)
  }
  return { ...(rewrite(root) as JsonSchema), $defs: definitions }
}

function anchorDefinitions(schema: JsonSchema): JsonSchema
{
  const definitions = schema.$defs as Record<string, unknown>
  const referenceCounts = new Map(
    Object.keys(definitions).map((name) => [name, 0])
  )
  const countReferences = (value: unknown): void =>
  {
    if (Array.isArray(value))
    {
      value.forEach(countReferences)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string')
    {
      const name = referencedDefinitionName(record.$ref)
      if (name && referenceCounts.has(name))
      {
        referenceCounts.set(name, referenceCounts.get(name)! + 1)
      }
    }
    Object.values(record).forEach(countReferences)
  }
  countReferences(schema)
  const anchoredNames = new Set(
    Object.keys(definitions).filter(
      (name) => referenceCounts.get(name)! * 7 > 13 + name.length
    )
  )
  const rewrite = (value: unknown): unknown =>
  {
    if (Array.isArray(value)) return value.map(rewrite)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
      {
        if (key === '$ref' && typeof entry === 'string')
        {
          const name = referencedDefinitionName(entry)
          if (name && anchoredNames.has(name)) return [key, `#${name}`]
        }
        return [key, rewrite(entry)]
      })
    )
  }
  const root = { ...schema }
  delete root.$defs
  const anchored = {
    ...(rewrite(root) as JsonSchema),
    $defs: Object.fromEntries(
      Object.entries(definitions).map(([name, value]) => [
        name,
        anchoredNames.has(name)
          ? { $anchor: name, ...(rewrite(value) as Record<string, unknown>) }
          : rewrite(value),
      ])
    ),
  }
  const visit = (value: unknown): void =>
  {
    if (Array.isArray(value))
    {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (
      typeof record.$ref === 'string' &&
      record.$ref.startsWith('#') &&
      !record.$ref.startsWith('#/')
    )
    {
      const anchor = record.$ref.slice(1)
      if (!anchoredNames.has(anchor))
      {
        throw new Error(`tool schema references missing anchor ${anchor}`)
      }
    }
    Object.values(record).forEach(visit)
  }
  visit(anchored)
  return anchored
}

function prioritizeDefinitionAliases(schema: JsonSchema): JsonSchema
{
  const definitions = schema.$defs as Record<string, unknown>
  const counts = new Map(Object.keys(definitions).map((name) => [name, 0]))
  const count = (value: unknown): void =>
  {
    if (Array.isArray(value))
    {
      value.forEach(count)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string')
    {
      const name = referencedDefinitionName(record.$ref)
      if (name && counts.has(name)) counts.set(name, counts.get(name)! + 1)
    }
    Object.values(record).forEach(count)
  }
  count(schema)
  const names = Object.keys(definitions).sort((left, right) =>
  {
    const frequency = counts.get(right)! - counts.get(left)!
    if (frequency !== 0) return frequency
    return left < right ? -1 : left > right ? 1 : 0
  })
  const aliases = new Map(
    names.map((name, index) => [name, schemaAlias(index)] as const)
  )
  const rewrite = (value: unknown): unknown =>
  {
    if (Array.isArray(value)) return value.map(rewrite)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
      {
        if (key === '$ref' && typeof entry === 'string')
        {
          const name = referencedDefinitionName(entry)
          const alias = name ? aliases.get(name) : undefined
          return [key, alias ? `#/$defs/${alias}` : entry]
        }
        return [key, rewrite(entry)]
      })
    )
  }
  const root = { ...schema }
  delete root.$defs
  return {
    ...(rewrite(root) as JsonSchema),
    $defs: Object.fromEntries(
      names.map((name) => [aliases.get(name)!, rewrite(definitions[name])])
    ),
  }
}

function pruneUnusedDefinitions(schema: JsonSchema): JsonSchema
{
  const definitions = schema.$defs as Record<string, unknown>
  const anchoredNames = new Map(
    Object.entries(definitions).flatMap(([name, definition]) =>
    {
      if (
        definition === null ||
        typeof definition !== 'object' ||
        Array.isArray(definition) ||
        typeof (definition as Record<string, unknown>).$anchor !== 'string'
      )
      {
        return []
      }
      return [
        [
          (definition as Record<string, unknown>).$anchor as string,
          name,
        ] as const,
      ]
    })
  )
  const reachable = new Set<string>()
  const visit = (value: unknown): void =>
  {
    if (Array.isArray(value))
    {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string')
    {
      const name =
        referencedDefinitionName(record.$ref) ??
        (record.$ref.startsWith('#')
          ? (anchoredNames.get(record.$ref.slice(1)) ?? null)
          : null)
      if (name && !reachable.has(name))
      {
        const definition = definitions[name]
        if (definition === undefined)
        {
          throw new Error(`tool schema references missing definition ${name}`)
        }
        reachable.add(name)
        visit(definition)
      }
    }
    Object.values(record).forEach(visit)
  }
  const root = { ...schema }
  delete root.$defs
  visit(root)
  return {
    ...root,
    $defs: Object.fromEntries(
      Object.entries(definitions).filter(([name]) => reachable.has(name))
    ),
  }
}

function compactDefinitions(
  schema: JsonSchema,
  allowRequiredCompaction: boolean
): JsonSchema
{
  const definitions =
    (schema.$defs as Record<string, unknown> | undefined) ?? {}
  const reachable = new Set<string>()
  const visit = (value: unknown): void =>
  {
    if (Array.isArray(value))
    {
      value.forEach(visit)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (typeof record.$ref === 'string')
    {
      const name = referencedDefinitionName(record.$ref)
      if (name && !reachable.has(name))
      {
        const target = definitions[name]
        if (target === undefined)
        {
          throw new Error(`tool schema references missing definition ${name}`)
        }
        reachable.add(name)
        visit(target)
      }
    }
    for (const [key, entry] of Object.entries(record))
    {
      if (key !== '$defs') visit(entry)
    }
  }
  const root = { ...schema }
  delete root.$defs
  delete root.$schema
  visit(root)
  const names = [...reachable].sort()
  const aliases = new Map(
    names.map((name, index) => [name, schemaAlias(index)] as const)
  )
  const rewrite = (value: unknown): unknown =>
  {
    if (Array.isArray(value)) return value.map(rewrite)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) =>
      {
        if (key === '$ref' && typeof entry === 'string')
        {
          const name = referencedDefinitionName(entry)
          const alias = name ? aliases.get(name) : undefined
          return [key, alias ? `#/$defs/${alias}` : entry]
        }
        return [key, rewrite(entry)]
      })
    )
  }
  const reachableSchema = {
    ...(rewrite(root) as JsonSchema),
    $defs: Object.fromEntries(
      names.map((name) => [
        aliases.get(name)!,
        rewrite(structuredClone(definitions[name])),
      ])
    ),
  }
  const optimize = (source: JsonSchema): JsonSchema =>
  {
    let prepared = source
    let best: JsonSchema | null = null
    for (let pass = 0; pass < 8; pass++)
    {
      const minimized = minimizeLogicalSchemas(
        prepared,
        allowRequiredCompaction
      )
      const factored = factorClosedObjectUnions(minimized)
      const merged = mergeConstVariantUnions(factored)
      const simple = mergeSimpleUnions(merged)
      const compressed = compressSchemaSurface(simple) as JsonSchema
      const inlined = inlineEconomicDefinitions(compressed)
      const deduplicated = pruneUnusedDefinitions(
        deduplicateSchemaSubtrees(inlined)
      )
      const postInlined = pruneUnusedDefinitions(
        inlineEconomicDefinitions(deduplicated)
      )
      const candidate = [deduplicated, postInlined]
        .map((entry) => anchorDefinitions(prioritizeDefinitionAliases(entry)))
        .sort(
          (left, right) =>
            JSON.stringify(left).length - JSON.stringify(right).length
        )[0]!
      if (
        !best ||
        JSON.stringify(candidate).length < JSON.stringify(best).length
      )
      {
        best = candidate
      }
      if (JSON.stringify(postInlined) === JSON.stringify(prepared)) break
      prepared = postInlined
    }
    return best!
  }
  const regular = optimize(structuredClone(reachableSchema))
  const materialized = optimize(
    inlineEconomicDefinitions(structuredClone(reachableSchema))
  )
  return JSON.stringify(materialized).length < JSON.stringify(regular).length
    ? materialized
    : regular
}

function materializeRootReference(schema: JsonSchema): JsonSchema
{
  const rootReference = schema.$ref
  if (typeof rootReference !== 'string') return schema
  const definitions =
    (schema.$defs as Record<string, unknown> | undefined) ?? {}
  const definitionName =
    referencedDefinitionName(rootReference) ??
    Object.entries(definitions).find(([, definition]) =>
    {
      return (
        definition !== null &&
        typeof definition === 'object' &&
        !Array.isArray(definition) &&
        (definition as Record<string, unknown>).$anchor ===
          rootReference.slice(1)
      )
    })?.[0]
  if (!definitionName) return schema
  const definition = definitions[definitionName]
  if (
    definition === null ||
    typeof definition !== 'object' ||
    Array.isArray(definition)
  )
  {
    return schema
  }
  const root = { ...schema }
  delete root.$ref
  delete root.$defs
  const materialized = { ...(definition as JsonSchema) }
  delete materialized.$anchor
  for (const [key, value] of Object.entries(root))
  {
    if (
      Object.hasOwn(materialized, key) &&
      JSON.stringify(materialized[key]) !== JSON.stringify(value)
    )
    {
      throw new Error(`tool input root conflicts with definition ${key}`)
    }
    materialized[key] = value
  }
  return pruneUnusedDefinitions({ ...materialized, $defs: definitions })
}

function editTool(name: EditToolName): Tool
{
  const descriptor = EDIT_TOOL_DESCRIPTORS.find((entry) => entry.name === name)
  if (!descriptor) throw new Error(`missing edit tool descriptor ${name}`)
  const inputSchema = materializeRootReference(
    compactDefinitions(
      structuredClone(
        emitJsonSchema202012(toolInputSchemaModel(name))
      ) as JsonSchema,
      false
    )
  )
  const outputSchema = compactDefinitions(
    structuredClone(
      emitJsonSchema202012(toolOutputSchemaModel(name))
    ) as JsonSchema,
    true
  )
  return {
    name,
    description: descriptor.purpose,
    inputSchema: { type: 'object', ...inputSchema } as Tool['inputSchema'],
    outputSchema: { type: 'object', ...outputSchema } as Tool['outputSchema'],
    annotations: descriptor.annotations,
    execution: { taskSupport: descriptor.taskSupport },
  }
}

function projectTool(name: (typeof PROJECT_TOOL_NAMES)[number]): Tool
{
  const source = PROJECT_TOOLS.find((tool) => tool.name === name)
  if (!source) throw new Error(`missing current project tool ${name}`)
  return {
    ...structuredClone(source),
    inputSchema: compactDefinitions(
      structuredClone(source.inputSchema) as JsonSchema,
      false
    ) as Tool['inputSchema'],
    outputSchema: compactDefinitions(
      projectOutputSchema(name),
      true
    ) as Tool['outputSchema'],
  }
}

// the exact A0-frozen profileToolOrder: 4 project_* then 13 edit_* in lifecycle order
export function scratchMcpProfileToolsV1(): Tool[]
{
  return [
    ...PROJECT_TOOL_NAMES.map(projectTool),
    ...EDIT_TOOL_NAMES.map(editTool),
  ]
}
