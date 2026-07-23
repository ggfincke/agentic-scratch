// packages/runner/src/browser/hash-parity-page-entry.ts
// expose the production browser semantic hash adapter for parity harnesses

import {
  bytesToLowerHex,
  canonicalJsonV1,
  semanticHashPreimageV1,
  semanticHashWebCryptoV1,
  sha256WebCryptoHex,
} from './semantic-hash.js'

interface Phase8SemanticHashBrowserApi
{
  readonly canonicalJsonV1: typeof canonicalJsonV1
  readonly preimageHexV1: (domain: string, projection: unknown) => string
  readonly semanticHashV1: typeof semanticHashWebCryptoV1
  readonly sha256Hex: typeof sha256WebCryptoHex
}

const browserApi: Phase8SemanticHashBrowserApi = Object.freeze({
  canonicalJsonV1,
  preimageHexV1(domain: string, projection: unknown): string
  {
    return bytesToLowerHex(semanticHashPreimageV1(domain, projection))
  },
  semanticHashV1: semanticHashWebCryptoV1,
  sha256Hex: sha256WebCryptoHex,
})

const globals = globalThis as typeof globalThis & {
  __phase8SemanticHash?: Phase8SemanticHashBrowserApi
}

globals.__phase8SemanticHash = browserApi
