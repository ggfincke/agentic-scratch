// tests/runner/drive-observe-lifecycle.test.ts
// injected cancellation, input-truth, cleanup, & browser-close lifecycle regressions

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import test from 'node:test'

import type { DriveObserveCommandOutcomeV1 } from '@scratch-agent/runner'

const MOCK_HOST_KEY = 'agentic-scratch.drive-observe-lifecycle-host'
const MOCK_LAUNCH_KEY = 'agentic-scratch.drive-observe-lifecycle-launch'
const MOCK_CLOSE_TIMEOUT_MS = 25

interface MockControl
{
  readonly pageKeys: Set<string>
  readonly pageMouse: { leftDown: boolean; x: number; y: number }
  closeCalls: number
  drawEpoch: number
  hang: 'none' | 'opening' | 'advance' | 'release-key' | 'release-mouse'
  driftAfterInput: boolean
  inspectCalls: number
  releaseCalls: number
  readonly started: {
    readonly opening: Promise<void>
    readonly advance: Promise<void>
    readonly release: Promise<void>
  }
  readonly markStarted: {
    opening(): void
    advance(): void
    release(): void
  }
  readonly pendingResolves: Set<() => void>
}

interface MockHostRegistry
{
  open(): Promise<unknown>
}

interface MockLaunchRegistry
{
  launch(): Promise<unknown>
}

interface BrowserHostInternals
{
  readonly RENDERED_PAGE_CLOSE_TIMEOUT_MS: number
  awaitRenderedPageOpening<T>(
    factory: () => Promise<T>,
    signal: AbortSignal | undefined,
    late?: {
      readonly label: string
      readonly cleanup: (value: T) => void | Promise<void>
      readonly onCleanupError?: (error: unknown) => void
      readonly timeoutMs?: number
    }
  ): Promise<T>
  closeRenderedPageResources(
    context: { close(): Promise<void> } | undefined,
    browser: { close(): Promise<void> } | undefined,
    onCleanupError: ((error: unknown) => void) | undefined
  ): Promise<void>
}

type InteractiveModule = Pick<
  typeof import('@scratch-agent/runner'),
  'withInteractiveBrowserSession'
>

function deferred<T = void>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}
{
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((settle, fail) =>
  {
    resolve = settle
    reject = fail
  })
  return { promise, resolve, reject }
}

function control(): MockControl
{
  const opening = deferred()
  const advance = deferred()
  const release = deferred()
  return {
    pageKeys: new Set(),
    pageMouse: { leftDown: false, x: 0, y: 0 },
    closeCalls: 0,
    drawEpoch: 0,
    hang: 'none',
    driftAfterInput: false,
    inspectCalls: 0,
    releaseCalls: 0,
    started: {
      opening: opening.promise,
      advance: advance.promise,
      release: release.promise,
    },
    markStarted: {
      opening: () => opening.resolve(),
      advance: () => advance.resolve(),
      release: () => release.resolve(),
    },
    pendingResolves: new Set(),
  }
}

function pendingEvaluation(
  state: MockControl,
  started: () => void
): Promise<never>
{
  started()
  return new Promise<never>((resolve) =>
  {
    state.pendingResolves.add(() => resolve(undefined as never))
  })
}

