// packages/sb3/src/io/pack.ts
// zip project.json + assets into a deterministic .sb3 (stable order, fixed dates)

import JSZip from 'jszip'

import type { Asset } from './unpack.js'
import { normalizeAssetsByPath } from '../media/assets.js'

// fixed epoch so identical inputs produce byte-identical archives
const FIXED_DATE = new Date(0)

export async function packSb3(
  projectJsonText: string,
  assets: Asset[]
): Promise<Uint8Array>
{
  const zip = new JSZip()
  zip.file('project.json', projectJsonText, { date: FIXED_DATE })

  // shared payload references dedupe only when their exact bytes agree
  for (const asset of normalizeAssetsByPath(assets))
  {
    zip.file(asset.path, asset.bytes, { date: FIXED_DATE })
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}
