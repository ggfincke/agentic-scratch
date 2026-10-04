// packages/mcp/src/authoring/service-host.ts
// adapt the same retained authoring service for CLI & MCP requests

import { clearTimeout, setTimeout } from 'node:timers'

import {
  AuthoringWorkspaceErrorV1,
  type AuthoringWorkspaceCollectionV1,
  type AuthoringWorkspaceServiceV1,
} from '@scratch-agent/edit'
import type {
  AuthoringHostCleanupResultV1,
  AuthoringToolHostV1,
} from './tools.js'
import {
  authoringArtifactUriV1,
  authoringResourceReferencesV1,
  authoringResourceSelectionV1,
} from './resources.js'

function requiredText(
  input: Readonly<Record<string, unknown>>,
  field: string
): string
{
  const value = input[field]
  if (typeof value !== 'string' || !value || value.length > 4096)
    throw new Error(`${field} requires bounded nonempty text`)
  return value
}

export function createAuthoringToolHostV1(
  service: AuthoringWorkspaceServiceV1
): AuthoringToolHostV1
{
  const controllers = new Set<AbortController>()
  const pendingCalls = new Set<Promise<unknown>>()
  const cleanupIssues: string[] = []
  let closing = false
  let cleanup: Promise<AuthoringHostCleanupResultV1> | undefined

  function assertActive(signal: AbortSignal): void
  {
    if (closing || signal.aborted)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.request_cancelled',
        'authoring host request was cancelled'
      )
  }

  function track<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    context?: { readonly signal?: AbortSignal }
  ): Promise<T>
  {
    const controller = new AbortController()
    const cancel = () => controller.abort(context?.signal?.reason)
    controllers.add(controller)
    if (closing || context?.signal?.aborted) cancel()
    context?.signal?.addEventListener('abort', cancel, { once: true })
    const result = Promise.resolve().then(async () =>
    {
      assertActive(controller.signal)
      try
      {
        // the service owns cancellation through its durable commit boundary
        return await operation(controller.signal)
      }
      catch (error)
      {
        if (
          error instanceof AuthoringWorkspaceErrorV1 &&
          error.code === 'authoring.cleanup_incomplete' &&
          cleanupIssues.length < 32
        )
          cleanupIssues.push(error.message.slice(0, 1024))
        throw error
      }
    })
    pendingCalls.add(result)
    const settled = () =>
    {
      pendingCalls.delete(result)
      controllers.delete(controller)
      context?.signal?.removeEventListener('abort', cancel)
    }
    void result.then(settled, settled)
    return result
  }

  const host: AuthoringToolHostV1 = {
    async call(name, input, context)
    {
      if (name === 'authoring_open')
        return {
          ...(await service.open({
            manifestPath: requiredText(input, 'manifestPath'),
            signal: context?.signal,
          })),
        }
      const workspaceId = requiredText(input, 'workspaceId')
      switch (name)
      {
        case 'authoring_plan':
        {
          const planned = await service.plan({
            workspaceId,
            signal: context?.signal,
          })
          return {
            workspaceId,
            planId: planned.planId,
            candidateSha256: planned.candidateSha256,
            sourceClosureSha256: planned.sourceClosureSha256,
            contractSha256: planned.contractSha256,
            preparedAssetCount: planned.preparedAssetCount,
            costs: planned.plan.costs,
            artifact: planned.artifact,
            diff: planned.diff,
          }
        }
        case 'authoring_build':
          return {
            ...(await service.build({
              workspaceId,
              planId: requiredText(input, 'planId'),
              signal: context?.signal,
            })),
          }
        case 'authoring_evaluate':
          return {
            ...(await service.evaluate({
              workspaceId,
              buildId: requiredText(input, 'buildId'),
              signal: context?.signal,
            })),
          }
        case 'authoring_export':
          return {
            ...(await service.export({
              workspaceId,
              buildId: requiredText(input, 'buildId'),
              destinationPath: requiredText(input, 'destinationPath'),
              signal: context?.signal,
            })),
          }
        case 'authoring_recover_export':
          return {
            ...(await service.recoverExport({
              workspaceId,
              exportId: requiredText(input, 'exportId'),
              signal: context?.signal,
            })),
          }
        case 'authoring_inspect':
          return {
            ...(await service.inspect({
              workspaceId,
              ...(input.collection === undefined
                ? {}
                : {
                    collection:
                      input.collection as AuthoringWorkspaceCollectionV1,
                  }),
              ...(input.cursor === undefined
                ? {}
                : { cursor: input.cursor as string }),
              ...(input.limit === undefined
                ? {}
                : { limit: input.limit as number }),
              ...(input.planId === undefined
                ? {}
                : { planId: input.planId as string }),
            })),
          }
        case 'authoring_close':
          return {
            ...(await service.close({ workspaceId, signal: context?.signal })),
          }
      }
    },
  }
  return {
    call(name, input, context)
    {
      return track(async (signal) =>
      {
        const result = await host.call(name, input, { signal })
        if (Buffer.byteLength(JSON.stringify(result)) > 40 * 1024)
        {
          const workspaceId = requiredText(input, 'workspaceId')
          const artifacts = await service.inspect({
            workspaceId,
            collection: 'plans',
            limit: 16,
          })
          return authoringResourceReferencesV1({
            workspaceId,
            collection: input.collection ?? null,
            total: result.total ?? null,
            nextCursor: result.nextCursor ?? null,
            artifactOnly: true,
            message:
              'This selection exceeds the inline limit; read its retained plan artifact in chunks.',
            artifacts: artifacts.items,
          }) as Readonly<Record<string, unknown>>
        }
        return authoringResourceReferencesV1(result) as Readonly<
          Record<string, unknown>
        >
      }, context)
    },
    readResource(uri, context)
    {
      return track(async (signal) =>
      {
        const selection = authoringResourceSelectionV1(uri)
        if (selection.read !== undefined)
          throw new Error('snapshot resources require the server-owned pager')
        const chunk = await service.readArtifact({
          workspaceId: selection.workspaceId,
          key: selection.key,
          offset: selection.offset,
          maxBytes: 16 * 1024,
        })
        assertActive(signal)
        return {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            artifact: authoringResourceReferencesV1(chunk.artifact),
            offset: chunk.offset,
            encoding: 'base64',
            bytes: Buffer.from(chunk.bytes).toString('base64'),
            nextUri:
              chunk.nextOffset === null
                ? null
                : authoringArtifactUriV1(
                    selection.workspaceId,
                    selection.key,
                    chunk.nextOffset
                  ),
          }),
        }
      }, context)
    },
    selectResourceSnapshot(uri, context)
    {
      return track(async (signal) =>
      {
        const selection = authoringResourceSelectionV1(uri)
        if (selection.read !== 'snapshot-v1')
          throw new Error('verified snapshot mode must be explicit')
        const selected = await service.selectArtifactSnapshot({
          workspaceId: selection.workspaceId,
          key: selection.key,
        })
        assertActive(signal)
        return {
          artifact: selected.artifact,
          load: () =>
            track(async (loadSignal) =>
            {
              const bytes = await selected.load()
              assertActive(loadSignal)
              return bytes
            }, context),
        }
      }, context)
    },
    closeAll()
    {
      if (cleanup) return cleanup
      closing = true
      for (const controller of controllers)
        controller.abort(new Error('authoring transport closed'))
      cleanup = (async () =>
      {
        let timeout: ReturnType<typeof setTimeout> | undefined
        let expired = false
        try
        {
          await Promise.race([
            Promise.allSettled([...pendingCalls]),
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
        if (expired) issues.push('authoring cleanup exceeded 13000 ms')
        return {
          complete: !expired && !pendingCalls.size && !issues.length,
          pendingCalls: pendingCalls.size,
          issues,
        }
      })()
      return cleanup
    },
  }
}
