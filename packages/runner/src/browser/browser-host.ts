// packages/runner/src/browser/browser-host.ts
// shared rendered-page launch, routing, network, input-guard, identity, & teardown policy

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright'

import {
  OFFICIAL_SCRATCH_SCRIPT_ORDER,
  RENDERED_BROWSER_COLOR_SCHEME,
  RENDERED_BROWSER_DEVICE_SCALE_FACTOR,
  RENDERED_BROWSER_GL_ARGS,
  RENDERED_BROWSER_LOCALE,
  RENDERED_BROWSER_REDUCED_MOTION,
  RENDERED_BROWSER_TIMEZONE,
  RENDERED_BROWSER_VIEWPORT,
} from './browser-config.js'
import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import { createRunIssue, RunnerIssueError } from '../policy/issues.js'
import type { RuntimeLineageManifestV1 } from '../lineage/runtime-lineage.js'
import { identityForBytes } from '../observation/observation-host.js'
import { resolvePackageManifest } from '../report/package-manifest.js'
import {
  officialScratchRuntimeDescriptor,
  turboWarpRuntimeDescriptor,
} from '../report/versions.js'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'
import {
  validateRuntimeExecutionProfileV1,
  type RuntimeExecutionProfileV1,
} from '../development/execution-profile.js'
import { bindProfileRuntimeDescriptorV2 } from '../development/profile-identity.js'

const TURBOWARP_RUNTIME_ID = '@turbowarp/scaffolding (chromium)'
const OFFICIAL_RUNTIME_ID = '@scratch/scratch-vm + scratch-render (chromium)'
const ORIGIN = 'https://spike.local'
const PROJECT_PATH = '/project.sb3'
const LINEAGE_MANIFEST_PATH = '/lineage-manifest.json'
export const RENDERED_PAGE_CLOSE_TIMEOUT_MS = 5_000

const PHYSICAL_INPUT_EVENTS = [
  'keydown',
  'keyup',
  'keypress',
  'mousedown',
  'mouseup',
  'mousemove',
  'click',
  'dblclick',
  'contextmenu',
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'wheel',
  'beforeinput',
  'input',
  'change',
] as const

export type RenderedBrowserRuntime = 'turbowarp' | 'scratch-official'

interface RenderedBrowserNetworkOptions
{
  readonly allowNetwork?: boolean
  readonly allowedOrigins?: readonly string[]
  readonly executionProfile?: RuntimeExecutionProfileV1
  readonly inputMode?: 'agent' | 'human'
}

interface OpenRenderedPageHostOptions extends RenderedBrowserNetworkOptions
{
  readonly runtimeKind: RenderedBrowserRuntime
  readonly sb3: Uint8Array
  readonly lineageManifest?: RuntimeLineageManifestV1
  readonly headless: boolean
  readonly blockPhysicalInput?: boolean
  readonly onBrowserLaunched?: (runtimeDescriptor: RuntimeDescriptorV1) => void
  readonly onPageError?: (error: Error) => void
  readonly onConsole?: (type: string, text: string) => void
  readonly onNetworkDenied?: (url: string) => void
  readonly onCleanupError?: (error: unknown) => void
  readonly onOpeningLease?: (lease: RenderedPageOpeningLeaseV1) => void
  readonly signal?: AbortSignal
  readonly ownerControlsProcessSignals?: boolean
}

export interface RenderedPageOpeningLeaseV1
{
  readonly released: Promise<void>
}

export interface RenderedPageHost
{
  readonly runtimeId: string
  readonly runtimeDescriptor: RuntimeDescriptorV1
  readonly browser: Browser
  readonly context: BrowserContext
  readonly page: Page
  readonly projectPath: string
  readonly lineageManifestPath: string | null
  close(): Promise<void>
}

interface ServedRuntimeAsset
{
  readonly routePath: string
  readonly bytes: Buffer
}

interface RenderedRuntimeAssets
{
  readonly runtimeId: string
  readonly bundle: Buffer
  readonly scripts: readonly string[]
  readonly served: readonly ServedRuntimeAsset[]
  descriptor(browserVersion: string): RuntimeDescriptorV1
}

function bundlePath(kind: RenderedBrowserRuntime, debug = false): string
{
  const name = debug
    ? kind === 'turbowarp'
      ? 'debug-page.js'
      : 'official-debug-page.js'
    : kind === 'turbowarp'
      ? 'page.js'
      : 'official-page.js'
  return fileURLToPath(new URL(`./${name}`, import.meta.url))
}

