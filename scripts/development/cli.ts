// scripts/development/cli.ts
// keep playtests live in one process while routing bounded commands to shared services

import { resolve } from 'node:path'
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers'
import { fileURLToPath } from 'node:url'
import {
  createDevelopmentServiceV1,
  type DevelopmentEngineFactoryV1,
  type DevelopmentOperatorPermissionsV1,
  type RuntimeExecutionProfileV1,
} from '@scratch-agent/runner'
import {
  createDevelopmentToolHostV1,
  readDevelopmentHostConfigurationV1,
  type DevelopmentToolHostV1,
} from '@scratch-agent/mcp'

function commandLines(onEnd: () => void, onFailure: () => void)
{
  let pending = Buffer.alloc(0)
  const lines: string[] = []
  let queuedBytes = 0
  let ended = false
  let failure: unknown
  let wake: (() => void) | undefined
  const notify = () => wake?.()
  const enqueue = () =>
  {
    if (!pending.length) return
    if (lines.length >= 64 || queuedBytes + pending.length > 1024 * 1024)
      throw new Error('development command queue exceeds 64 bounded lines')
    queuedBytes += pending.length
    lines.push(pending.toString('utf8'))
    pending = Buffer.alloc(0)
  }
  const data = (raw: Buffer) =>
  {
    const chunk = Buffer.from(raw)
    let start = 0
    try
    {
      while (start < chunk.length)
      {
        const newline = chunk.indexOf(10, start)
        const end = newline < 0 ? chunk.length : newline
        if (pending.length + end - start > 16 * 1024)
          throw new Error('development command exceeds 16 KiB')
        pending = Buffer.concat([pending, chunk.subarray(start, end)])
        if (newline < 0) break
        enqueue()
        start = newline + 1
      }
    }
    catch (error)
    {
      failure = error
      ended = true
      process.stdin.pause()
      onFailure()
    }
    notify()
  }
  const end = () =>
  {
    try
    {
      enqueue()
    }
    catch (error)
    {
      failure = error
    }
    ended = true
    onEnd()
    notify()
  }
  const error = (value: Error) =>
  {
    failure = value
    ended = true
    onFailure()
    notify()
  }
  const close = () =>
  {
    ended = true
    notify()
  }
  process.stdin.on('data', data)
  process.stdin.once('end', end)
  process.stdin.once('error', error)
  process.stdin.once('close', close)
  const dispose = () =>
  {
    process.stdin.pause()
    process.stdin.removeListener('data', data)
    process.stdin.removeListener('end', end)
    process.stdin.removeListener('error', error)
    process.stdin.removeListener('close', close)
  }
  return {
    dispose,
    lines: (async function* ()
    {
      try
      {
        while (!ended || lines.length)
        {
          if (failure) throw failure
          const line = lines.shift()
          if (line !== undefined)
          {
            queuedBytes -= Buffer.byteLength(line)
            yield line
          }
          else
            await new Promise<void>((done) =>
            {
              wake = done
            })
        }
        if (failure) throw failure
      }
      finally
      {
        dispose()
      }
    })(),
  }
}

function args()
{
  const parsed: Record<string, string> = {}
  const allowed = new Set([
    'host-config',
    'host-sha256',
    'input',
    'session',
    'preset',
    'profile',
    'visible',
    'collection',
    'limit',
    'cursor',
    'mark',
    'compare-session',
    'overlays',
    'clip-artifact',
    'reproduction-artifact',
    'max-frames',
    'max-bytes',
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
      Object.hasOwn(parsed, key)
    )
      throw new Error('unknown, repeated or missing development CLI option')
    parsed[key] = value
  }
  return parsed
}

