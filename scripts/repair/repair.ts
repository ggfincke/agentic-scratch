// scripts/repair/repair.ts
// generate, script-repair, or verify canonical repair artifacts

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'

import {
  buildRepairBenchmark,
  canonicalRepairBenchmarks,
  REPAIR_BENCHMARK_IDS,
  startRepair,
  type RepairBenchmarkDefinition,
  type RepairBenchmarkId,
  type RepairRequest,
} from '@scratch-agent/repair'
import { DEFAULT_SB3_LIMITS } from '@scratch-agent/sb3'

const MAX_INPUT_BYTES = DEFAULT_SB3_LIMITS.maxCompressedBytes

interface ParsedCommand
{
  command: 'fixture' | 'scripted' | 'verify'
  caseId: RepairBenchmarkId | 'all'
  options: Map<string, string>
}

function stdout(value: string): void
{
  process.stdout.write(`${value}\n`)
}

function protectStructuredStdout(): void
{
  const toStderr = (...values: unknown[]): void => console.error(...values)
  console.log = toStderr
  console.info = toStderr
  console.debug = toStderr
}

function usage(): never
{
  throw new Error(
    [
      'usage:',
      '  npm run repair -- fixture <R1|R2|R3|R4|R5|all> --output <path>',
      '  npm run repair -- scripted <R1|R2|R3|R4|R5> [--artifact-root <dir>] [--output <file.sb3>]',
      '  npm run repair -- verify <R1|R2|R3|R4|R5> --input <file.sb3> [--artifact-root <dir>]',
    ].join('\n')
  )
}

function parseCommand(argv: string[]): ParsedCommand
{
  const command = argv[0]
  const caseId = argv[1]
  if (
    !['fixture', 'scripted', 'verify'].includes(command ?? '') ||
    (caseId !== 'all' &&
      !REPAIR_BENCHMARK_IDS.includes(caseId as RepairBenchmarkId))
  )
  {
    usage()
  }
  const options = new Map<string, string>()
  for (let index = 2; index < argv.length; index += 2)
  {
    const name = argv[index]
    const value = argv[index + 1]
    if (!name?.startsWith('--') || !value || value.startsWith('--')) usage()
    if (options.has(name)) usage()
    options.set(name, value)
  }
  const allowed =
    command === 'fixture'
      ? new Set(['--output'])
      : command === 'scripted'
        ? new Set(['--artifact-root', '--output'])
        : new Set(['--artifact-root', '--input'])
  if ([...options.keys()].some((name) => !allowed.has(name))) usage()
  if (command === 'fixture' && !options.has('--output')) usage()
  if (command === 'verify' && !options.has('--input')) usage()
  if (command !== 'fixture' && caseId === 'all') usage()
  return {
    command: command as ParsedCommand['command'],
    caseId: caseId as ParsedCommand['caseId'],
    options,
  }
}

function artifactRoot(options: Map<string, string>): string
{
  const root = resolve(options.get('--artifact-root') ?? 'runs')
  mkdirSync(root, { recursive: true })
  return root
}

function writeExclusive(path: string, bytes: Uint8Array): void
{
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
}

async function writeFixture(
  definition: RepairBenchmarkDefinition,
  outputPath: string
): Promise<void>
{
  const bytes = await definition.broken.toSb3()
  writeExclusive(outputPath, bytes)
  stdout(`${definition.id} broken fixture -> ${outputPath}`)
}

async function fixture(command: ParsedCommand): Promise<void>
{
  const output = resolve(command.options.get('--output')!)
  if (command.caseId === 'all')
  {
    mkdirSync(output, { recursive: true })
    for (const definition of canonicalRepairBenchmarks())
    {
      await writeFixture(
        definition,
        join(output, `${definition.id.toLowerCase()}-broken.sb3`)
      )
    }
    return
  }
  const definition = buildRepairBenchmark(command.caseId)
  const outputPath =
    extname(output).toLowerCase() === '.sb3'
      ? output
      : join(output, `${definition.id.toLowerCase()}-broken.sb3`)
  await writeFixture(definition, outputPath)
}

async function scripted(command: ParsedCommand): Promise<void>
{
  const definition = buildRepairBenchmark(command.caseId as RepairBenchmarkId)
  const session = await startRepair({
    artifactBytes: await definition.broken.toSb3(),
    repairCase: definition.repairCase,
    artifactRoot: artifactRoot(command.options),
  })
  while (true)
  {
    const next = session.nextRequest()
    if (!('requestId' in next)) break
    await session.submitProposal(
      definition.referenceProposal(next as RepairRequest),
      { descriptor: { adapter: 'scripted-cli' } }
    )
  }
  const result = session.result()
  let exportProof = null
  const output = command.options.get('--output')
  if (output)
  {
    exportProof = session.exportAccepted(resolve(output))
  }
  stdout(
    JSON.stringify(
      {
        caseId: definition.id,
        repairCaseId: definition.repairCase.id,
        sessionId: session.id,
        status: result.status,
        attemptsUsed: result.attemptsUsed,
        accepted: result.accepted,
        export: exportProof,
        report: result.report,
      },
      null,
      2
    )
  )
  if (result.status !== 'repaired') process.exitCode = 1
}

async function verify(command: ParsedCommand): Promise<void>
{
  const input = resolve(command.options.get('--input')!)
  const info = statSync(input)
  if (
    extname(input).toLowerCase() !== '.sb3' ||
    !info.isFile() ||
    info.size > MAX_INPUT_BYTES
  )
  {
    throw new Error('verify input must be a regular .sb3 file at most 50 MiB')
  }
  const definition = buildRepairBenchmark(command.caseId as RepairBenchmarkId)
  const session = await startRepair({
    artifactBytes: readFileSync(input),
    repairCase: definition.repairCase,
    artifactRoot: artifactRoot(command.options),
  })
  const snapshot = session.snapshot()
  const result = snapshot.terminal
  stdout(
    JSON.stringify(
      {
        caseId: definition.id,
        input: basename(input),
        sessionId: session.id,
        status: result?.status ?? snapshot.state,
        accepted: result?.accepted ?? null,
        report: result?.report ?? null,
      },
      null,
      2
    )
  )
  if (result?.status !== 'already-passing') process.exitCode = 1
}

async function main(): Promise<void>
{
  protectStructuredStdout()
  const command = parseCommand(process.argv.slice(2))
  switch (command.command)
  {
    case 'fixture':
      await fixture(command)
      return
    case 'scripted':
      await scripted(command)
      return
    case 'verify':
      await verify(command)
  }
}

main().catch((error: unknown) =>
{
  console.error(
    error instanceof Error ? error.message : 'repair command failed'
  )
  process.exitCode = 1
})
