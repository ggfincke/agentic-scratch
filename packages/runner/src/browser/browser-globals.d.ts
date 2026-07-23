// packages/runner/src/browser/browser-globals.d.ts
// ambient Window augmentation so browser-lane page.evaluate callbacks type-check

import type { SpikeApi } from './browser-api.js'

declare global
{
  interface Window
  {
    __spike?: SpikeApi
  }
}
