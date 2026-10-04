// packages/mcp/src/development/service-host.ts
// adapt shared live development services & reproducers to CLI/MCP requests

import { clearTimeout, setTimeout } from 'node:timers'

import type {
  DevelopmentServiceV1,
  DevelopmentBeginRequestV1,
  DevelopmentCommandV1,
  DevelopmentCollectionV1,
  DevelopmentViewRequestV1,
} from '@scratch-agent/runner'
import { isRunnerIssueError } from '@scratch-agent/runner'
import {
  reproduceDevelopmentMarkV1,
  type ReproduceDevelopmentMarkRequestV1,
} from '@scratch-agent/eval'
import {
  DEVELOPMENT_TOOLS_V1,
  type DevelopmentToolHostV1,
  type DevelopmentHostCleanupResultV1,
} from './tools.js'
import { validateClosedJsonSchemaValueV1 } from '../transport/json-schema-check.js'
import {
  developmentArtifactUriV1,
  developmentResourceReferencesV1,
  developmentResourceSelectionV1,
} from './resources.js'

function sessionId(input: Readonly<Record<string, unknown>>): string
{
  if (
    typeof input.sessionId !== 'string' ||
    !input.sessionId ||
    input.sessionId.length > 256
  )
    throw new Error('sessionId requires bounded nonempty text')
  return input.sessionId
}