function packageBytes(name: string, relativePath: string): Buffer
{
  return readFileSync(join(resolvePackageManifest(name).root, relativePath))
}

// hashed chunk names change per upstream release; scan instead of hardcoding
function storageFetchWorkers(): { path: string; bytes: Buffer }[]
{
  const chunksRoot = join(
    resolvePackageManifest('@scratch/scratch-storage').root,
    'dist',
    'web',
    'chunks'
  )
  return readdirSync(chunksRoot)
    .filter((name) => /^fetch-worker\..+\.js$/.test(name))
    .sort()
    .map((name) => ({
      path: `chunks/${name}`,
      bytes: readFileSync(join(chunksRoot, name)),
    }))
}

function loadRuntimeAssets(
  kind: RenderedBrowserRuntime,
  options: RenderedBrowserNetworkOptions
): RenderedRuntimeAssets
{
  const profile =
    options.executionProfile === undefined
      ? undefined
      : validateRuntimeExecutionProfileV1(options.executionProfile)
  if (profile !== undefined && profile.runtime !== kind)
    throw new Error('execution profile runtime differs from browser lane')
  const bundle = readFileSync(bundlePath(kind, profile !== undefined))
  if (kind === 'turbowarp')
    return {
      runtimeId: TURBOWARP_RUNTIME_ID,
      bundle,
      scripts: ['/runtime.js'],
      served: [{ routePath: '/runtime.js', bytes: bundle }],
      descriptor(browserVersion: string): RuntimeDescriptorV1
      {
        const descriptor = turboWarpRuntimeDescriptor({
          bundle,
          browserVersion,
          ...options,
        })
        return profile
          ? bindProfileRuntimeDescriptorV2(
              descriptor,
              profile,
              options.inputMode
            )
          : descriptor
      },
    }

  const vmBundle = packageBytes('@scratch/scratch-vm', 'dist/web/scratch-vm.js')
  const rendererBundle = packageBytes(
    '@scratch/scratch-render',
    'dist/web/scratch-render.js'
  )
  const storageBundle = packageBytes(
    '@scratch/scratch-storage',
    'dist/web/scratch-storage.js'
  )
  const svgBundle = packageBytes(
    '@scratch/scratch-svg-renderer',
    'dist/web/scratch-svg-renderer.js'
  )
  const audioBundle = packageBytes('scratch-audio', 'dist.js')
  const extensionWorker = packageBytes(
    '@scratch/scratch-vm',
    'dist/web/extension-worker.js'
  )
  const fetchWorkers = storageFetchWorkers()
  const workers = [
    identityForBytes('extension-worker.js', extensionWorker),
    ...fetchWorkers.map(({ path, bytes }) => identityForBytes(path, bytes)),
  ]
  return {
    runtimeId: OFFICIAL_RUNTIME_ID,
    bundle,
    scripts: [...OFFICIAL_SCRATCH_SCRIPT_ORDER],
    served: [
      { routePath: '/vendor/scratch-vm.js', bytes: vmBundle },
      { routePath: '/vendor/scratch-render.js', bytes: rendererBundle },
      { routePath: '/vendor/scratch-storage.js', bytes: storageBundle },
      { routePath: '/vendor/scratch-svg-renderer.js', bytes: svgBundle },
      { routePath: '/runtime.js', bytes: bundle },
      { routePath: '/extension-worker.js', bytes: extensionWorker },
      ...fetchWorkers.map(({ path, bytes }) => ({
        routePath: `/${path}`,
        bytes,
      })),
    ],
    descriptor(browserVersion: string): RuntimeDescriptorV1
    {
      const descriptor = officialScratchRuntimeDescriptor({
        bundle,
        browserVersion,
        vmBundle,
        rendererBundle,
        storageBundle,
        svgBundle,
        audioBundle,
        workers,
        ...options,
      })
      return profile
        ? bindProfileRuntimeDescriptorV2(descriptor, profile, options.inputMode)
        : descriptor
    },
  }
}

function bundleBytesForIdentity(kind: RenderedBrowserRuntime): Buffer
{
  try
  {
    return readFileSync(bundlePath(kind))
  }
  catch
  {
    return Buffer.alloc(0)
  }
}

