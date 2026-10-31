// scripts/authoring/cli.ts
// run retained authoring stages through the shared operator-scoped service, one per process or a session of them

import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { clearTimeout, setTimeout } from 'node:timers'
import {
  createAuthoringWorkspaceServiceV1,
  type AuthoringWorkspaceServiceV1,
} from '@scratch-agent/edit'
import {
  readAuthoringHostConfigurationV1,
  createAuthoringToolHostV1,
  describeStandardAuthoringCatalogV2,
  type AuthoringToolNameV1,
  type AuthoringToolHostV1,
} from '@scratch-agent/mcp'

const STAGES = [
  'open',
  'plan',
  'build',
  'evaluate',
  'export',
  'recover-export',
  'inspect',
  'close',
  'replay',
]
const OPTIONS = new Set([
  'host-config',
  'host-sha256',
  'manifest',
  'workspace',
  'plan',
  'build',
  'export',
  'output',
  'collection',
  'cursor',
  'limit',
  'opcode-prefix',
])
const HOST_OPTIONS = new Set(['host-config', 'host-sha256'])

type Options = Record<string, string>

function stageOf(command: unknown, args: Options): string
{
  if (typeof command !== 'string' || !STAGES.includes(command))
    throw new Error(
      'use open, plan, build, evaluate, export, recover-export, inspect, close, replay or session'
    )
  if (command === 'recover-export' && (!args.workspace || !args.export))
    throw new Error(
      'recover-export requires --workspace and --export identities'
    )
  return command
}

function argvOptions(allowed: ReadonlySet<string>): Options
{
  const args: Options = {}
  for (let index = 3; index < process.argv.length; index += 2)
  {
    const key = process.argv[index]?.replace(/^--/u, '')
    const value = process.argv[index + 1]
    if (
      !key ||
      !allowed.has(key) ||
      value === undefined ||
      value.startsWith('--') ||
      Object.hasOwn(args, key)
    )
      throw new Error('unknown, repeated or missing authoring CLI option')
    args[key] = value
  }
  return args
}

const isCatalog = (stage: string, args: Options) =>
  stage === 'inspect' && args.collection === 'catalog'

function catalog(args: Options)
{
  return describeStandardAuthoringCatalogV2({
    ...(args['opcode-prefix'] === undefined
      ? {}
      : { opcodePrefix: args['opcode-prefix'] }),
    ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
    ...(args.limit === undefined ? {} : { pageSize: Number(args.limit) }),
  })
}

async function connect(
  args: Options,
  own: (host: AuthoringToolHostV1) => void
)
{
  const configPath =
    args['host-config'] ?? process.env.SCRATCH_AGENT_WORKBENCH_CONFIG
  if (!configPath)
    throw new Error(
      'provide an operator-owned --host-config file with source, evidence and output roots'
    )
  const { configuration } = await readAuthoringHostConfigurationV1(
    configPath,
    args['host-sha256']
  )
  const service = await createAuthoringWorkspaceServiceV1({
    permissions: configuration.permissions,
  })
  const host = createAuthoringToolHostV1(service)
  own(host)
  return { service, host }
}

async function run(
  stage: string,
  args: Options,
  service: AuthoringWorkspaceServiceV1,
  host: AuthoringToolHostV1,
  signal: AbortSignal
): Promise<unknown>
{
  if (signal.aborted) throw signal.reason
  if (isCatalog(stage, args)) return catalog(args)
  const input: Record<string, unknown> = {}
  if (args.manifest) input.manifestPath = resolve(args.manifest)
  if (args.workspace) input.workspaceId = args.workspace
  if (args.plan) input.planId = args.plan
  if (args.build) input.buildId = args.build
  if (args.export) input.exportId = args.export
  if (args.output) input.destinationPath = resolve(args.output)
  if (args.collection) input.collection = args.collection
  if (args.cursor) input.cursor = args.cursor
  if (args.limit) input.limit = Number(args.limit)
  if (stage !== 'open' && !input.workspaceId && input.manifestPath)
  {
    const opened = await host.call(
      'authoring_open',
      { manifestPath: input.manifestPath as string },
      { signal }
    )
    input.workspaceId = opened.workspaceId
    if (stage === 'build')
    {
      const planned = await host.call(
        'authoring_plan',
        { workspaceId: opened.workspaceId },
        { signal }
      )
      input.planId = planned.planId
    }
  }
  if (stage === 'replay')
  {
    if (
      typeof input.workspaceId !== 'string' ||
      typeof input.buildId !== 'string'
    )
      throw new Error('replay requires --workspace and --build identities')
    const result = await service.replay({
      workspaceId: input.workspaceId,
      buildId: input.buildId,
      signal,
    })
    if (signal.aborted) throw signal.reason
    return result
  }
  return host.call(
    `authoring_${stage.replaceAll('-', '_')}` as AuthoringToolNameV1,
    input,
    { signal }
  )
}

