// scripts/multimodal/agent-replay.ts
// replay retained Multimodal judgments w/ zero Codex invocations

import { join } from 'node:path'

import { replayMultimodalAgent } from './live-workflow.js'

interface CliOptions
{
  runRoot: string
}

const USAGE = 'usage: npm run multimodal-agent:replay -- --run <record-run-dir>'

function fail(message: string): never
{
  throw new Error(`${message}\n${USAGE}`)
}

function parseArgs(argv: string[]): CliOptions
{
  let runRoot: string | undefined
  for (let index = 0; index < argv.length; index++)
  {
    const flag = argv[index]
    if (flag !== '--run') fail(`unknown argument: ${flag}`)
    if (runRoot) fail('--run may be supplied only once')
    const value = argv[++index]
    if (!value || value.startsWith('--'))
      fail('--run requires a non-empty value')
    runRoot = value
  }
  if (!runRoot) fail('--run is required')
  return { runRoot }
}

async function main(): Promise<void>
{
  const options = parseArgs(process.argv.slice(2))
  const result = await replayMultimodalAgent(options)
  const acceptance = result.report.acceptance
  process.stdout.write(
    [
      `${acceptance.passed ? 'PASSED' : 'FAILED'} MULTIMODAL AGENT REPLAY`,
      `source run: ${result.report.sourceRunId}`,
      `source Codex transport: ${result.report.sourceAgentExecution.transport}`,
      `authoritative source execution: ${result.report.sourceAgentExecution.authoritative ? 'yes' : 'no'}`,
      `replay: ${result.replayRoot}`,
      `exact matches: ${acceptance.exactMatches}/${acceptance.total}`,
      `agent invocations: ${acceptance.agentExecutions}`,
      `json report: ${join(result.replayRoot, 'multimodal-agent-replay.json')}`,
      `markdown report: ${join(result.replayRoot, 'multimodal-agent-replay.md')}`,
    ].join('\n') + '\n'
  )
  if (!acceptance.passed) process.exitCode = 1
}

main().catch((error: unknown) =>
{
  const message = error instanceof Error ? error.message : 'unknown error'
  process.stderr.write(`multimodal-agent-replay: ${message}\n`)
  process.exitCode = 1
})
