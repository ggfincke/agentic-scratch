// packages/edit/src/authoring/workspace-worker-owner.ts
// own one bounded pure worker until exit confirms cancellation or completion

import { Worker } from 'node:worker_threads'
import { AuthoringWorkspaceErrorV1 } from './workspace-types.js'
import {
  workspaceWorkerBytesV1,
  type WorkspaceWorkerBudgetV1,
  type WorkspaceWorkerDataV1,
  type WorkspaceWorkerRequestV1,
  type WorkspaceWorkerResponseV1,
  type WorkspaceWorkerResultV1,
} from './workspace-worker-types.js'

export function assertAuthoringActiveV1(signal?: AbortSignal): void
{
  if (signal?.aborted)
    throw new AuthoringWorkspaceErrorV1(
      'authoring.request_cancelled',
      'authoring request was cancelled'
    )
}

export class WorkspaceWorkerOwnerV1
{
  #worker: Worker | null = null
  #exit: Promise<void> = Promise.resolve()

  get pending(): boolean
  {
    return this.#worker !== null
  }

  waitForExit(): Promise<void>
  {
    return this.#exit
  }

  async run<Request extends WorkspaceWorkerRequestV1>(
    request: Request,
    budget: WorkspaceWorkerBudgetV1,
    signal?: AbortSignal
  ): Promise<WorkspaceWorkerResultV1<Request['kind']>>
  {
    assertAuthoringActiveV1(signal)
    if (this.#worker !== null)
      throw new AuthoringWorkspaceErrorV1(
        'authoring.workspace_busy',
        'the service still owns a pure authoring worker'
      )
    const size = workspaceWorkerBytesV1(request, budget.metadataBytes)
    // charge parent, transferred & internal snapshots, reply copies, metadata & decoding
    const residentBytes =
      budget.parentBytes +
      2 * size.payloadBytes +
      2 * budget.outputBytes +
      budget.decodedBytes +
      2 * (size.metadataBytes + budget.metadataBytes)
    if (
      !Number.isSafeInteger(residentBytes) ||
      residentBytes > budget.maximumBytes ||
      size.metadataBytes > budget.metadataBytes
    )
      throw new AuthoringWorkspaceErrorV1(
        'authoring.worker_budget_exceeded',
        'parent snapshots, worker copies, replies & decoding exceed the workspace byte budget'
      )
    const copies = new Map(
      size.buffers.map((bytes) => [bytes, Uint8Array.from(bytes)])
    )
    const replace = (entry: unknown): unknown =>
    {
      if (entry instanceof Uint8Array) return copies.get(entry)!
      if (Array.isArray(entry)) return entry.map(replace)
      if (entry !== null && typeof entry === 'object')
        return Object.fromEntries(
          Object.entries(entry).map(([key, child]) => [key, replace(child)])
        )
      return entry
    }
    assertAuthoringActiveV1(signal)
    const data: WorkspaceWorkerDataV1 = {
      request: replace(request) as Request,
      maximumOutputBytes: budget.outputBytes,
      maximumMetadataBytes: budget.metadataBytes,
    }
    const worker = new Worker(
      new URL(
        './authoring/workspace-worker-entry.js',
        import.meta.resolve('@scratch-agent/edit')
      ),
      {
        workerData: data,
        transferList: [...copies.values()].map((bytes) => bytes.buffer),
      }
    )
    this.#worker = worker
    let confirmExit!: () => void
    this.#exit = new Promise<void>((resolve) =>
    {
      confirmExit = resolve
    })
    return new Promise((resolve, reject) =>
    {
      let response: WorkspaceWorkerResponseV1 | undefined
      let failure: Error | undefined
      let stopping = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const stop = () =>
      {
        if (stopping) return
        stopping = true
        timer = setTimeout(() =>
        {
          reject(
            new AuthoringWorkspaceErrorV1(
              'authoring.cleanup_incomplete',
              'pure authoring worker exit remains unconfirmed after five seconds'
            )
          )
        }, 5000)
        void worker.terminate().catch((error: unknown) =>
        {
          failure = error instanceof Error ? error : new Error(String(error))
        })
      }
      worker.once('message', (message: WorkspaceWorkerResponseV1) =>
      {
        response = message
        stop()
      })
      worker.once('error', (error) =>
      {
        failure = error
        stop()
      })
      worker.once('exit', (code) =>
      {
        if (timer !== undefined) clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
        if (this.#worker === worker) this.#worker = null
        confirmExit()
        if (signal?.aborted)
          reject(
            new AuthoringWorkspaceErrorV1(
              'authoring.request_cancelled',
              'authoring request was cancelled after its worker exited'
            )
          )
        else if (failure || response === undefined)
          reject(
            new AuthoringWorkspaceErrorV1(
              'authoring.worker_failed',
              failure?.message ??
                `pure authoring worker exited ${code} without a reply`
            )
          )
        else if (!response.ok)
          reject(new AuthoringWorkspaceErrorV1(response.code, response.message))
        else resolve(response.value as WorkspaceWorkerResultV1<Request['kind']>)
      })
      signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) stop()
    })
  }
}
