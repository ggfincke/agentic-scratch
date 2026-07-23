// packages/edit/src/session/handles.ts
// deterministic 87-character revision-bound semantic handle capabilities

import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import {
  hmacSha256Bytes,
  sha256Bytes,
  timingSafeBytesEqual,
} from '@scratch-agent/sb3/crypto-node'

import { HANDLE_CONTRACT } from '@scratch-agent/ir/edit'

export interface EditHandleBindingV1
{
  sessionId: string
  revisionId: string
  revisionNumber: number
  entityKind: string
  entitySubtype: string
  lineageSha256: string
  semanticLocationSha256: string
  semanticFingerprintSha256: string
  handleEpoch: number
}

function rawHandle(
  binding: EditHandleBindingV1,
  secret: Uint8Array
): Uint8Array
{
  if (secret.byteLength < 32)
    throw new TypeError('edit handle secret must contain at least 256 bits')
  const locationDigest = sha256Bytes(canonicalJsonBytesV1(binding))
  const versioned = new Uint8Array(1 + locationDigest.byteLength)
  versioned[0] = 1
  versioned.set(locationDigest, 1)
  const mac = hmacSha256Bytes(secret, versioned)
  const output = new Uint8Array(versioned.byteLength + mac.byteLength)
  output.set(versioned, 0)
  output.set(mac, versioned.byteLength)
  return output
}

export function issueEditHandleV1(
  binding: EditHandleBindingV1,
  secret: Uint8Array
): string
{
  const token = Buffer.from(rawHandle(binding, secret)).toString('base64url')
  if (
    token.length !== HANDLE_CONTRACT.tokenCharacters ||
    Buffer.from(token, 'base64url').byteLength !== HANDLE_CONTRACT.tokenRawBytes
  )
    throw new Error('edit handle encoder violated the frozen token contract')
  return token
}

export function verifyEditHandleV1(
  token: string,
  binding: EditHandleBindingV1,
  secret: Uint8Array
): boolean
{
  if (token.length !== HANDLE_CONTRACT.tokenCharacters) return false
  let received: Uint8Array
  try
  {
    received = new Uint8Array(Buffer.from(token, 'base64url'))
  }
  catch
  {
    return false
  }
  return timingSafeBytesEqual(received, rawHandle(binding, secret))
}
