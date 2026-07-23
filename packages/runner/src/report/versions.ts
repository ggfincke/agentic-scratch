// packages/runner/src/report/versions.ts
// collect pinned runtime versions for reproducible run reports

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { chromium } from 'playwright'

import {
  OFFICIAL_SCRATCH_SCRIPT_ORDER,
  RENDERED_BROWSER_COLOR_SCHEME,
  RENDERED_BROWSER_DEVICE_SCALE_FACTOR,
  RENDERED_BROWSER_GL_ARGS,
  RENDERED_BROWSER_LOCALE,
  RENDERED_BROWSER_REDUCED_MOTION,
  RENDERED_BROWSER_TIMEZONE,
  RENDERED_BROWSER_VIEWPORT,
} from '../browser/browser-config.js'
import type { RunVersions } from '../policy/types.js'
import {
  hashRuntimeConfiguration,
  identityForBytes,
} from '../observation/observation-host.js'
import { resolvePackageManifest } from './package-manifest.js'
import {
  RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
  type RuntimeComponentV1,
  type RuntimeDescriptorV1,
  type RuntimeFileIdentityV1,
} from '../lineage/runtime-identity.js'

// read a dep version by resolving its entry then walking up to its package.json
// (deep `require('<pkg>/package.json')` is blocked by exports maps on scoped pkgs)
function pkgVersion(name: string): string
{
  try
  {
    const version = resolvePackageManifest(name).version
    return typeof version === 'string' ? version : 'unknown'
  }
  catch
  {
    return 'unknown'
  }
}

function componentIdentity(name: string): RuntimeComponentV1
{
  let version = 'unknown'
  try
  {
    const resolved = resolvePackageManifest(name)
    if (typeof resolved.version === 'string') version = resolved.version
    const bytes = readFileSync(resolved.entryPath)
    return {
      name,
      version,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.byteLength,
    }
  }
  catch
  {
    return { name, version, sha256: null, byteLength: null }
  }
}

function componentIdentityForBytes(
  name: string,
  bytes: Uint8Array
): RuntimeComponentV1
{
  return {
    name,
    version: pkgVersion(name),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}

function normalizedOrigins(origins: readonly string[] | undefined): string[]
{
  return [...new Set(origins ?? [])].sort()
}

function descriptorEnvironment(): RuntimeDescriptorV1['environment']
{
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  }
}

function networkAccess(
  options: { allowNetwork?: boolean; allowedOrigins?: readonly string[] }
): RuntimeDescriptorV1['network']
{
  return options.allowNetwork === true ||
    (options.allowedOrigins?.length ?? 0) > 0
    ? 'allowlisted'
    : 'denied'
}

export function nodeRuntimeDescriptor(options: {
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
}): RuntimeDescriptorV1
{
  const components = [
    componentIdentity('@scratch/scratch-vm'),
    componentIdentity('scratch-parser'),
  ]
  const configuration = {
    clock: 'manual-60-tps',
    deterministicTimers: true,
    seedSource: 'scenario',
    fixedDateSource: 'scenario',
    locale: RENDERED_BROWSER_LOCALE,
    timezone: RENDERED_BROWSER_TIMEZONE,
    allowNetwork: options.allowNetwork === true,
    allowedOrigins: normalizedOrigins(options.allowedOrigins),
    networkTransports: ['fetch', 'websocket'],
  }
  const configurationSha256 = hashRuntimeConfiguration(configuration)
  return {
    schemaVersion: RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
    id: `scratch-vm-node@${components[0]!.version}:${configurationSha256.slice(0, 12)}`,
    kind: 'scratch-vm-node',
    configurationSha256,
    renderer: 'none',
    compiler: 'not-applicable',
    network: networkAccess(options),
    components,
    browser: null,
    bundle: null,
    workers: [],
    environment: descriptorEnvironment(),
  }
}