export function renderedRuntimeId(kind: RenderedBrowserRuntime): string
{
  return kind === 'turbowarp' ? TURBOWARP_RUNTIME_ID : OFFICIAL_RUNTIME_ID
}

export function renderedRuntimeDescriptorBeforeLaunch(
  kind: RenderedBrowserRuntime,
  options: RenderedBrowserNetworkOptions
): RuntimeDescriptorV1
{
  return loadRuntimeAssets(kind, options).descriptor('not-launched')
}

export function profileRuntimeDescriptorBeforeLaunchV1(
  profile: RuntimeExecutionProfileV1,
  inputMode: 'agent' | 'human' = 'agent'
): RuntimeDescriptorV1
{
  const checked = validateRuntimeExecutionProfileV1(profile)
  return loadRuntimeAssets(checked.runtime, {
    allowNetwork: false,
    allowedOrigins: [],
    executionProfile: checked,
    inputMode,
  }).descriptor('not-launched')
}

export function fallbackRenderedRuntimeDescriptor(
  kind: RenderedBrowserRuntime,
  options: RenderedBrowserNetworkOptions
): RuntimeDescriptorV1
{
  const bundle = bundleBytesForIdentity(kind)
  if (kind === 'turbowarp')
    return turboWarpRuntimeDescriptor({
      bundle,
      browserVersion: 'not-launched',
      ...options,
    })
  return officialScratchRuntimeDescriptor({
    bundle,
    browserVersion: 'not-launched',
    vmBundle: new Uint8Array(),
    rendererBundle: new Uint8Array(),
    storageBundle: new Uint8Array(),
    svgBundle: new Uint8Array(),
    audioBundle: new Uint8Array(),
    workers: [],
    ...options,
  })
}

function hostHtml(runtime: RenderedRuntimeAssets): string
{
  const scripts = runtime.scripts
    .map((path) => `<script src="${path}"></script>`)
    .join('')
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<link rel="icon" href="data:,"></head>' +
    `<body><div id="app" style="width:${STAGE_WIDTH}px;height:${STAGE_HEIGHT}px"></div>` +
    `${scripts}</body></html>`
  )
}

function allowedExternalRequest(
  url: string,
  options: RenderedBrowserNetworkOptions
): boolean
{
  if (options.allowNetwork === true) return true
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  try
  {
    return allowedOrigins.has(new URL(url).origin)
  }
  catch
  {
    return false
  }
}

export async function installBrowserWebSocketPolicy(
  page: Page,
  onDenied: (url: string) => void,
  options: RenderedBrowserNetworkOptions
): Promise<void>
{
  await page.routeWebSocket(/.*/, async (webSocket) =>
  {
    const url = webSocket.url()
    if (allowedExternalRequest(url, options))
    {
      webSocket.connectToServer()
      return
    }
    onDenied(url)
    await webSocket.close({ code: 1008, reason: 'network disabled' })
  })
}

async function installPhysicalInputGuard(page: Page): Promise<void>
{
  await page.addInitScript((eventTypes) =>
  {
    const blockPhysicalInput = (event: Event): void =>
    {
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
    }
    for (const type of eventTypes)
      window.addEventListener(type, blockPhysicalInput, {
        capture: true,
        passive: false,
      })
  }, PHYSICAL_INPUT_EVENTS)
}

async function installOfflineRoute(
  page: Page,
  sb3: Uint8Array,
  runtime: RenderedRuntimeAssets,
  options: OpenRenderedPageHostOptions
): Promise<void>
{
  const host = hostHtml(runtime)
  const projectBody = Buffer.from(sb3)
  const manifestBody = options.lineageManifest
    ? Buffer.from(JSON.stringify(options.lineageManifest), 'utf8')
    : null
  const runtimeAssets = new Map(
    runtime.served.map((asset) => [asset.routePath, asset.bytes])
  )
  await page.route('**/*', async (route) =>
  {
    const url = route.request().url()
    const parsed = new URL(url)
    if (parsed.origin === ORIGIN && parsed.pathname === PROJECT_PATH)
    {
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        body: projectBody,
      })
      return
    }
    if (
      manifestBody &&
      parsed.origin === ORIGIN &&
      parsed.pathname === LINEAGE_MANIFEST_PATH
    )
    {
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: manifestBody,
      })
      return
    }
    if (parsed.origin === ORIGIN && parsed.pathname === '/')
    {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: host,
      })
      return
    }
    const runtimeAsset = runtimeAssets.get(parsed.pathname)
    if (parsed.origin === ORIGIN && runtimeAsset)
    {
      await route.fulfill({
        status: 200,
        contentType: 'text/javascript; charset=utf-8',
        body: runtimeAsset,
      })
      return
    }
    if (allowedExternalRequest(url, options))
    {
      await route.continue()
      return
    }
    options.onNetworkDenied?.(url)
    await route.abort('blockedbyclient')
  })
  await installBrowserWebSocketPolicy(
    page,
    (url) => options.onNetworkDenied?.(url),
    options
  )
}

