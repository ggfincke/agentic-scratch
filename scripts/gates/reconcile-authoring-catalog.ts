// scripts/gates/reconcile-authoring-catalog.ts
// reconcile standard authoring metadata against pinned Scratch source syntax

import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import {
  STANDARD_AUTHORING_DESCRIPTORS_V2,
  STANDARD_AUTHORING_PINNED_SOURCES_V2,
  STANDARD_AUTHORING_PINNED_PACKAGES_V2,
  STANDARD_AUTHORING_EXCLUSIONS_V2,
  STANDARD_PROCEDURE_OPCODES_V2,
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
  assertStandardAuthoringAuthorityV2,
} from '@scratch-agent/ir/edit'

interface SourceBlock
{
  readonly opcode: string
  readonly fields: readonly string[]
  readonly inputs: readonly string[]
  readonly shape: string
  readonly source: string
  readonly visibility?: 'publicExtension' | 'hiddenExtension' | 'extensionMenu'
}

assertStandardAuthoringAuthorityV2()

function declaredCoreOpcodes(source: string, text: string): readonly string[]
{
  const ast = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true)
  const opcodes = new Set<string>()
  descendants(ast, (node) =>
  {
    if (
      !ts.isBinaryExpression(node) ||
      !ts.isPropertyAccessExpression(node.left) ||
      !ts.isPropertyAccessExpression(node.left.expression) ||
      node.left.expression.name.text !== 'Blocks'
    )
      return
    opcodes.add(node.left.name.text)
  })
  return [...opcodes]
}

function legacyVmMenuOpcodes(source: string, text: string): readonly string[]
{
  const ast = ts.createSourceFile(
    source,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const opcodes = new Set<string>()
  descendants(ast, (node) =>
  {
    if (
      !ts.isMethodDeclaration(node) ||
      node.name.getText(ast) !== 'getPrimitives'
    )
      return
    descendants(node, (child) =>
    {
      if (
        ts.isPropertyAssignment(child) &&
        ['sound_beats_menu', 'sound_effects_menu'].includes(
          child.name.getText(ast)
        )
      )
        opcodes.add(child.name.getText(ast))
    })
  })
  return [...opcodes]
}

// extract literals only; the gate never evaluates imported block implementation code
function literal(node: ts.Node): unknown
{
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isNumericLiteral(node)) return Number(node.text)
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal)
  if (ts.isObjectLiteralExpression(node))
  {
    const result: Record<string, unknown> = {}
    for (const property of node.properties)
    {
      if (!ts.isPropertyAssignment(property)) continue
      const name =
        ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : property.name.getText()
      result[name] = literal(property.initializer)
    }
    return result
  }
  return null
}

function record(value: unknown): Record<string, unknown>
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function descendants(node: ts.Node, visit: (node: ts.Node) => void): void
{
  visit(node)
  ts.forEachChild(node, (child) => descendants(child, visit))
}

function coreRows(source: string, text: string): SourceBlock[]
{
  const ast = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true)
  const rows: SourceBlock[] = []
  descendants(ast, (node) =>
  {
    if (
      !ts.isBinaryExpression(node) ||
      !ts.isPropertyAccessExpression(node.left)
    )
      return
    const left = node.left
    if (
      !ts.isPropertyAccessExpression(left.expression) ||
      left.expression.name.text !== 'Blocks'
    )
      return
    const opcode = left.name.text
    descendants(node.right, (child) =>
    {
      if (
        !ts.isCallExpression(child) ||
        !ts.isPropertyAccessExpression(child.expression) ||
        child.expression.name.text !== 'jsonInit' ||
        !child.arguments[0]
      )
        return
      const metadata = record(literal(child.arguments[0]))
      const args = Object.entries(metadata)
        .filter(([key]) => /^args\d+$/u.test(key))
        .flatMap(([, value]) => (Array.isArray(value) ? value : []))
        .map(record)
      const fields = args
        .filter(
          (arg) =>
            String(arg.type).startsWith('field_') &&
            typeof arg.name === 'string'
        )
        .map((arg) => String(arg.name))
        .sort()
      const inputs = args
        .filter(
          (arg) =>
            String(arg.type).startsWith('input_') &&
            typeof arg.name === 'string'
        )
        .map((arg) => String(arg.name))
        .sort()
      const extensions = Array.isArray(metadata.extensions)
        ? metadata.extensions
        : []
      const shape = extensions.includes('shape_hat')
        ? 'hat'
        : extensions.includes('output_boolean')
          ? 'boolean'
          : Object.hasOwn(metadata, 'output') ||
              extensions.some((entry) => String(entry).startsWith('output_'))
            ? 'reporter'
            : extensions.includes('shape_end')
              ? 'cap'
              : 'stack'
      rows.push({ opcode, fields, inputs, shape, source })
    })
  })
  return rows
}