async function settlePending(state: MockControl): Promise<void>
{
  for (const resolve of state.pendingResolves) resolve()
  state.pendingResolves.clear()
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function mockHost(state: MockControl): unknown
{
  const page = {
    on(): void
    {},
    async evaluate(
      operation: (...args: never[]) => unknown,
      value?: unknown
    ): Promise<unknown>
    {
      const source = String(operation)
      if (source.includes('.load('))
      {
        if (state.hang === 'opening')
          return await pendingEvaluation(state, state.markStarted.opening)
        return undefined
      }
      if (source.includes('.prep(')) return undefined
      if (source.includes('beginDriveObserve'))
        return { drawEpoch: state.drawEpoch }
      if (source.includes('inspectDriveObserve'))
      {
        state.inspectCalls++
        return { drawEpoch: state.drawEpoch }
      }
      if (source.includes('advanceDriveObserve'))
      {
        if (state.hang === 'advance')
          return await pendingEvaluation(state, state.markStarted.advance)
        const ticks =
          typeof value === 'number'
            ? value
            : typeof value === 'object' &&
                value !== null &&
                'ticks' in value &&
                typeof value.ticks === 'number'
              ? value.ticks
              : 1
        return { ticksAdvanced: ticks, drawEpoch: state.drawEpoch }
      }
      if (source.includes('pressKey'))
      {
        const input = value as { readonly key: string }
        state.pageKeys.add(input.key)
        if (state.driftAfterInput) state.drawEpoch++
        return undefined
      }
      if (source.includes('releaseKey'))
      {
        state.releaseCalls++
        state.markStarted.release()
        if (state.hang === 'release-key')
          return await pendingEvaluation(state, () => undefined)
        const key =
          typeof value === 'string'
            ? value
            : (value as { readonly key: string }).key
        state.pageKeys.delete(key)
        return undefined
      }
      if (source.includes('mouseDown'))
      {
        const input = value as { readonly x: number; readonly y: number }
        state.pageMouse.x = input.x
        state.pageMouse.y = input.y
        state.pageMouse.leftDown = true
        if (state.driftAfterInput) state.drawEpoch++
        return undefined
      }
      if (source.includes('mouseUp'))
      {
        state.releaseCalls++
        state.markStarted.release()
        if (state.hang === 'release-mouse')
          return await pendingEvaluation(state, () => undefined)
        const input = value as { readonly x: number; readonly y: number }
        state.pageMouse.x = input.x
        state.pageMouse.y = input.y
        state.pageMouse.leftDown = false
        return undefined
      }
      if (source.includes('moveMouse'))
      {
        const input = value as { readonly x: number; readonly y: number }
        state.pageMouse.x = input.x
        state.pageMouse.y = input.y
        return undefined
      }
      if (source.includes('greenFlag')) return undefined
      throw new Error(`unhandled mock page operation: ${source}`)
    },
  }
  const context = {
    on(): void
    {},
    async close(): Promise<void>
    {},
  }
  const browser = {
    on(): void
    {},
    async close(): Promise<void>
    {},
  }
  let closePromise: Promise<void> | undefined
  return {
    runtimeId: 'mock-runtime',
    runtimeDescriptor: { runtime: 'mock' },
    browser,
    context,
    page,
    projectPath: '/project.sb3',
    lineageManifestPath: null,
    close(): Promise<void>
    {
      closePromise ??= Promise.resolve().then(() =>
      {
        state.closeCalls++
      })
      return closePromise
    },
  }
}

function installMockHost(state: MockControl): void
{
  const globals = globalThis as typeof globalThis & {
    [key: symbol]: MockHostRegistry
  }
  globals[Symbol.for(MOCK_HOST_KEY)] = {
    async open(): Promise<unknown>
    {
      return mockHost(state)
    },
  }
}

function options(signal?: AbortSignal): {
  readonly sb3: Uint8Array
  readonly headless: true
  readonly pacing: 'instant'
  readonly seed: 0
  readonly fixedDateMs: 0
  readonly signal?: AbortSignal
}
{
  return {
    sb3: new Uint8Array(),
    headless: true,
    pacing: 'instant',
    seed: 0,
    fixedDateMs: 0,
    ...(signal ? { signal } : {}),
  }
}

function command(
  requestId: string,
  sequence: number,
  commandName: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown>
{
  return {
    requestId,
    sequence,
    expectedTick: 0,
    command: commandName,
    ...fields,
  }
}

async function within<T>(promise: Promise<T>, durationMs = 2_000): Promise<T>
{
  let timer: NodeJS.Timeout | undefined
  try
  {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) =>
      {
        timer = setTimeout(
          () => reject(new Error('lifecycle operation did not settle')),
          durationMs
        )
      }),
    ])
  }
  finally
  {
    if (timer) clearTimeout(timer)
  }
}

function commandRecord(outcome: DriveObserveCommandOutcomeV1)
{
  assert.equal(outcome.kind, 'command')
  return outcome.record
}