function openingAbortReason(signal: AbortSignal): unknown
{
  return signal.reason ?? new Error('rendered browser opening was cancelled')
}

export async function awaitRenderedPageOpening<T>(
  factory: () => Promise<T>,
  signal: AbortSignal | undefined,
  late?: {
    readonly label: string
    readonly cleanup: (value: T) => void | Promise<void>
    readonly onCleanupError?: (error: unknown) => void
    readonly timeoutMs?: number
  }
): Promise<T>
{
  if (signal?.aborted) throw openingAbortReason(signal)
  const operation = factory()
  if (!signal) return await operation

  return await new Promise<T>((resolve, reject) =>
  {
    let aborted = false
    const onAbort = (): void =>
    {
      if (aborted) return
      aborted = true
      signal.removeEventListener('abort', onAbort)
      const reason = openingAbortReason(signal)
      if (!late)
      {
        reject(reason)
        return
      }
      const incomplete = (error: unknown): RunnerIssueError =>
      {
        const issue = new RunnerIssueError(
          createRunIssue({
            code: 'runner.cleanup.incomplete',
            kind: 'runtime',
            responsibility: 'infrastructure',
            message: `${late.label} late cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
          })
        )
        try
        {
          late.onCleanupError?.(error)
        }
        catch
        {
          return issue
        }
        return issue
      }
      const cleanup = operation.then(
        async (value) =>
        {
          try
          {
            await late.cleanup(value)
          }
          catch (error)
          {
            throw incomplete(error)
          }
        },
        () => undefined
      )
      const timeoutMs = late.timeoutMs ?? RENDERED_PAGE_CLOSE_TIMEOUT_MS
      let timer: NodeJS.Timeout | undefined
      void Promise.race([
        cleanup,
        new Promise<never>((_resolve, rejectTimeout) =>
        {
          timer = setTimeout(() =>
          {
            rejectTimeout(
              incomplete(
                new Error(
                  `${late.label} acquisition and late cleanup exceeded ${timeoutMs} ms after cancellation`
                )
              )
            )
          }, timeoutMs)
        }),
      ]).then(
        () =>
        {
          if (timer) clearTimeout(timer)
          reject(reason)
        },
        (error: unknown) =>
        {
          if (timer) clearTimeout(timer)
          reject(error)
        }
      )
    }
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    void operation.then(
      (value) =>
      {
        if (aborted) return
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) =>
      {
        if (aborted) return
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
    )
  })
}

async function closeResource(
  label: 'browser context' | 'browser',
  close: () => Promise<void>,
  onCleanupError: ((error: unknown) => void) | undefined
): Promise<void>
{
  let timer: NodeJS.Timeout | undefined
  try
  {
    await Promise.race([
      close(),
      new Promise<never>((_resolve, reject) =>
      {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} close exceeded ${RENDERED_PAGE_CLOSE_TIMEOUT_MS} ms`
              )
            ),
          RENDERED_PAGE_CLOSE_TIMEOUT_MS
        )
      }),
    ])
  }
  catch (error)
  {
    onCleanupError?.(error)
  }
  finally
  {
    if (timer) clearTimeout(timer)
  }
}

export async function closeRenderedPageResources(
  context: BrowserContext | undefined,
  browser: Browser | undefined,
  onCleanupError: ((error: unknown) => void) | undefined
): Promise<void>
{
  if (context)
    await closeResource(
      'browser context',
      () => context.close(),
      onCleanupError
    )
  if (browser)
    await closeResource('browser', () => browser.close(), onCleanupError)
}