function extensionRows(
  source: string,
  text: string,
  prefix: string
): SourceBlock[]
{
  const ast = ts.createSourceFile(
    source,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const rows: SourceBlock[] = []
  descendants(ast, (node) =>
  {
    if (!ts.isMethodDeclaration(node) || node.name.getText(ast) !== 'getInfo')
      return
    descendants(node, (child) =>
    {
      if (!ts.isReturnStatement(child) || !child.expression) return
      const info = record(literal(child.expression))
      if (!Array.isArray(info.blocks)) return
      for (const block of info.blocks.map(record))
      {
        if (typeof block.opcode !== 'string') continue
        const shape =
          block.blockType === 'HAT'
            ? 'hat'
            : block.blockType === 'REPORTER'
              ? 'reporter'
              : block.blockType === 'BOOLEAN'
                ? 'boolean'
                : 'stack'
        rows.push({
          opcode: `${prefix}_${block.opcode}`,
          fields: [],
          inputs: Object.keys(record(block.arguments)).sort(),
          shape,
          source,
          visibility:
            block.hideFromPalette === true
              ? 'hiddenExtension'
              : 'publicExtension',
        })
      }
      for (const menu of Object.keys(record(info.menus)))
        rows.push({
          opcode: `${prefix}_menu_${menu}`,
          fields: [menu],
          inputs: [],
          shape: 'menuReporter',
          source,
          visibility: 'extensionMenu',
        })
    })
  })
  return rows
}

function dynamicRows(source: string, text: string): SourceBlock[]
{
  const ast = ts.createSourceFile(
    source,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  const rows: SourceBlock[] = []
  descendants(ast, (node) =>
  {
    if (!ts.isObjectLiteralExpression(node)) return
    const metadata = record(literal(node))
    if (typeof metadata.opcode !== 'string' || !Array.isArray(metadata.argMap))
      return
    const args = metadata.argMap.map(record)
    rows.push({
      opcode: metadata.opcode,
      fields: args
        .filter((arg) => arg.type === 'field')
        .map((arg) => String(arg.fieldName))
        .sort(),
      inputs: args
        .filter((arg) => arg.type === 'input')
        .map((arg) => String(arg.inputName))
        .sort(),
      shape: 'dynamic',
      source,
    })
  })
  return rows
}

const files = [
  ...[
    'motion',
    'looks',
    'sound',
    'event',
    'control',
    'sensing',
    'operators',
    'data',
    'math',
    'text',
    'colour',
    'note',
    'matrix',
    'procedures',
    'vertical_extensions',
  ].map((name) => `node_modules/scratch-blocks/src/blocks/${name}.ts`),
  ...['pen', 'music', 'video_sensing'].map(
    (name) =>
      `node_modules/@scratch/scratch-vm/src/extensions/scratch3_${name}/index.js`
  ),
]
const sources: { path: string; sha256: string }[] = []
const rows: SourceBlock[] = []
const declaredCore = new Set<string>()
for (const source of files)
{
  const bytes = await readFile(source)
  sources.push({
    path: source,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
  if (source.endsWith('.ts'))
    for (const opcode of declaredCoreOpcodes(source, bytes.toString()))
      declaredCore.add(opcode)
  rows.push(
    ...(source.endsWith('.ts')
      ? coreRows(source, bytes.toString())
      : extensionRows(
          source,
          bytes.toString(),
          source.includes('video_sensing')
            ? 'videoSensing'
            : source.includes('scratch3_music')
              ? 'music'
              : 'pen'
        ))
  )
}
const legacySoundSource =
  'node_modules/@scratch/scratch-vm/src/blocks/scratch3_sound.js'
for (const opcode of legacyVmMenuOpcodes(
  legacySoundSource,
  await readFile(legacySoundSource, 'utf8')
))
  declaredCore.add(opcode)
const dynamicSource =
  'node_modules/@scratch/scratch-vm/src/serialization/sb2_specmap.js'
const dynamicBytes = await readFile(dynamicSource)
sources.push({
  path: dynamicSource,
  sha256: createHash('sha256').update(dynamicBytes).digest('hex'),
})
const sourceMap = new Map(
  dynamicRows(dynamicSource, dynamicBytes.toString()).map((row) => [
    row.opcode,
    row,
  ])
)
for (const row of rows) sourceMap.set(row.opcode, row)
const issues: string[] = []
for (const {
  package: name,
  version: expectedVersion,
} of STANDARD_AUTHORING_PINNED_PACKAGES_V2)
{
  const manifest = JSON.parse(
    await readFile(`node_modules/${name}/package.json`, 'utf8')
  ) as { version: string }
  if (manifest.version !== expectedVersion)
    issues.push(`${name}: pinned package version changed`)
}
for (const pinned of STANDARD_AUTHORING_PINNED_SOURCES_V2)
{
  const observed = createHash('sha256')
    .update(await readFile(pinned.path))
    .digest('hex')
  if (!sources.some((source) => source.path === pinned.path))
    sources.push({ path: pinned.path, sha256: observed })
  if (observed !== pinned.sha256)
    issues.push(`${pinned.path}: pinned source hash changed`)
}
const authored = STANDARD_AUTHORING_DESCRIPTORS_V2.filter(
  (row) =>
    row.availability === 'supported' && row.safeBuilderKind === 'ordinaryBlock'
)
for (const descriptor of authored)
{
  const source = sourceMap.get(descriptor.opcode)
  if (!source)
  {
    issues.push(`${descriptor.opcode}: no public source metadata`)
    continue
  }
  const fields = [...descriptor.requiredFields, ...descriptor.optionalFields]
    .map((row) => row.name)
    .sort()
  const inputs = [...descriptor.requiredInputs, ...descriptor.optionalInputs]
    .map((row) => row.name)
    .sort()
  if (JSON.stringify(fields) !== JSON.stringify(source.fields))
    issues.push(`${descriptor.opcode}: field mismatch`)
  if (JSON.stringify(inputs) !== JSON.stringify(source.inputs))
    issues.push(`${descriptor.opcode}: input mismatch`)
  const normalizedShape =
    descriptor.shape === 'cShape'
      ? descriptor.context.mustTerminateSequence
        ? 'cap'
        : 'stack'
      : descriptor.shape
  if (source.shape !== 'dynamic' && normalizedShape !== source.shape)
    issues.push(
      `${descriptor.opcode}: shape mismatch ${normalizedShape}/${source.shape}`
    )
}
const publicExtensions = rows.filter(
  (row) => row.visibility === 'publicExtension'
)
for (const row of publicExtensions)
  if (!authored.some((descriptor) => descriptor.opcode === row.opcode))
    issues.push(`${row.opcode}: public extension missing`)
const coreCount = authored.filter(
  (row) => !/^(pen|music|videoSensing)_/u.test(row.opcode)
).length
if (coreCount !== 121)
  issues.push(`expected 121 public core opcodes; received ${coreCount}`)
const inventorySources = new Set([
  ...declaredCore,
  ...rows
    .filter((row) => row.visibility !== undefined)
    .map((row) => row.opcode),
])
const inventoryClassifications = [
  ...STANDARD_AUTHORING_DESCRIPTORS_V2.map((row) => ({
    opcode: row.opcode,
    classification:
      row.availability === 'supported' ? 'ordinaryAuthorable' : 'builderOnly',
  })),
  ...STANDARD_PROCEDURE_OPCODES_V2.map((opcode) => ({
    opcode,
    classification: 'specializedProcedure',
  })),
  ...STANDARD_AUTHORING_EXCLUSIONS_V2.map((row) => ({
    opcode: row.opcode,
    classification: row.classification,
  })),
]
const classified = new Map<string, string>()
for (const row of inventoryClassifications)
{
  if (classified.has(row.opcode))
    issues.push(`${row.opcode}: duplicate inventory classification`)
  classified.set(row.opcode, row.classification)
  if (!inventorySources.has(row.opcode))
    issues.push(`${row.opcode}: classified opcode absent from pinned sources`)
}
for (const opcode of inventorySources)
  if (!classified.has(opcode))
    issues.push(`${opcode}: source opcode lacks inventory classification`)
for (const row of rows.filter((row) => row.visibility !== undefined))
{
  const expected =
    row.visibility === 'publicExtension'
      ? 'ordinaryAuthorable'
      : row.visibility === 'hiddenExtension'
        ? 'hiddenExtension'
        : 'builderOnly'
  if (classified.get(row.opcode) !== expected)
    issues.push(
      `${row.opcode}: extension visibility differs from classification`
    )
}
for (const descriptor of STANDARD_AUTHORING_DESCRIPTORS_V2.filter(
  (row) => row.availability === 'builderOnly'
))
{
  const source = sourceMap.get(descriptor.opcode)
  if (source === undefined) continue
  const fields = descriptor.requiredFields.map((row) => row.name).sort()
  const inputs = [...descriptor.requiredInputs, ...descriptor.optionalInputs]
    .map((row) => row.name)
    .sort()
  if (JSON.stringify(fields) !== JSON.stringify(source.fields))
    issues.push(`${descriptor.opcode}: helper field mismatch`)
  if (JSON.stringify(inputs) !== JSON.stringify(source.inputs))
    issues.push(`${descriptor.opcode}: helper input mismatch`)
}
if (declaredCore.size !== 173 || inventorySources.size !== 205)
  issues.push(
    `source inventory size differs: core ${declaredCore.size}, total ${inventorySources.size}`
  )
const report = {
  schemaVersion: 2,
  ok: issues.length === 0,
  coreCount,
  extensionCount: publicExtensions.length,
  completeInventoryCount: inventorySources.size,
  authoritySha256: STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.authoritySha256,
  classifications: inventoryClassifications,
  sources,
  rows,
  issues,
}
const args = process.argv.slice(2)
if (
  args.length !== 0 &&
  (args.length !== 2 || args[0] !== '--output' || !args[1])
)
  throw new Error('usage: authoring-catalog-check [--output <report.json>]')
const output = resolve(
  args[1] ?? '.tmp/standard-authoring-catalog-reconciliation.json'
)
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({
    ok: report.ok,
    coreCount,
    extensionCount: report.extensionCount,
    completeInventoryCount: report.completeInventoryCount,
    issues,
    output,
  })
)
if (!report.ok) process.exitCode = 1