const print = (value: unknown) =>
  process.stdout.write(`${JSON.stringify(value)}\n`)

// one service & host answer each stdin line ({"command": stage, ...its CLI options}) w/ one stdout line, the
// stage's result or {"ok": false, "message"}, so a caller loads the toolkit once & a refused stage leaves it open
async function session(
  service: AuthoringWorkspaceServiceV1,
  host: AuthoringToolHostV1,
  signal: AbortSignal
)
{
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const abort = () => lines.close()
  signal.addEventListener('abort', abort, { once: true })
  try
  {
    for await (const line of lines)
    {
      if (!line.trim()) continue
      try
      {
        if (Buffer.byteLength(line) > 16 * 1024)
          throw new Error('authoring session command exceeds 16 KiB')
        const parsed: unknown = JSON.parse(line)
        if (parsed === null || typeof parsed !== 'object')
          throw new Error('authoring session command must be a JSON object')
        const { command, ...args } = parsed as Record<string, unknown>
        if (
          Object.entries(args).some(
            ([key, value]) =>
              !OPTIONS.has(key) ||
              HOST_OPTIONS.has(key) ||
              typeof value !== 'string'
          )
        )
          throw new Error(
            'authoring session commands take their stage options as text; the session owns the host'
          )
        const options = args as Options
        print(
          await run(stageOf(command, options), options, service, host, signal)
        )
      }
      catch (error)
      {
        if (signal.aborted) throw error
        print({
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (signal.aborted) throw signal.reason
  }
  finally
  {
    signal.removeEventListener('abort', abort)
    lines.close()
  }
}

async function execute(
  signal: AbortSignal,
  own: (host: AuthoringToolHostV1) => void
)
{
  const command = process.argv[2]
  if (command === 'session')
  {
    // stdout carries only responses, so stray library logs go to stderr as the MCP stdio server's do
    const toStderr = (...values: unknown[]): void => console.error(...values)
    console.log = toStderr
    console.info = toStderr
    console.debug = toStderr
    const { service, host } = await connect(argvOptions(HOST_OPTIONS), own)
    if (signal.aborted) throw signal.reason
    await session(service, host, signal)
    return
  }
  const args = argvOptions(OPTIONS)
  const stage = stageOf(command, args)
  if (isCatalog(stage, args))
  {
    print(catalog(args))
    return
  }
  const { service, host } = await connect(args, own)
  print(await run(stage, args, service, host, signal))
}

async function main()
{
  const controller = new AbortController()
  let host: AuthoringToolHostV1 | undefined
  let cleanup:
    | Promise<void | {
        readonly complete: boolean
        readonly issues: readonly string[]
      }>
    | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  const close = () =>
  {
    if (host && !cleanup) cleanup = host.closeAll?.() ?? Promise.resolve()
    return cleanup
  }
  const startDeadline = () =>
  {
    deadline ??= setTimeout(() =>
    {
      process.stderr.write('authoring shutdown incomplete after 15 seconds\n')
      process.exit(1)
    }, 15000)
  }
  const stop = () =>
  {
    startDeadline()
    controller.abort(new Error('authoring CLI was interrupted'))
    void close()?.catch(() => undefined)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
    process.once(signal, stop)
  try
  {
    await execute(controller.signal, (value) =>
    {
      host = value
      if (controller.signal.aborted) void close()?.catch(() => undefined)
    })
  }
  finally
  {
    startDeadline()
    const result = await close()
    if (result && !result.complete)
    {
      process.stderr.write(
        `${JSON.stringify({ message: 'authoring cleanup incomplete', cleanup: result })}\n`
      )
      process.exitCode = 1
    }
    else if (deadline) clearTimeout(deadline)
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
      process.removeListener(signal, stop)
  }
}

main().catch((error: unknown) =>
{
  console.error(
    JSON.stringify({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
})
