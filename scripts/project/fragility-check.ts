// scripts/project/fragility-check.ts
// run the read-only selected-project fragility lane & retain bounded evidence

import { execFileSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'

import {
  FragilityCheckInputError,
  readFragilityCheckInput,
  runFragilityCheck,
  type FragilityInputReadFailure,
} from '@scratch-agent/eval'
import { newRunId } from '@scratch-agent/runner'

type FailOn = 'high' | 'medium' | 'low'

interface CliOptions
{
  input: string
  runsRoot: string
  failOn: FailOn | null
}

function usage(): never
{
  throw new Error(
    'usage: npm run fragility-check -- --input <path.sb3> [--runs-root <dir>] [--fail-on <high|medium|low>]'
  )
}

function parseArgs(argv: string[]): CliOptions
{
  let input: string | undefined
  let runsRoot = 'runs'
  let failOn: FailOn | null = null
  const seen = new Set<string>()
  for (let index = 0; index < argv.length; index++)
  {
    const arg = argv[index]
    if (arg !== '--input' && arg !== '--runs-root' && arg !== '--fail-on')
    {
      usage()
    }
    if (seen.has(arg)) usage()
    seen.add(arg)
    const value = argv[++index]
    if (!value || value.startsWith('--')) usage()
    if (arg === '--input')
    {
      input = value
    }
    else if (arg === '--runs-root')
    {
      runsRoot = value
    }
    else
    {
      if (value !== 'high' && value !== 'medium' && value !== 'low') usage()
      failOn = value
    }
  }
  if (!input) usage()
  return { input, runsRoot, failOn }
}

function sourceRevision(): string
{
  if (process.env.SOURCE_REVISION) return process.env.SOURCE_REVISION
  try
  {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    const dirty = execFileSync(
      'git',
      ['status', '--porcelain', '--untracked-files=normal'],
      {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim()
    return dirty ? `${head}+dirty` : head
  }
  catch
  {
    return 'unknown'
  }
}

async function main(): Promise<void>
{
  const options = parseArgs(process.argv.slice(2))
  const inputPath = resolve(options.input)
  const runId = `fragility-check-${newRunId()}`
  const runRoot = resolve(options.runsRoot, runId)
  let bytes: Uint8Array | null = null
  let readFailure: FragilityInputReadFailure | undefined
  try
  {
    bytes = readFragilityCheckInput(inputPath)
  }
  catch (error)
  {
    readFailure =
      error instanceof FragilityCheckInputError ? error.failure : 'unavailable'
  }
  const result = await runFragilityCheck({
    input: {
      displayName: basename(inputPath),
      bytes,
      ...(readFailure ? { readFailure } : {}),
    },
    runRoot,
    runId,
    sourceRevision: sourceRevision(),
    failOn: options.failOn,
    probeScriptPath: resolve('scripts/project/fragility-probe.ts'),
  })
  const report = result.report
  const signatureCounts = new Map<string, number>()
  for (const finding of report.findings)
  {
    signatureCounts.set(
      finding.signature,
      (signatureCounts.get(finding.signature) ?? 0) + 1
    )
  }
  process.stdout.write(
    [
      `${report.overall.status.toUpperCase()} ${report.input.displayName}`,
      `findings: ${
        [...signatureCounts.entries()]
          .map(([signature, count]) => `${signature}=${count}`)
          .join(' ') || 'none'
      }`,
      `advisories: ${report.advisories.length}`,
      `report: ${join(result.runRoot, 'fragility-check.json')}`,
    ].join('\n') + '\n'
  )
  if (report.overall.status !== 'passed') process.exitCode = 1
}

main().catch((error: unknown) =>
{
  console.error(error)
  process.exitCode = 1
})
