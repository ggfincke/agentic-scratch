// packages/sb3/src/io/unpack.ts
// unzip a .sb3 through the shared admission contract

import { admitSb3, type Asset } from '../admission/admission.js'
import type { Sb3LimitOptions } from '../admission/limits.js'

export type { Asset } from '../admission/admission.js'

interface UnpackedSb3
{
  projectJsonText: string
  assets: Asset[]
}

export interface UnpackOptions
{
  limits?: Sb3LimitOptions
}

export async function unpackSb3(
  bytes: Uint8Array,
  options: UnpackOptions = {}
): Promise<UnpackedSb3>
{
  const { projectJsonText, assets } = await admitSb3(bytes, options)
  return { projectJsonText, assets }
}
