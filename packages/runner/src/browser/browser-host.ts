// packages/runner/src/browser/browser-host.ts
// shared rendered-page launch, routing, network, input-guard, identity, & teardown policy

import { mkdirSync, readFileSync } from 'node:fs'
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
import type { RuntimeLineageManifestV1 } from '../lineage/runtime-lineage.js'
import { identityForBytes } from '../observation/observation-host.js'
import { resolvePackageManifest } from '../report/package-manifest.js'
import {
  officialScratchRuntimeDescriptor,
  turboWarpRuntimeDescriptor,
} from '../report/versions.js'
import { STAGE_HEIGHT, STAGE_WIDTH } from '../scenario/stage.js'

const TURBOWARP_RUNTIME_ID = '@turbowarp/scaffolding (chromium)'
const OFFICIAL_RUNTIME_ID = '@scratch/scratch-vm + scratch-render (chromium)'
const ORIGIN = 'https://spike.local'
const PROJECT_PATH = '/project.sb3'
const LINEAGE_MANIFEST_PATH = '/lineage-manifest.json'

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

export interface RenderedBrowserNetworkOptions
{
  readonly allowNetwork?: boolean
  readonly allowedOrigins?: readonly string[]
}

export interface OpenRenderedPageHostOptions extends RenderedBrowserNetworkOptions
{
  readonly runtimeKind: RenderedBrowserRuntime
  readonly sb3: Uint8Array
  readonly lineageManifest?: RuntimeLineageManifestV1
  readonly headless: boolean
  readonly videoDir?: string
  readonly blockPhysicalInput?: boolean
  readonly onBrowserLaunched?: (runtimeDescriptor: RuntimeDescriptorV1) => void
  readonly onVideo?: (video: ReturnType<Page['video']>) => void
  readonly onPageError?: (error: Error) => void
  readonly onConsole?: (type: string, text: string) => void
  readonly onNetworkDenied?: (url: string) => void
  readonly onCleanupError?: (error: unknown) => void
}

export interface RenderedPageHost
{
  readonly runtimeId: string
  readonly runtimeDescriptor: RuntimeDescriptorV1
  readonly browser: Browser
  readonly context: BrowserContext
  readonly page: Page
  readonly video: ReturnType<Page['video']> | null
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

function bundlePath(kind: RenderedBrowserRuntime): string
{
  const name = kind === 'turbowarp' ? 'page.js' : 'official-page.js'
  return fileURLToPath(new URL(`./${name}`, import.meta.url))
}

function packageBytes(name: string, relativePath: string): Buffer
{
  return readFileSync(join(resolvePackageManifest(name).root, relativePath))
}

function loadRuntimeAssets(
  kind: RenderedBrowserRuntime,
  options: RenderedBrowserNetworkOptions
): RenderedRuntimeAssets
{
  const bundle = readFileSync(bundlePath(kind))
  if (kind === 'turbowarp')
    return {
      runtimeId: TURBOWARP_RUNTIME_ID,
      bundle,
      scripts: ['/runtime.js'],
      served: [{ routePath: '/runtime.js', bytes: bundle }],
      descriptor(browserVersion: string): RuntimeDescriptorV1
      {
        return turboWarpRuntimeDescriptor({
          bundle,
          browserVersion,
          ...options,
        })
      },
    }

  const vmBundle = packageBytes('@scratch/scratch-vm', 'dist/web/scratch-vm.js')
  const rendererBundle = packageBytes(
    '@scratch/scratch-render',
    'dist/web/scratch-render.js'
  )
  const storageBundle = packageBytes(
    'scratch-storage',
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
  const storageWorkerPath = 'chunks/fetch-worker.7298f079654fee093ceb.js'
  const storageWorker = packageBytes(
    'scratch-storage',
    'dist/web/chunks/fetch-worker.7298f079654fee093ceb.js'
  )
  const workers = [
    identityForBytes('extension-worker.js', extensionWorker),
    identityForBytes(storageWorkerPath, storageWorker),
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
      { routePath: `/${storageWorkerPath}`, bytes: storageWorker },
    ],
    descriptor(browserVersion: string): RuntimeDescriptorV1
    {
      return officialScratchRuntimeDescriptor({
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

async function closeResources(
  context: BrowserContext | undefined,
  browser: Browser | undefined,
  onCleanupError: ((error: unknown) => void) | undefined
): Promise<void>
{
  if (context)
  {
    try
    {
      await context.close()
    }
    catch (error)
    {
      onCleanupError?.(error)
    }
  }
  if (browser)
  {
    try
    {
      await browser.close()
    }
    catch (error)
    {
      onCleanupError?.(error)
    }
  }
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
    browser = await chromium.launch({
      headless: options.headless,
      args: [...RENDERED_BROWSER_GL_ARGS],
    })
    const runtimeDescriptor = runtime.descriptor(browser.version())
    const contextOptions: BrowserContextOptions = {
      viewport: RENDERED_BROWSER_VIEWPORT,
      locale: RENDERED_BROWSER_LOCALE,
      timezoneId: RENDERED_BROWSER_TIMEZONE,
      deviceScaleFactor: RENDERED_BROWSER_DEVICE_SCALE_FACTOR,
      colorScheme: RENDERED_BROWSER_COLOR_SCHEME,
      reducedMotion: RENDERED_BROWSER_REDUCED_MOTION,
    }
    if (options.videoDir)
    {
      mkdirSync(options.videoDir, { recursive: true })
      contextOptions.recordVideo = { dir: options.videoDir }
    }
    context = await browser.newContext(contextOptions)
    const page = await context.newPage()
    const video = options.videoDir ? page.video() : null
    if (video) options.onVideo?.(video)
    page.on('pageerror', (error) => options.onPageError?.(error))
    page.on('console', (message) =>
      options.onConsole?.(message.type(), message.text())
    )
    if (options.blockPhysicalInput) await installPhysicalInputGuard(page)
    await installOfflineRoute(page, options.sb3, runtime, options)
    await page.goto(`${ORIGIN}/`, { waitUntil: 'load' })
    await page.waitForFunction(
      "window.__spike && typeof window.__spike.load === 'function'",
      null,
      { timeout: 20000 }
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
      video,
      projectPath: PROJECT_PATH,
      lineageManifestPath: options.lineageManifest
        ? LINEAGE_MANIFEST_PATH
        : null,
      close(): Promise<void>
      {
        closePromise ??= closeResources(
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
    await closeResources(context, browser, options.onCleanupError)
    throw error
  }
}
