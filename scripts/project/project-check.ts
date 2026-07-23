// scripts/project/project-check.ts
// run the full generic selected-project acceptance workflow & retain evidence

import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'

import { runProjectCheckFile } from '@scratch-agent/eval'
import { newRunId } from '@scratch-agent/runner'

interface CliOptions
{
  input: string
  runsRoot: string
  strictStatic: boolean
}

function usage(): never
{
  throw new Error(
    'usage: npm run project-check -- --input <path.sb3> [--runs-root <dir>] [--strict-static]'
  )
}

function parseArgs(argv: string[]): CliOptions
{
  let input: string | undefined
  let runsRoot = 'runs'
  let strictStatic = false
  for (let index = 0; index < argv.length; index++)
  {
    const arg = argv[index]
    if (arg === '--strict-static')
    {
      strictStatic = true
      continue
    }
    if (arg !== '--input' && arg !== '--runs-root') usage()
    const value = argv[++index]
    if (!value || value.startsWith('--')) usage()
    if (arg === '--input')
    {
      if (input) usage()
      input = value
    }
    else
    {
      runsRoot = value
    }
  }
  if (!input) usage()
  return { input, runsRoot, strictStatic }
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
  const runId = `project-check-${newRunId()}`
  const runRoot = resolve(options.runsRoot, runId)
  const result = await runProjectCheckFile({
    inputPath: resolve(options.input),
    run: { id: runId, root: runRoot, sourceRevision: sourceRevision() },
    profile: 'full',
    strictStatic: options.strictStatic,
  })
  const report = result.report
  process.stdout.write(
    [
      `${report.overall.status.toUpperCase()} ${report.input.displayName}`,
      `run: ${result.runRoot}`,
      `sha256: ${report.input.sha256 ?? 'unavailable'}`,
      `stages: ${Object.entries(report.stages)
        .map(([name, stage]) => `${name}=${stage.status}`)
        .join(' ')}`,
      `wall: ${report.performance.totalMs.toFixed(1)} ms`,
      report.overall.stopReason
        ? `reason: ${report.overall.stopReason.code} ${report.overall.stopReason.message}`
        : 'readiness: structural, preservation, VM, and browser smoke gates passed',
      `report: ${join(result.runRoot, 'project-check.json')}`,
    ].join('\n') + '\n'
  )
  if (report.overall.status !== 'passed') process.exitCode = 1
}

main().catch((error: unknown) =>
{
  console.error(error)
  process.exitCode = 1
})