export function createDevelopmentToolHostV1(
  service: DevelopmentServiceV1,
  reproduce?: (
    input: Readonly<Record<string, unknown>>,
    context?: { readonly signal?: AbortSignal }
  ) => Promise<Readonly<Record<string, unknown>>>
): DevelopmentToolHostV1
{
  const live = new Set<string>()
  const controllers = new Map<string, AbortController>()
  const ownedControllers = new Set<AbortController>()
  const pendingCalls = new Set<Promise<unknown>>()
  const pendingCloses = new Map<string, Promise<void>>()
  const cleanupIssues: string[] = []
  let closing = false
  let cleanup: Promise<DevelopmentHostCleanupResultV1> | undefined

  function assertActive(signal?: AbortSignal): void
  {
    if (closing || signal?.aborted)
      throw signal?.reason ?? new Error('development host is closing')
  }

  function track<T>(operation: () => Promise<T>): Promise<T>
  {
    if (closing) return Promise.reject(new Error('development host is closing'))
    const result = Promise.resolve().then(() =>
    {
      if (closing) throw new Error('development host is closing')
      return operation()
    })
    pendingCalls.add(result)
    void result.then(
      () => pendingCalls.delete(result),
      (error: unknown) =>
      {
        pendingCalls.delete(result)
        if (
          isRunnerIssueError(error) &&
          error.issue.code === 'runner.cleanup.incomplete' &&
          cleanupIssues.length < 32
        )
          cleanupIssues.push(
            `${error.issue.code}: ${error.message.slice(0, 1024)}`
          )
      }
    )
    return result
  }

  function closeOwned(id: string): Promise<void>
  {
    const pending = pendingCloses.get(id)
    if (pending) return pending
    const result = (async () =>
    {
      try
      {
        const status = await service.close({ sessionId: id })
        if (!status.trace)
          throw new Error(`session ${id} closed without terminal evidence`)
        const incomplete = status.issues.find(
          (issue) =>
            issue.startsWith(
              'runtime cleanup failed: runner.cleanup.incomplete:'
            ) || issue.startsWith('private evidence writer cleanup incomplete:')
        )
        if (incomplete) throw new Error(incomplete)
        live.delete(id)
        const controller = controllers.get(id)
        if (controller) ownedControllers.delete(controller)
        controllers.delete(id)
      }
      catch (error)
      {
        if (cleanupIssues.length < 32)
          cleanupIssues.push(
            `session ${id} cleanup failed: ${String(error).slice(0, 1024)}`
          )
        throw error
      }
      finally
      {
        pendingCloses.delete(id)
      }
    })()
    pendingCloses.set(id, result)
    return result
  }

  return {
    call(name, input, context)
    {
      return track(async () =>
      {
        const schema = DEVELOPMENT_TOOLS_V1.find((tool) => tool.name === name)
        if (!schema) throw new Error('unknown development tool')
        const issues = validateClosedJsonSchemaValueV1(
          schema.inputSchema,
          input
        )
        if (issues.length)
          throw new Error(`invalid development request: ${issues[0]}`)
        const auxiliaryCommand =
          name === 'development_command' &&
          ['view', 'importClip', 'recordAudio'].includes(
            String((input.command as { kind?: unknown } | undefined)?.kind)
          )
        const controller =
          name === 'development_begin' ||
          name === 'development_reproduce' ||
          auxiliaryCommand
            ? new AbortController()
            : name === 'development_command'
              ? controllers.get(sessionId(input))
              : undefined
        const cancel = () => controller?.abort(context?.signal?.reason)
        if (controller) ownedControllers.add(controller)
        if (context?.signal?.aborted) cancel()
        context?.signal?.addEventListener('abort', cancel, { once: true })
        try
        {
          let result: Readonly<Record<string, unknown>>
          if (name === 'development_begin')
          {
            result = {
              ...(await service.begin({
                ...input,
                signal: controller!.signal,
              } as unknown as DevelopmentBeginRequestV1)),
            }
            if (typeof result.sessionId === 'string')
            {
              live.add(result.sessionId)
              controllers.set(result.sessionId, controller!)
              if (closing || controller!.signal.aborted)
              {
                await closeOwned(result.sessionId)
                throw (
                  controller!.signal.reason ??
                  new Error('development opening cancelled')
                )
              }
            }
          }
          else
          {
            const id = sessionId(input)
            switch (name)
            {
              case 'development_command':
              {
                const command = input.command as Readonly<
                  Record<string, unknown>
                >
                if (command.kind === 'view')
                  result = {
                    ...(await service.view({
                      sessionId: id,
                      ...(command.compareSessionId === undefined
                        ? {}
                        : { compareSessionId: command.compareSessionId }),
                      ...(command.overlays === undefined
                        ? {}
                        : { overlays: command.overlays }),
                      ...(command.clipArtifactKey === undefined
                        ? {}
                        : { clipArtifactKey: command.clipArtifactKey }),
                      ...(command.reproductionArtifactKey === undefined
                        ? {}
                        : {
                            reproductionArtifactKey:
                              command.reproductionArtifactKey,
                          }),
                      signal: controller?.signal,
                    } as unknown as DevelopmentViewRequestV1)),
                  }
                else if (command.kind === 'importClip')
                  result = {
                    ...(await service.importClip({
                      sessionId: id,
                      sourcePath: command.sourcePath as string,
                      ...(command.expectedSha256 === undefined
                        ? {}
                        : { expectedSha256: command.expectedSha256 as string }),
                      signal: controller?.signal,
                    })),
                  }
                else if (command.kind === 'recordAudio')
                  result = {
                    ...(await service.recordAudio({
                      sessionId: id,
                      ...(command.durationMs === undefined
                        ? {}
                        : { durationMs: command.durationMs as number }),
                      ...(command.maxBytes === undefined
                        ? {}
                        : { maxBytes: command.maxBytes as number }),
                      signal: controller?.signal,
                    })),
                  }
                else
                  result = {
                    ...(await service.command({
                      sessionId: id,
                      command: input.command as DevelopmentCommandV1,
                    })),
                  }
                break
              }
              case 'development_inspect':
                result = {
                  ...(await service.inspect({
                    sessionId: id,
                    ...(input.collection === undefined
                      ? {}
                      : {
                          collection:
                            input.collection as DevelopmentCollectionV1,
                        }),
                    ...(input.cursor === undefined
                      ? {}
                      : { cursor: input.cursor as string }),
                    ...(input.limit === undefined
                      ? {}
                      : { limit: input.limit as number }),
                  })),
                }
                break
              case 'development_reproduce':
                result = reproduce
                  ? await reproduce(input, { signal: controller?.signal })
                  : {
                      ...(await reproduceDevelopmentMarkV1({
                        service,
                        sessionId: id,
                        markId: input.markId as string,
                        ...(input.profile === undefined
                          ? {}
                          : { profile: input.profile }),
                        ...(input.denseCapture === undefined
                          ? {}
                          : { denseCapture: input.denseCapture }),
                        signal: controller?.signal,
                      } as ReproduceDevelopmentMarkRequestV1)),
                    }
                break
              case 'development_close':
              {
                const status = await service.close({ sessionId: id })
                const incomplete = status.issues.find(
                  (issue) =>
                    issue.startsWith(
                      'runtime cleanup failed: runner.cleanup.incomplete:'
                    ) ||
                    issue.startsWith(
                      'private evidence writer cleanup incomplete:'
                    )
                )
                if (incomplete)
                {
                  if (cleanupIssues.length < 32) cleanupIssues.push(incomplete)
                  if (
                    !status.trace ||
                    !incomplete.startsWith(
                      'private evidence writer cleanup incomplete:'
                    )
                  )
                    throw new Error(incomplete)
                }
                result = { ...status }
                if (result.trace && !incomplete)
                {
                  live.delete(id)
                  const sessionController = controllers.get(id)
                  if (sessionController)
                    ownedControllers.delete(sessionController)
                  controllers.delete(id)
                }
                break
              }
            }
          }
          assertActive(controller?.signal ?? context?.signal)
          if (Buffer.byteLength(JSON.stringify(result)) > 40 * 1024)
          {
            const artifacts = await service.inspect({
              sessionId: sessionId(input),
              collection: 'artifacts',
              limit: 16,
            })
            assertActive(controller?.signal ?? context?.signal)
            return developmentResourceReferencesV1({
              sessionId: sessionId(input),
              collection: input.collection ?? null,
              total: result.total ?? null,
              nextCursor: result.nextCursor ?? null,
              artifactOnly: true,
              message:
                'This selection exceeds the inline limit; read retained trace artifacts in chunks.',
              artifacts: artifacts.items,
            }) as Readonly<Record<string, unknown>>
          }
          return developmentResourceReferencesV1(result) as Readonly<
            Record<string, unknown>
          >
        }
        finally
        {
          context?.signal?.removeEventListener('abort', cancel)
          if (controller && ![...controllers.values()].includes(controller))
            ownedControllers.delete(controller)
        }
      })
    },
    readResource(uri)
    {
      return track(async () =>
      {
        const selection = developmentResourceSelectionV1(uri)
        if (selection.read !== undefined)
          throw new Error('snapshot resources require the server-owned pager')
        const chunk = await service.readArtifact({
          sessionId: selection.sessionId,
          key: selection.key,
          offset: selection.offset,
          maxBytes: 16 * 1024,
        })
        assertActive()
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            artifact: developmentResourceReferencesV1({
              sessionId: chunk.sessionId,
              key: chunk.key,
              sha256: chunk.sha256,
              byteLength: chunk.byteLength,
              mimeType: chunk.mimeType,
            }),
            offset: chunk.offset,
            encoding: 'base64',
            bytes: Buffer.from(chunk.bytes).toString('base64'),
            nextUri:
              chunk.nextOffset === null
                ? null
                : developmentArtifactUriV1(
                    selection.sessionId,
                    selection.key,
                    chunk.nextOffset
                  ),
          }),
        }
      })
    },
    selectResourceSnapshot(uri, context)
    {
      return track(async () =>
      {
        assertActive(context?.signal)
        const selection = developmentResourceSelectionV1(uri)
        if (selection.read !== 'snapshot-v1')
          throw new Error('verified snapshot mode must be explicit')
        const selected = await service.selectArtifactSnapshot({
          sessionId: selection.sessionId,
          key: selection.key,
        })
        assertActive(context?.signal)
        return {
          artifact: selected.artifact,
          load: () =>
            track(async () =>
            {
              assertActive(context?.signal)
              const bytes = await selected.load()
              assertActive(context?.signal)
              return bytes
            }),
        }
      })
    },
    closeAll()
    {
      if (cleanup) return cleanup
      closing = true
      for (const controller of ownedControllers)
        controller.abort(new Error('development transport closed'))
      const closes = [...live].map(closeOwned)
      cleanup = (async () =>
      {
        let timeout: ReturnType<typeof setTimeout> | undefined
        let expired = false
        try
        {
          await Promise.race([
            Promise.allSettled([...pendingCalls, ...closes]),
            new Promise<void>((resolve) =>
            {
              timeout = setTimeout(() =>
              {
                expired = true
                resolve()
              }, 13000)
            }),
          ])
        }
        finally
        {
          if (timeout) clearTimeout(timeout)
        }
        const issues = [...cleanupIssues]
        if (expired) issues.push('development cleanup exceeded 13000 ms')
        return {
          complete:
            !expired && !pendingCalls.size && !live.size && !issues.length,
          pendingCalls: pendingCalls.size,
          liveSessionIds: [...live],
          issues,
        }
      })()
      return cleanup
    },
  }
}