export async function runDevelopmentCliV1(
  options: { readonly engineFactory?: DevelopmentEngineFactoryV1 } = {}
)
{
  const controller = new AbortController()
  let host: DevelopmentToolHostV1 | undefined
  let stopping = false
  let cleanup:
    ReturnType<NonNullable<DevelopmentToolHostV1['closeAll']>> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  let eofDeadline: ReturnType<typeof setTimeout> | undefined
  let intake: ReturnType<typeof commandLines> | undefined
  let complete = true
  const startDeadline = () =>
  {
    deadline ??= setTimeout(() =>
    {
      process.stderr.write(
        `${JSON.stringify({ ok: false, message: 'development shutdown incomplete after 15 seconds' })}\n`
      )
      process.exit(1)
    }, 15000)
  }
  const closeOwner = () =>
  {
    if (host && !cleanup)
    {
      try
      {
        cleanup = host.closeAll?.() ?? Promise.resolve()
      }
      catch (error)
      {
        cleanup = Promise.reject(error)
      }
    }
    return cleanup
  }
  const stop = () =>
  {
    stopping = true
    startDeadline()
    controller.abort(new Error('development CLI was interrupted'))
    process.stdin.destroy()
    void closeOwner()?.catch(() => undefined)
  }
  const eof = () =>
  {
    startDeadline()
    eofDeadline ??= setTimeout(stop, 2000)
  }
  const wait = <T>(operation: Promise<T>): Promise<T> =>
  {
    if (controller.signal.aborted)
    {
      void operation.catch(() => undefined)
      return Promise.reject(controller.signal.reason)
    }
    return new Promise<T>((done, reject) =>
    {
      const abort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', abort, { once: true })
      void operation
        .then(done, reject)
        .finally(() => controller.signal.removeEventListener('abort', abort))
    })
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  process.on('SIGHUP', stop)
  try
  {
    const command = process.argv[2]
    if (
      !['playtest', 'debug', 'inspect', 'reproduce', 'view'].includes(
        command ?? ''
      )
    )
      throw new Error('use playtest, debug, inspect, reproduce or view')
    const input = args()
    if (command === 'playtest' || command === 'debug')
      intake = commandLines(eof, stop)
    const path =
      input['host-config'] ?? process.env.SCRATCH_AGENT_WORKBENCH_CONFIG
    if (!path)
      throw new Error(
        'provide an operator-owned --host-config with source and evidence roots'
      )
    const configured = await wait(
      readDevelopmentHostConfigurationV1(path, input['host-sha256'])
    )
    const service = await wait(
      createDevelopmentServiceV1({
        permissions:
          configured.permissions as unknown as DevelopmentOperatorPermissionsV1,
        ...(options.engineFactory
          ? { engineFactory: options.engineFactory }
          : {}),
      })
    )
    host = createDevelopmentToolHostV1(service)
    const call: DevelopmentToolHostV1['call'] = (name, request) =>
      wait(host!.call(name, request, { signal: controller.signal }))
    let sessionId = input.session
    const print = (value: unknown) =>
      process.stdout.write(`${JSON.stringify(value)}\n`)
    try
    {
      if (command === 'playtest' || command === 'debug')
      {
        if (!input.input)
          throw new Error('--input requires the exact exported .sb3 path')
        if (
          input.visible !== undefined &&
          !['true', 'false'].includes(input.visible)
        )
          throw new Error('--visible must be true or false')
        const visible =
          input.visible === undefined
            ? command === 'playtest'
            : input.visible === 'true'
        const opened = await call('development_begin', {
          sourcePath: resolve(input.input),
          visible,
          inputMode: command === 'playtest' ? 'human' : 'agent',
          ...(input.preset === undefined
            ? command === 'playtest' && input.profile === undefined
              ? { preset: 'official30' }
              : {}
            : { preset: input.preset }),
          ...(input.profile === undefined
            ? {}
            : {
                profile: JSON.parse(input.profile) as RuntimeExecutionProfileV1,
              }),
        })
        if (typeof opened.sessionId !== 'string')
          throw new Error('development begin returned no session identity')
        sessionId = opened.sessionId
        print(opened)
        print(
          await call('development_command', {
            sessionId,
            command: { kind: 'start' },
          })
        )
        let checking = false
        const monitor = setInterval(() =>
        {
          if (checking || stopping) return
          checking = true
          void service
            .inspect({ sessionId: sessionId! })
            .then((page) =>
            {
              if (
                ['closed', 'cancelled', 'exhausted', 'failed'].includes(
                  page.items[0]!.status
                )
              )
                stop()
            })
            .catch(stop)
            .finally(() =>
            {
              checking = false
            })
        }, 500)
        try
        {
          for await (const line of intake!.lines)
          {
            try
            {
              const value = JSON.parse(line) as Record<string, unknown>
              const { tool, ...request } = value
              if (tool === 'inspect')
                print(
                  await call('development_inspect', {
                    ...request,
                    sessionId,
                  })
                )
              else if (tool === 'reproduce')
                print(
                  await call('development_reproduce', {
                    ...request,
                    sessionId,
                  })
                )
              else if (tool === 'close') break
              else
                print(
                  await call('development_command', {
                    sessionId,
                    command: value,
                  })
                )
            }
            catch (error)
            {
              if (controller.signal.aborted) throw error
              print({
                ok: false,
                message: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
        catch (error)
        {
          if (!stopping) throw error
        }
        finally
        {
          clearInterval(monitor)
        }
      }
      else
      {
        if (!sessionId)
          throw new Error(
            '--session requires a retained development session identity'
          )
        if (command === 'inspect')
          print(
            await call('development_inspect', {
              sessionId,
              ...(input.collection === undefined
                ? {}
                : { collection: input.collection }),
              ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
              ...(input.limit === undefined
                ? {}
                : { limit: Number(input.limit) }),
            })
          )
        else if (command === 'reproduce')
          print(
            await call('development_reproduce', {
              sessionId,
              markId: input.mark,
              ...(input['max-frames'] === undefined &&
              input['max-bytes'] === undefined
                ? {}
                : {
                    denseCapture: {
                      ...(input['max-frames'] === undefined
                        ? {}
                        : { maxFrames: Number(input['max-frames']) }),
                      ...(input['max-bytes'] === undefined
                        ? {}
                        : { maxBytes: Number(input['max-bytes']) }),
                    },
                  }),
            })
          )
        else
          print(
            await call('development_command', {
              sessionId,
              command: {
                kind: 'view',
                ...(input['compare-session'] === undefined
                  ? {}
                  : { compareSessionId: input['compare-session'] }),
                ...(input.overlays === undefined
                  ? {}
                  : { overlays: JSON.parse(input.overlays) }),
                ...(input['clip-artifact'] === undefined
                  ? {}
                  : { clipArtifactKey: input['clip-artifact'] }),
                ...(input['reproduction-artifact'] === undefined
                  ? {}
                  : {
                      reproductionArtifactKey: input['reproduction-artifact'],
                    }),
              },
            })
          )
      }
    }
    finally
    {
      startDeadline()
      try
      {
        if (
          !stopping &&
          sessionId &&
          (command === 'playtest' || command === 'debug')
        )
          print(await wait(service.close({ sessionId })))
      }
      finally
      {
        startDeadline()
        if (eofDeadline) clearTimeout(eofDeadline)
        const result = await closeOwner()
        complete = result?.complete ?? false
        if (!complete)
        {
          process.stderr.write(
            `${JSON.stringify({ ok: false, message: 'development cleanup incomplete', cleanup: result ?? null })}\n`
          )
          process.exitCode = 1
        }
      }
    }
  }
  finally
  {
    process.removeListener('SIGINT', stop)
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGHUP', stop)
    if (eofDeadline) clearTimeout(eofDeadline)
    intake?.dispose()
    if (deadline && complete) clearTimeout(deadline)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void runDevelopmentCliV1().catch((error: unknown) =>
  {
    process.stderr.write(
      `${JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) })}\n`
    )
    process.exitCode = 1
  })