export function turboWarpRuntimeDescriptor(options: {
  bundle: Uint8Array
  browserVersion: string
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
}): RuntimeDescriptorV1
{
  const components = [
    componentIdentity('@turbowarp/scaffolding'),
    componentIdentity('playwright'),
  ]
  const bundle = identityForBytes('browser/page.js', options.bundle)
  const configuration = {
    clock: 'manual-60-tps',
    deterministicTimers: true,
    renderer: 'swiftshader-webgl',
    viewport: RENDERED_BROWSER_VIEWPORT,
    locale: RENDERED_BROWSER_LOCALE,
    timezone: RENDERED_BROWSER_TIMEZONE,
    deviceScaleFactor: RENDERED_BROWSER_DEVICE_SCALE_FACTOR,
    colorScheme: RENDERED_BROWSER_COLOR_SCHEME,
    reducedMotion: RENDERED_BROWSER_REDUCED_MOTION,
    compiler: 'enabled',
    compatibilityMode: true,
    turboMode: false,
    allowNetwork: options.allowNetwork === true,
    allowedOrigins: normalizedOrigins(options.allowedOrigins),
    networkTransports: ['http', 'https', 'ws', 'wss'],
    glArgs: RENDERED_BROWSER_GL_ARGS,
  }
  const configurationSha256 = hashRuntimeConfiguration(configuration)
  return {
    schemaVersion: RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
    id: `turbowarp-browser@${components[0]!.version}:${configurationSha256.slice(0, 12)}`,
    kind: 'turbowarp-browser',
    configurationSha256,
    renderer: 'turbowarp-renderer',
    compiler: 'enabled',
    network: networkAccess(options),
    components,
    browser: { name: 'chromium', version: options.browserVersion },
    bundle,
    workers: [],
    environment: descriptorEnvironment(),
  }
}

export function officialScratchRuntimeDescriptor(options: {
  bundle: Uint8Array
  browserVersion: string
  vmBundle: Uint8Array
  rendererBundle: Uint8Array
  storageBundle: Uint8Array
  svgBundle: Uint8Array
  audioBundle: Uint8Array
  workers: RuntimeFileIdentityV1[]
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
}): RuntimeDescriptorV1
{
  const components = [
    componentIdentityForBytes('@scratch/scratch-vm', options.vmBundle),
    componentIdentityForBytes(
      '@scratch/scratch-render',
      options.rendererBundle
    ),
    componentIdentityForBytes('scratch-storage', options.storageBundle),
    componentIdentityForBytes(
      '@scratch/scratch-svg-renderer',
      options.svgBundle
    ),
    componentIdentityForBytes('scratch-audio', options.audioBundle),
    componentIdentity('playwright'),
  ]
  const configuration = {
    clock: 'manual-60-tps',
    deterministicTimers: true,
    renderer: 'scratch-render-swiftshader-webgl',
    viewport: RENDERED_BROWSER_VIEWPORT,
    locale: RENDERED_BROWSER_LOCALE,
    timezone: RENDERED_BROWSER_TIMEZONE,
    deviceScaleFactor: RENDERED_BROWSER_DEVICE_SCALE_FACTOR,
    colorScheme: RENDERED_BROWSER_COLOR_SCHEME,
    reducedMotion: RENDERED_BROWSER_REDUCED_MOTION,
    compiler: 'not-applicable',
    compatibilityMode: false,
    turboMode: false,
    allowNetwork: options.allowNetwork === true,
    allowedOrigins: normalizedOrigins(options.allowedOrigins),
    networkTransports: ['http', 'https', 'ws', 'wss'],
    scriptOrder: [...OFFICIAL_SCRATCH_SCRIPT_ORDER],
    glArgs: RENDERED_BROWSER_GL_ARGS,
  }
  const configurationSha256 = hashRuntimeConfiguration(configuration)
  return {
    schemaVersion: RUNTIME_DESCRIPTOR_SCHEMA_VERSION,
    id: `scratch-official-browser@${components[0]!.version}:${configurationSha256.slice(0, 12)}`,
    kind: 'scratch-official-browser',
    configurationSha256,
    renderer: 'scratch-render',
    compiler: 'not-applicable',
    network: networkAccess(options),
    components,
    browser: { name: 'chromium', version: options.browserVersion },
    bundle: identityForBytes('browser/official-page.js', options.bundle),
    workers: structuredClone(options.workers),
    environment: descriptorEnvironment(),
  }
}

export function collectVersions(): RunVersions
{
  return {
    node: process.version,
    vm: pkgVersion('@scratch/scratch-vm'),
    scaffolding: pkgVersion('@turbowarp/scaffolding'),
    parser: pkgVersion('scratch-parser'),
    jszip: pkgVersion('jszip'),
    playwright: pkgVersion('playwright'),
  }
}

export function browserRuntimeIdentity(): string
{
  const component = chromium
    .executablePath()
    .split(/[\\/]/)
    .find((entry) => /^chromium(?:_headless_shell)?-\d+$/.test(entry))
  return component ?? 'chromium-bundled'
}