test('interactive failure lifecycle cancels and retains truthful input', async () =>
{
  const mockSource = [
    `export const RENDERED_PAGE_CLOSE_TIMEOUT_MS = ${MOCK_CLOSE_TIMEOUT_MS}`,
    'export async function openRenderedPageHost() {',
    `  return await globalThis[Symbol.for('${MOCK_HOST_KEY}')].open()`,
    '}',
  ].join('\n')
  const mockUrl = `data:text/javascript,${encodeURIComponent(mockSource)}`
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve)
    {
      if (
        specifier === './browser-host.js' &&
        context.parentURL?.endsWith('/interactive-session.ts')
      )
        return { url: mockUrl, shortCircuit: true }
      return nextResolve(specifier, context)
    },
  })
  const interactiveUrl = new URL(
    '../../packages/runner/src/browser/interactive-session.js',
    import.meta.url
  )
  const interactive = (await import(interactiveUrl.href)) as InteractiveModule

  const openingState = control()
  openingState.hang = 'opening'
  installMockHost(openingState)
  const openingAbort = new AbortController()
  const openingRun = interactive.withInteractiveBrowserSession(
    options(openingAbort.signal),
    async () => 'unexpected'
  )
  await openingState.started.opening
  openingAbort.abort(new Error('stop opening'))
  const opening = await within(openingRun)
  assert.equal(opening.callback.status, 'not-invoked')
  assert.equal(opening.report.terminalReason, 'opening-failed')
  assert.equal(opening.report.issues[0]?.code, 'runner.drive-observe.cancelled')
  assert.equal(openingState.closeCalls, 1)
  assert.equal(openingState.pendingResolves.size, 1)
  await settlePending(openingState)
  assert.equal(openingState.closeCalls, 1)

  const commandState = control()
  commandState.hang = 'advance'
  installMockHost(commandState)
  const commandAbort = new AbortController()
  const commandRun = interactive.withInteractiveBrowserSession(
    options(commandAbort.signal),
    async (session) =>
    {
      const execution = session.execute(
        command('advance', 0, 'advance', { ticks: 1 })
      )
      await commandState.started.advance
      commandAbort.abort(new Error('stop command'))
      return await execution
    }
  )
  const commandOutcome = await within(commandRun)
  assert.equal(commandOutcome.callback.status, 'completed')
  assert.equal(
    commandRecord(commandOutcome.callback.value).issue?.code,
    'runner.drive-observe.cancelled'
  )
  assert.equal(commandState.closeCalls, 1)
  assert.equal(commandState.pendingResolves.size, 1)
  const retainedCommandReport = structuredClone(commandOutcome.report)
  await settlePending(commandState)
  assert.deepEqual(commandOutcome.report, retainedCommandReport)
  assert.equal(commandState.closeCalls, 1)

  const callbackState = control()
  callbackState.hang = 'advance'
  installMockHost(callbackState)
  const callbackAbort = new AbortController()
  let rejectLateCallback!: (error: Error) => void
  const callbackRun = interactive.withInteractiveBrowserSession(
    options(callbackAbort.signal),
    async (session) =>
    {
      void session.execute(command('advance', 0, 'advance', { ticks: 1 }))
      await callbackState.started.advance
      callbackAbort.abort(new Error('stop callback'))
      return await new Promise<never>((_resolve, reject) =>
      {
        rejectLateCallback = reject
      })
    }
  )
  const callbackOutcome = await within(callbackRun)
  assert.equal(callbackOutcome.callback.status, 'failed')
  assert.equal(
    callbackOutcome.callback.issue.code,
    'runner.drive-observe.cancelled'
  )
  assert.equal(callbackState.closeCalls, 1)
  assert.equal(callbackState.pendingResolves.size, 1)
  rejectLateCallback(new Error('late callback rejection'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  await settlePending(callbackState)
  assert.equal(callbackState.closeCalls, 1)

  const freshState = control()
  installMockHost(freshState)
  const fresh = await within(
    interactive.withInteractiveBrowserSession(options(), async (session) =>
      session.execute(command('close', 0, 'close'))
    )
  )
  assert.equal(fresh.callback.status, 'completed')
  assert.equal(commandRecord(fresh.callback.value).status, 'closed')
  assert.equal(fresh.report.state, 'closed')

  for (const input of [
    {
      command: 'keyDown',
      fields: { key: 'right' },
      expectedHeld: { keys: ['ArrowRight'], leftDown: false },
      cleanupCommand: 'keyUp',
    },
    {
      command: 'mouseDown',
      fields: { x: 7, y: 9, button: 'left' },
      expectedHeld: { keys: [], leftDown: true },
      cleanupCommand: 'mouseUp',
    },
  ])
  {
    const state = control()
    state.driftAfterInput = true
    installMockHost(state)
    const outcome = await within(
      interactive.withInteractiveBrowserSession(options(), async (session) =>
        session.execute(command(input.command, 0, input.command, input.fields))
      )
    )
    assert.equal(outcome.callback.status, 'completed')
    const record = commandRecord(outcome.callback.value)
    assert.equal(record.status, 'failed')
    assert.equal(record.issue?.code, 'runner.drive-observe.draw-invariant')
    assert.deepEqual(record.heldInputAfter.keys, input.expectedHeld.keys)
    assert.equal(
      record.heldInputAfter.mouse.leftDown,
      input.expectedHeld.leftDown
    )
    assert.equal(record.changed, true)
    assert.equal(
      outcome.report.cleanupActions[0]?.command.command,
      input.cleanupCommand
    )
    assert.deepEqual(outcome.report.heldInput.keys, [])
    assert.equal(outcome.report.heldInput.mouse.leftDown, false)
    assert.equal(outcome.report.cleanupActions[0]?.issue, null)
  }

  const releaseState = control()
  releaseState.hang = 'release-key'
  installMockHost(releaseState)
  const release = await within(
    interactive.withInteractiveBrowserSession(options(), async (session) =>
    {
      const firstDown = await session.execute(
        command('held-a', 0, 'keyDown', { key: 'a' })
      )
      assert.equal(commandRecord(firstDown).status, 'accepted')
      const secondDown = await session.execute(
        command('held-b', 1, 'keyDown', { key: 'b' })
      )
      assert.equal(commandRecord(secondDown).status, 'accepted')
      const mouseDown = await session.execute(
        command('held-mouse', 2, 'mouseDown', {
          x: 7,
          y: 9,
          button: 'left',
        })
      )
      assert.equal(commandRecord(mouseDown).status, 'accepted')
      return 'held'
    })
  )
  assert.equal(release.callback.status, 'completed')
  assert.equal(release.report.state, 'failed')
  assert.equal(release.report.runtimePositionConfirmed, false)
  assert.equal(releaseState.closeCalls, 1)
  assert.equal(releaseState.releaseCalls, 1)
  assert.equal(releaseState.pendingResolves.size, 1)
  assert.deepEqual(
    release.report.cleanupActions.map((action) => action.command.command),
    ['keyUp', 'keyUp', 'mouseUp']
  )
  assert.ok(
    release.report.cleanupActions.every(
      (action) => action.issue?.code === 'runner.browser.cleanup-failed'
    )
  )
  assert.deepEqual(release.report.heldInput.keys, ['A', 'B'])
  assert.equal(release.report.heldInput.mouse.leftDown, true)
  const retainedReleaseReport = structuredClone(release.report)
  const inspectCallsBeforeLateRelease = releaseState.inspectCalls
  await settlePending(releaseState)
  assert.equal(releaseState.inspectCalls, inspectCallsBeforeLateRelease)
  assert.deepEqual(release.report, retainedReleaseReport)
  assert.equal(releaseState.closeCalls, 1)

  hooks.deregister()
})

