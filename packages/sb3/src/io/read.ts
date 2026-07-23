// packages/sb3/src/io/read.ts
// read metadata from an existing .sb3 (project.json size + bundled asset count)

import { Buffer } from 'node:buffer'

import {
  admitSb3,
  type AdmitOptions,
  type Sb3AdmissionMetrics,
} from '../admission/admission.js'
import type { Sb3Limits } from '../admission/limits.js'

interface Sb3Meta
{
  projectJsonText: string
  projectJsonBytes: number
  assetCount: number
  metrics: Sb3AdmissionMetrics
  limits: Sb3Limits
}

export async function readSb3(
  bytes: Uint8Array,
  options: AdmitOptions = {}
): Promise<Sb3Meta>
{
  const { projectJsonText, assets, metrics, limits } = await admitSb3(
    bytes,
    options
  )
  return {
    projectJsonText,
    projectJsonBytes: Buffer.byteLength(projectJsonText),
    assetCount: assets.length,
    metrics,
    limits,
  }
}
