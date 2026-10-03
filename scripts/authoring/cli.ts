// scripts/authoring/cli.ts
// run retained authoring stages through the shared operator-scoped service

import { resolve } from 'node:path'
import { clearTimeout, setTimeout } from 'node:timers'
import { createAuthoringWorkspaceServiceV1 } from '@scratch-agent/edit'
import {
  readAuthoringHostConfigurationV1,
  createAuthoringToolHostV1,
  describeStandardAuthoringCatalogV2,
  type AuthoringToolNameV1,
  type AuthoringToolHostV1,
} from '@scratch-agent/mcp'

async function execute(
  signal: AbortSignal,
  own: (host: AuthoringToolHostV1) => void
)
{
  const command = process.argv[2]
  if (
    ![
      'open',
      'plan',
      'build',
      'evaluate',
      'export',
      'recover-export',
      'inspect',
      'close',
      'replay',
    ].includes(command ?? '')
  )
    throw new Error(
      'use open, plan, build, evaluate, export, recover-export, inspect, close or replay'
    )
  const args: Record<string, string> = {}
  const allowed = new Set([
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
  if (command === 'recover-export' && (!args.workspace || !args.export))
    throw new Error(
      'recover-export requires --workspace and --export identities'
    )
  if (command === 'inspect' && args.collection === 'catalog')
  {
    console.log(
      JSON.stringify(
        describeStandardAuthoringCatalogV2({
          ...(args['opcode-prefix'] === undefined
            ? {}
            : { opcodePrefix: args['opcode-prefix'] }),
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.limit === undefined ? {} : { pageSize: Number(args.limit) }),
        })
      )
    )
    return
  }
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
  if (signal.aborted) throw signal.reason
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
  if (command !== 'open' && !input.workspaceId && input.manifestPath)
  {
    const opened = await host.call(
      'authoring_open',
      { manifestPath: input.manifestPath as string },
      { signal }
    )
    input.workspaceId = opened.workspaceId
    if (command === 'build')
    {
      const planned = await host.call(
        'authoring_plan',
        { workspaceId: opened.workspaceId },
        { signal }
      )
      input.planId = planned.planId
    }
  }
  if (command === 'replay')
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
    console.log(JSON.stringify(result))
    return
  }
  const result = await host.call(
    `authoring_${command?.replaceAll('-', '_')}` as AuthoringToolNameV1,
    input,
    { signal }
  )
  console.log(JSON.stringify(result))
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