export async function openRenderedPageHost(
  options: OpenRenderedPageHostOptions
): Promise<RenderedPageHost>
{
  const runtime = loadRuntimeAssets(options.runtimeKind, options)
  let browser: Browser | undefined
  let context: BrowserContext | undefined
  try
  {
    browser = await awaitRenderedPageOpening(
      () =>
      {
        let release!: () => void
        const released = new Promise<void>((resolve) =>
        {
          release = resolve
        })
        try
        {
          options.onOpeningLease?.({ released })
          const opening = chromium.launch({
            headless: options.headless,
            args: [...RENDERED_BROWSER_GL_ARGS],
            ...(options.ownerControlsProcessSignals
              ? {
                  handleSIGINT: false,
                  handleSIGTERM: false,
                  handleSIGHUP: false,
                }
              : {}),
          })
          // the lease outlives cancellation, including a launch that settles after its caller
          return opening.then(
            (acquired) =>
            {
              acquired.once('disconnected', release)
              if (!acquired.isConnected()) release()
              return acquired
            },
            (error: unknown) =>
            {
              release()
              throw error
            }
          )
        }
        catch (error)
        {
          release()
          throw error
        }
      },
      options.signal,
      {
        label: 'browser launch',
        cleanup: async (lateBrowser) =>
        {
          await lateBrowser.close()
          if (lateBrowser.isConnected())
            throw new Error('late browser remains connected after close')
        },
        onCleanupError: options.onCleanupError,
      }
    )
    const runtimeDescriptor = runtime.descriptor(browser.version())
    const contextOptions: BrowserContextOptions = {
      viewport: RENDERED_BROWSER_VIEWPORT,
      locale: RENDERED_BROWSER_LOCALE,
      timezoneId: RENDERED_BROWSER_TIMEZONE,
      deviceScaleFactor: RENDERED_BROWSER_DEVICE_SCALE_FACTOR,
      colorScheme: RENDERED_BROWSER_COLOR_SCHEME,
      reducedMotion: RENDERED_BROWSER_REDUCED_MOTION,
    }
    context = await awaitRenderedPageOpening(
      () => browser!.newContext(contextOptions),
      options.signal,
      {
        label: 'browser context',
        cleanup: async (lateContext) => await lateContext.close(),
        onCleanupError: options.onCleanupError,
      }
    )
    const page = await awaitRenderedPageOpening(
      () => context!.newPage(),
      options.signal
    )
    page.on('pageerror', (error) => options.onPageError?.(error))
    page.on('console', (message) =>
      options.onConsole?.(message.type(), message.text())
    )
    if (options.blockPhysicalInput)
      await awaitRenderedPageOpening(
        () => installPhysicalInputGuard(page),
        options.signal
      )
    await awaitRenderedPageOpening(
      () => installOfflineRoute(page, options.sb3, runtime, options),
      options.signal
    )
    await awaitRenderedPageOpening(
      () => page.goto(`${ORIGIN}/`, { waitUntil: 'load' }),
      options.signal
    )
    await awaitRenderedPageOpening(
      () =>
        page.waitForFunction(
          options.executionProfile
            ? "window.__projectDebug && typeof window.__projectDebug.load === 'function'"
            : "window.__spike && typeof window.__spike.load === 'function'",
          null,
          { timeout: 20000 }
        ),
      options.signal
    )
    // fire only after goto + __spike so launch-stage diagnostics stay accurate
    options.onBrowserLaunched?.(runtimeDescriptor)

    let closePromise: Promise<void> | undefined
    return {
      runtimeId: runtime.runtimeId,
      runtimeDescriptor,
      browser,
      context,
      page,
      projectPath: PROJECT_PATH,
      lineageManifestPath: options.lineageManifest
        ? LINEAGE_MANIFEST_PATH
        : null,
      close(): Promise<void>
      {
        closePromise ??= closeRenderedPageResources(
          context,
          browser,
          options.onCleanupError
        )
        return closePromise
      },
    }
  }
  catch (error)
  {
    await closeRenderedPageResources(context, browser, options.onCleanupError)
    if (options.ownerControlsProcessSignals && browser?.isConnected())
      throw new RunnerIssueError(
        createRunIssue({
          code: 'runner.cleanup.incomplete',
          kind: 'runtime',
          responsibility: 'infrastructure',
          message:
            'opening development browser remains connected after bounded owner cleanup',
        })
      )
    throw error
  }
}
