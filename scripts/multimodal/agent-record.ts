// scripts/multimodal/agent-record.ts
// record bounded Codex or preparation-only Multimodal judgment evidence

import { join } from 'node:path'

import {
  multimodalSelectedAgentJudgmentAccepted,
  recordMultimodalAgent,
  type RecordMultimodalAgentOptions,
} from './live-workflow.js'

interface CliOptions
{
  model: string
  reasoningEffort: string
  runsRoot?: string
  selectedInput?: string
  prepareOnly: boolean
}

const DEFAULT_REASONING_EFFORT = 'medium'
const USAGE =
  'usage: npm run multimodal-agent:record -- --model <model> [--reasoning-effort <effort>] [--runs-root <dir>] [--selected-input <path.sb3>] [--prepare-only]'

function fail(message: string): never
{
  throw new Error(`${message}\n${USAGE}`)
}

function requiredValue(argv: string[], index: number, flag: string): string
{
  const value = argv[index + 1]
  if (!value || value.startsWith('--'))
    fail(`${flag} requires a non-empty value`)
  return value
}

function parseArgs(argv: string[]): CliOptions
{
  let model: string | undefined
  let reasoningEffort: string | undefined
  let runsRoot: string | undefined
  let selectedInput: string | undefined
  let prepareOnly = false

  for (let index = 0; index < argv.length; index++)
  {
    const flag = argv[index]
    if (flag === '--prepare-only')
    {
      if (prepareOnly) fail('--prepare-only may be supplied only once')
      prepareOnly = true
      continue
    }
    if (
      flag !== '--model' &&
      flag !== '--reasoning-effort' &&
      flag !== '--runs-root' &&
      flag !== '--selected-input'
    )
      fail(`unknown argument: ${flag}`)

    const value = requiredValue(argv, index, flag)
    index++
    if (flag === '--model')
    {
      if (model) fail('--model may be supplied only once')
      model = value
    }
    else if (flag === '--reasoning-effort')
    {
      if (reasoningEffort) fail('--reasoning-effort may be supplied only once')
      reasoningEffort = value
    }
    else if (flag === '--runs-root')
    {
      if (runsRoot) fail('--runs-root may be supplied only once')
      runsRoot = value
    }
    else
    {
      if (selectedInput) fail('--selected-input may be supplied only once')
      selectedInput = value
    }
  }

  if (!model) fail('--model is required and has no implicit default')

  return {
    model,
    reasoningEffort: reasoningEffort ?? DEFAULT_REASONING_EFFORT,
    ...(runsRoot ? { runsRoot } : {}),
    ...(selectedInput ? { selectedInput } : {}),
    prepareOnly,
  }
}

async function main(): Promise<void>
{
  const options = parseArgs(process.argv.slice(2))
  const workflowOptions: RecordMultimodalAgentOptions = { ...options }
  const result = await recordMultimodalAgent(workflowOptions)
  const report = result.report
  const acceptance = report.acceptance
  process.stdout.write(
    [
      `${acceptance.status.toUpperCase()} MULTIMODAL AGENT RECORD`,
      `mode: ${report.mode}`,
      `run: ${result.runRoot}`,
      `Codex: ${options.model}/${options.reasoningEffort}`,
      `judgments: ${acceptance.correctJudgments}/${acceptance.totalJudgments} correct; ${acceptance.brokenFalsePasses} broken false passes`,
      `audited agent invocations: ${report.agentExecution.auditedExecutions}/${report.agentExecution.expectedExecutions}`,
      `selected project: ${report.selectedProject ? 'retained' : options.selectedInput ? 'requested but not retained because the run did not reach selected-project evaluation' : 'not requested'}`,
      `json report: ${join(result.runRoot, 'multimodal-agent-record.json')}`,
      `markdown report: ${join(result.runRoot, 'multimodal-agent-record.md')}`,
    ].join('\n') + '\n'
  )

  if (options.prepareOnly)
  {
    if (
      report.mode !== 'prepare-only' ||
      acceptance.status !== 'not-run' ||
      !report.source.stableBeforeAgent ||
      !report.source.stableAtCompletion ||
      report.corpus.judgments.length !== 12 ||
      report.agentExecution.expectedExecutions !== 0 ||
      report.agentExecution.auditedExecutions !== 0 ||
      (options.selectedInput !== undefined &&
        (report.selectedProject === null ||
          report.selectedProjectSourceStable !== true))
    )
      process.exitCode = 1
    return
  }
  if (report.mode !== 'agent' || acceptance.status !== 'passed')
    process.exitCode = 1
  if (
    options.selectedInput &&
    (report.selectedProjectSourceStable !== true ||
      !multimodalSelectedAgentJudgmentAccepted(report.selectedProject))
  )
    process.exitCode = 1
}

main().catch((error: unknown) =>
{
  const message = error instanceof Error ? error.message : 'unknown error'
  process.stderr.write(`multimodal-agent-record: ${message}\n`)
  process.exitCode = 1
})
