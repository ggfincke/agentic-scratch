// packages/runner/src/browser/semantic-hash.ts
// Web Crypto semantic hashing over the shared canonical byte authority

import {
  canonicalJsonV1,
  semanticHashPreimageV1,
} from '@scratch-agent/sb3/canonical-json'

export function bytesToLowerHex(bytes: Uint8Array): string
{
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

export async function sha256WebCryptoHex(bytes: Uint8Array): Promise<string>
{
  const owned = new Uint8Array(bytes.byteLength)
  owned.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', owned)
  return bytesToLowerHex(new Uint8Array(digest))
}

export async function semanticHashWebCryptoV1(
  domain: string,
  projection: unknown
): Promise<string>
{
  return sha256WebCryptoHex(semanticHashPreimageV1(domain, projection))
}

export { canonicalJsonV1, semanticHashPreimageV1 }
