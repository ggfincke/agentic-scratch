// packages/ir/src/project/roundtrip.ts
// round-trip a .sb3 through the IR & report any lossiness (json fields + asset bytes)

import { createHash } from 'node:crypto'

import {
  admitSb3,
  type Asset,
  type ProjectJson,
  type Sb3Admission,
  type UnpackOptions,
} from '@scratch-agent/sb3'

import { canonicalize, diffJson, type Json, type JsonDiff } from '../core/json.js'
import { ProjectIR } from './project-ir.js'

interface AssetDiff
{
  path: string
  kind: 'missing' | 'extra' | 'changed'
}

export interface RoundTripResult
{
  // canonically lossless: no field dropped or changed (compares re-parsed json)
  lossless: boolean
  // stronger: the re-emitted project.json text is byte-identical to the input
  // (assets are carried verbatim; the zip container is re-encoded & may differ)
  jsonTextIdentical: boolean
  semanticJsonEqual: boolean
  projectJsonExact: boolean
  assetsExact: boolean
  contentExact: boolean
  projectJsonSha256In: string
  projectJsonSha256Out: string
  assetManifestSha256In: string
  assetManifestSha256Out: string
  jsonDiffs: JsonDiff[]
  assetDiffs: AssetDiff[]
  stats: {
    targets: number
    blocks: number
    assets: number
    bytesIn: number
    bytesOut: number
  }
}

interface RoundTripArtifact
{
  result: RoundTripResult
  outputBytes: Uint8Array
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean
{
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++)
  {
    if (a[i] !== b[i]) return false
  }
  return true
}

function assetManifestSha256(assets: Asset[]): string
{
  const hash = createHash('sha256')
  const ordered = [...assets].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )
  for (const asset of ordered)
  {
    const path = Buffer.from(asset.path, 'utf-8')
    const size = Buffer.allocUnsafe(8)
    size.writeBigUInt64BE(BigInt(asset.bytes.byteLength))
    hash.update(Buffer.from([path.byteLength >> 8, path.byteLength & 0xff]))
    hash.update(path)
    hash.update(size)
    hash.update(asset.bytes)
  }
  return hash.digest('hex')
}

// repackage an admitted archive, then compare project.json & every asset byte-for-byte
export async function roundTripAdmittedSb3(
  bytes: Uint8Array,
  before: Sb3Admission,
  options: UnpackOptions = {}
): Promise<RoundTripArtifact>
{
  const parsed = JSON.parse(before.projectJsonText) as ProjectJson
  const ir = ProjectIR.fromProjectJson(parsed, before.assets)
  const outBytes = await ir.toSb3()
  const after = await admitSb3(outBytes, options)

  const a = canonicalize(parsed as unknown as Json)
  const b = canonicalize(JSON.parse(after.projectJsonText) as Json)
  const jsonDiffs = diffJson(a, b)

  const beforeAssets = new Map(before.assets.map((x) => [x.path, x.bytes]))
  const afterAssets = new Map(after.assets.map((x) => [x.path, x.bytes]))
  const assetDiffs: AssetDiff[] = []
  for (const [path, ba] of beforeAssets)
  {
    const bb = afterAssets.get(path)
    if (!bb) assetDiffs.push({ path, kind: 'missing' })
    else if (!bytesEqual(ba, bb)) assetDiffs.push({ path, kind: 'changed' })
  }
  for (const path of afterAssets.keys())
  {
    if (!beforeAssets.has(path)) assetDiffs.push({ path, kind: 'extra' })
  }

  const json = ir.toProjectJson()
  const blocks = json.targets.reduce(
    (n, t) => n + Object.keys(t.blocks).length,
    0
  )
  const semanticJsonEqual = jsonDiffs.length === 0
  const projectJsonExact =
    before.metrics.projectJsonBytes === after.metrics.projectJsonBytes &&
    before.metrics.projectJsonSha256 === after.metrics.projectJsonSha256
  const assetsExact = assetDiffs.length === 0
  const assetManifestSha256In = assetManifestSha256(before.assets)
  const assetManifestSha256Out = assetManifestSha256(after.assets)
  return {
    outputBytes: outBytes,
    result: {
      lossless: semanticJsonEqual && assetsExact,
      jsonTextIdentical: projectJsonExact,
      semanticJsonEqual,
      projectJsonExact,
      assetsExact,
      contentExact: projectJsonExact && assetsExact,
      projectJsonSha256In: before.metrics.projectJsonSha256,
      projectJsonSha256Out: after.metrics.projectJsonSha256,
      assetManifestSha256In,
      assetManifestSha256Out,
      jsonDiffs,
      assetDiffs,
      stats: {
        targets: json.targets.length,
        blocks,
        assets: before.assets.length,
        bytesIn: bytes.length,
        bytesOut: outBytes.length,
      },
    },
  }
}

// import -> IR -> export, retaining the candidate bytes for evidence consumers
async function roundTripSb3Artifact(
  bytes: Uint8Array,
  options: UnpackOptions = {}
): Promise<RoundTripArtifact>
{
  const before = await admitSb3(bytes, options)
  return roundTripAdmittedSb3(bytes, before, options)
}

// compatibility result-only surface for callers that do not retain the candidate artifact
export async function roundTripSb3(
  bytes: Uint8Array,
  options: UnpackOptions = {}
): Promise<RoundTripResult>
{
  return (await roundTripSb3Artifact(bytes, options)).result
}