test('browser opening avoids pre-abort work and owns late resources', async (t) =>
{
  const cleanupIncomplete = (error: unknown): boolean =>
  {
    assert.ok(error instanceof Error)
    assert.equal(error.name, 'RunnerIssueError')
    assert.equal(
      (error as Error & { issue?: { code: string } }).issue?.code,
      'runner.cleanup.incomplete'
    )
    return true
  }
  const playwrightSource = [
    'export const chromium = {',
    `  launch() { return globalThis[Symbol.for('${MOCK_LAUNCH_KEY}')].launch() }`,
    '}',
  ].join('\n')
  const fsSource = [
    "export * from 'node:fs'",
    "import { readFileSync as read } from 'node:fs'",
    'export function readFileSync(path, ...options) {',
    "  if (typeof path === 'string' && path.endsWith('/src/browser/debug-page.js'))",
    "    return Buffer.from('bounded opening fixture')",
    '  return read(path, ...options)',
    '}',
  ].join('\n')
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve)
    {
      if (context.parentURL?.endsWith('/browser-host.ts'))
      {
        const source =
          specifier === 'playwright'
            ? playwrightSource
            : specifier === 'node:fs'
              ? fsSource
              : null
        if (source !== null)
          return {
            url: `data:text/javascript,${encodeURIComponent(source)}`,
            shortCircuit: true,
          }
      }
      return nextResolve(specifier, context)
    },
  })
  t.after(() => hooks.deregister())
  const browserHostUrl = new URL(
    '../../packages/runner/src/browser/browser-host.js',
    import.meta.url
  )
  const { awaitRenderedPageOpening } = (await import(
    browserHostUrl.href
  )) as BrowserHostInternals

  const preAbort = new AbortController()
  preAbort.abort(new Error('already stopped'))
  let factoryCalls = 0
  await assert.rejects(
    awaitRenderedPageOpening(async () =>
    {
      factoryCalls++
      return {}
    }, preAbort.signal),
    /already stopped/
  )
  assert.equal(factoryCalls, 0)

  const acquired = deferred<{ close(): Promise<void> }>()
  const acquiredCleanup = deferred()
  const acquiredAbort = new AbortController()
  let acquiredCloseCalls = 0
  let acquiredRunSettled = false
  const acquiredRun = awaitRenderedPageOpening(
    () =>
    {
      acquiredAbort.abort(new Error('stop acquisition'))
      return acquired.promise
    },
    acquiredAbort.signal,
    {
      label: 'mock browser',
      cleanup: async (resource) =>
      {
        acquiredCloseCalls++
        await resource.close()
      },
      timeoutMs: MOCK_CLOSE_TIMEOUT_MS,
    }
  ).finally(() =>
  {
    acquiredRunSettled = true
  })
  acquired.resolve({
    async close(): Promise<void>
    {
      await acquiredCleanup.promise
    },
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(acquiredCloseCalls, 1)
  assert.equal(acquiredRunSettled, false)
  acquiredCleanup.resolve()
  await assert.rejects(acquiredRun, /stop acquisition/)
  assert.equal(acquiredRunSettled, true)

  const failedCleanupAbort = new AbortController()
  const failedCleanup = awaitRenderedPageOpening(
    async () => ({}),
    failedCleanupAbort.signal,
    {
      label: 'mock rejected browser',
      cleanup: () =>
      {
        throw new Error('close refused')
      },
      timeoutMs: MOCK_CLOSE_TIMEOUT_MS,
    }
  )
  failedCleanupAbort.abort(new Error('stop rejected cleanup'))
  await assert.rejects(failedCleanup, cleanupIncomplete)

  const unresolved = deferred<{ close(): Promise<void> }>()
  const unresolvedAbort = new AbortController()
  const cleanupErrors: unknown[] = []
  let lateCloseCalls = 0
  const unresolvedRun = awaitRenderedPageOpening(
    () => unresolved.promise,
    unresolvedAbort.signal,
    {
      label: 'mock context',
      cleanup: async (resource) =>
      {
        lateCloseCalls++
        await resource.close()
      },
      onCleanupError: (error) => cleanupErrors.push(error),
      timeoutMs: MOCK_CLOSE_TIMEOUT_MS,
    }
  )
  unresolvedAbort.abort(new Error('stop unresolved acquisition'))
  await assert.rejects(
    within(unresolvedRun, MOCK_CLOSE_TIMEOUT_MS + 1_000),
    cleanupIncomplete
  )
  assert.equal(lateCloseCalls, 0)
  assert.equal(cleanupErrors.length, 1)
  assert.match(
    cleanupErrors[0] instanceof Error
      ? cleanupErrors[0].message
      : String(cleanupErrors[0]),
    /mock context acquisition and late cleanup exceeded/
  )
  unresolved.resolve({ async close(): Promise<void>
  {} })
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(lateCloseCalls, 1)

  const profileEngineUrl = new URL(
    '../../packages/runner/src/development/profile-browser-engine.js',
    import.meta.url
  )
  const { openProfileBrowserEngineV1 } = (await import(
    profileEngineUrl.href
  )) as Pick<
    typeof import('@scratch-agent/runner'),
    'openProfileBrowserEngineV1'
  >
  const sb3 = await readFile(
    new URL('../../fixtures/fixture.sb3', import.meta.url)
  )
  const acquisitions = Array.from({ length: 4 }, () => deferred<unknown>())
  const started = acquisitions.map(() => deferred())
  const controllers = acquisitions.map(() => new AbortController())
  const runs: Promise<unknown>[] = []
  let launchCalls = 0
  const registry = globalThis as unknown as Record<symbol, MockLaunchRegistry>
  registry[Symbol.for(MOCK_LAUNCH_KEY)] = {
    launch()
    {
      const index = launchCalls++
      started[index]!.resolve()
      return acquisitions[index]!.promise
    },
  }
  let connected = true
  let browserCloseCalls = 0
  const disconnected = new Set<() => void>()
  const lateBrowser = {
    isConnected: () => connected,
    once(event: string, listener: () => void)
    {
      assert.equal(event, 'disconnected')
      disconnected.add(listener)
      return this
    },
    async close(): Promise<void>
    {
      browserCloseCalls++
      throw new Error('late browser close refused')
    },
  }
  const disconnect = () =>
  {
    connected = false
    for (const listener of disconnected) listener()
    disconnected.clear()
  }
  t.after(async () =>
  {
    for (const controller of controllers)
      controller.abort(new Error('test cleanup'))
    for (const acquisition of acquisitions)
      acquisition.reject(new Error('test cleanup'))
    disconnect()
    await Promise.allSettled(runs)
    delete registry[Symbol.for(MOCK_LAUNCH_KEY)]
  })
  const openProfile = (signal: AbortSignal) =>
    openProfileBrowserEngineV1({
      sb3,
      profile: {
        schemaVersion: 1,
        runtime: 'turbowarp',
        scheduler: 'deterministic',
        tickRate: 60,
      },
      headless: true,
      inputMode: 'agent',
      signal,
    })
  const stoppedOpenings = controllers.slice(0, 2).map((controller) =>
  {
    const run = openProfile(controller.signal)
    runs.push(run)
    return assert.rejects(run, cleanupIncomplete)
  })
  await within(Promise.all(started.slice(0, 2).map((entry) => entry.promise)))
  for (const controller of controllers.slice(0, 2))
    controller.abort(new Error('stop pending browser'))
  await within(Promise.all(stoppedOpenings), 6_000)
  await assert.rejects(
    openProfile(controllers[2]!.signal),
    /already open or opening/
  )
  assert.equal(launchCalls, 2)

  acquisitions[0]!.resolve(lateBrowser)
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(browserCloseCalls, 1)
  await assert.rejects(
    openProfile(controllers[2]!.signal),
    /already open or opening/
  )
  assert.equal(launchCalls, 2)

  disconnect()
  const replacement = openProfile(controllers[2]!.signal)
  runs.push(replacement)
  const replacementRejected = assert.rejects(replacement, /stop replacement/)
  await within(started[2]!.promise)
  disconnect()
  await assert.rejects(
    openProfile(controllers[3]!.signal),
    /already open or opening/
  )
  assert.equal(launchCalls, 3)

  acquisitions[1]!.reject(new Error('late launch failed without a browser'))
  await new Promise<void>((resolve) => setImmediate(resolve))
  const afterFailedLaunch = openProfile(controllers[3]!.signal)
  runs.push(afterFailedLaunch)
  const afterFailedLaunchRejected = assert.rejects(
    afterFailedLaunch,
    /stop replacement/
  )
  await within(started[3]!.promise)
  assert.equal(launchCalls, 4)
  await assert.rejects(
    openProfile(new AbortController().signal),
    /already open or opening/
  )
  assert.equal(launchCalls, 4)
  for (const index of [2, 3])
  {
    controllers[index]!.abort(new Error('stop replacement'))
    acquisitions[index]!.reject(new Error('cancelled launch failed'))
  }
  await within(Promise.all([replacementRejected, afterFailedLaunchRejected]))
  assert.equal(browserCloseCalls, 1)
})

test('browser resource close always attempts its bounded fallback', async () =>
{
  const browserHostUrl = new URL(
    '../../packages/runner/src/browser/browser-host.js',
    import.meta.url
  )
  const { closeRenderedPageResources, RENDERED_PAGE_CLOSE_TIMEOUT_MS } =
    (await import(browserHostUrl.href)) as BrowserHostInternals
  const errors: unknown[] = []
  let browserCloseCalls = 0
  const context = {
    close: () => new Promise<void>(() => undefined),
  }
  const browser = {
    async close(): Promise<void>
    {
      browserCloseCalls++
    },
  }
  await within(
    closeRenderedPageResources(context, browser, (error) => errors.push(error)),
    RENDERED_PAGE_CLOSE_TIMEOUT_MS + 1_000
  )
  assert.equal(browserCloseCalls, 1)
  assert.equal(errors.length, 1)
  assert.match(
    errors[0] instanceof Error ? errors[0].message : String(errors[0]),
    /browser context close exceeded/
  )
})
