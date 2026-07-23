// packages/runner/src/browser/browser-config.ts
// pinned rendered-browser execution config shared w/ runtime identity

import type { RuntimeLineageLoaderIdentityV1 } from '../lineage/runtime-lineage.js'

export const RUNNER_TICK_MS = 1000 / 60

export const TURBOWARP_LINEAGE_IDENTITY: RuntimeLineageLoaderIdentityV1 =
  Object.freeze({
    laneId: 'turbowarp-scaffolding',
    loaderId: '@turbowarp/scaffolding vendored sb3.deserialize',
    loaderVersion: '0.4.0',
    seamId: 'VirtualMachine.installTargets(wholeProject)',
    declarationNormalizationId: 'replaceUnsafeCharsInVariableIds@sb3',
  })

export const OFFICIAL_BROWSER_LINEAGE_IDENTITY: RuntimeLineageLoaderIdentityV1 =
  Object.freeze({
    laneId: 'official-browser',
    loaderId: '@scratch/scratch-vm/dist/web sb3.deserialize',
    loaderVersion: '14.1.0',
    seamId: 'VirtualMachine.installTargets(wholeProject)',
    declarationNormalizationId: 'replaceUnsafeCharsInVariableIds@sb3',
  })

export const RENDERED_BROWSER_VIEWPORT = { width: 600, height: 480 } as const
export const RENDERED_BROWSER_LOCALE = 'en-US'
export const RENDERED_BROWSER_TIMEZONE = 'UTC'
export const RENDERED_BROWSER_DEVICE_SCALE_FACTOR = 1
export const RENDERED_BROWSER_COLOR_SCHEME = 'light' as const
export const RENDERED_BROWSER_REDUCED_MOTION = 'reduce' as const

export const OFFICIAL_SCRATCH_SCRIPT_ORDER = [
  '/vendor/scratch-vm.js',
  '/vendor/scratch-render.js',
  '/vendor/scratch-storage.js',
  '/vendor/scratch-svg-renderer.js',
  '/runtime.js',
] as const

export const RENDERED_BROWSER_GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
] as const
