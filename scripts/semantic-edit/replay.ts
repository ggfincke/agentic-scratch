// scripts/semantic-edit/replay.ts
// replay retained edit sessions w/ zero agent executions

import { replaySemanticEditRunV1 } from '@scratch-agent/edit'

interface CliOptions
{
  runRoot: string
  outRoot?: string
}

const USAGE =
  'usage: npm run semantic-edit-replay -- --run <edit-run-dir> [--out <report-dir>]'

function fail(message: string): never
{
  throw new Error(`${message}\n${USAGE}`)
}

function parseArgs(argv: string[]): CliOptions
{
  let runRoot: string | undefined
  let outRoot: string | undefined
  for (let index = 0; index < argv.length; index++)
  {
    const flag = argv[index]
    if (flag !== '--run' && flag !== '--out') fail(`unknown argument: ${flag}`)
    const value = argv[++index]
    if (!value || value.startsWith('--'))
      fail(`${flag} requires a non-empty value`)
    if (flag === '--run')
    {
      if (runRoot) fail('--run may be supplied only once')
      runRoot = value
      continue
    }
    if (outRoot) fail('--out may be supplied only once')
    outRoot = value
  }
  if (!runRoot) fail('--run is required')
  return outRoot ? { runRoot, outRoot } : { runRoot }
}

async function main(): Promise<void>
{
  const options = parseArgs(process.argv.slice(2))
  const { report, outRoot } = await replaySemanticEditRunV1(options)
  const acceptance = report.acceptance
  process.stdout.write(
    [
      `${acceptance.passed ? 'PASSED' : 'FAILED'} SEMANTIC EDIT REPLAY`,
      `source run: ${report.sourceRunId}`,
      `run root: ${report.runRoot}`,
      `exact matches: ${acceptance.exactMatches}/${acceptance.total}`,
      `agent invocations: ${acceptance.agentExecutions}`,
      `store write attempts: ${acceptance.storeWriteAttempts}`,
      `reconstructed external observations: ${acceptance.reconstructedExternalObservations}`,
      ...report.sessions.map(
        (session) =>
          `session ${session.sessionId}: ${session.matched ? 'exact' : 'FAILED'} ${session.state} revisions=${session.revisions} certificates=${session.certificates} exports=${session.exports} published=${session.publishedSha256 ?? 'none'} report=${session.reportComplete ? 'complete' : 'INCOMPLETE'}`
      ),
      ...report.sessions.flatMap((session) =>
        session.failures.map((failure) => `  ${session.sessionKey}: ${failure}`)
      ),
      ...(outRoot ? [`reports: ${outRoot}`] : []),
    ].join('\n') + '\n'
  )
  if (!acceptance.passed) process.exitCode = 1
}

main().catch((error: unknown) =>
{
  const message = error instanceof Error ? error.message : 'unknown error'
  process.stderr.write(`semantic-edit-replay: ${message}\n`)
  process.exitCode = 1
})
