// packages/sb3/src/admission/validate.ts
// validate a .sb3 w/ scratch-parser@6 (CJS, no types), relabelling flac sounds for turbowarp-only checks

import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'

import {
  admitSb3,
  isSb3AdmissionError,
  type Sb3AdmissionIssue,
} from './admission.js'
import type { Sb3LimitOptions } from './limits.js'

const requireCjs = createRequire(import.meta.url)

interface ValidatedProject
{
  projectVersion?: number
}

// scratch-parser@6: module.exports = (input, isSprite, callback)
type ParserCallback = (
  err: unknown,
  result?: [ValidatedProject, unknown]
) => void
type ScratchParser = (
  input: Buffer | string,
  isSprite: boolean,
  cb: ParserCallback
) => void

export interface ValidateResult
{
  ok: boolean
  projectVersion: number
  errors: string[]
  admissionIssue?: Sb3AdmissionIssue
}

const parser = requireCjs('scratch-parser') as ScratchParser

function errToString(err: unknown): string
{
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try
  {
    return JSON.stringify(err)
  }
  catch
  {
    return String(err)
  }
}

// run scratch-parser on an archive or a project.json string
function parseProject(input: Buffer | string): Promise<ValidateResult>
{
  return new Promise((resolve) =>
  {
    parser(input, false, (err, result) =>
    {
      if (err)
      {
        resolve({ ok: false, projectVersion: 0, errors: [errToString(err)] })
        return
      }
      const version = result?.[0]?.projectVersion ?? 0
      resolve({
        ok: version === 3,
        projectVersion: version,
        errors: version === 3 ? [] : ['unexpected projectVersion'],
      })
    })
  })
}

// run scratch-parser after a caller has already admitted these exact bytes
export function validateAdmittedSb3(sb3: Uint8Array): Promise<ValidateResult>
{
  return parseProject(Buffer.isBuffer(sb3) ? sb3 : Buffer.from(sb3))
}

// for turbowarp-only checks: validate the admitted project.json w/ each flac
// sound relabelled mp3, as @turbowarp/sb3fix does before turbowarp.org loads
// it, so every other field still meets the vanilla schema
export function validateAdmittedTurboWarpSb3(
  sb3: Uint8Array,
  projectJsonText: string
): Promise<ValidateResult>
{
  let project: unknown
  try
  {
    project = JSON.parse(projectJsonText)
  }
  catch (error)
  {
    return Promise.resolve({
      ok: false,
      projectVersion: 0,
      errors: [errToString(error)],
    })
  }
  let relabelled = false
  const targets = (project as { targets?: unknown } | null)?.targets
  for (const target of Array.isArray(targets) ? targets : [])
  {
    for (const sound of Array.isArray(target?.sounds) ? target.sounds : [])
    {
      if (sound?.dataFormat !== 'flac') continue
      sound.dataFormat = 'mp3'
      relabelled = true
    }
  }
  // w/o a flac sound the archive bytes validate exactly as validateAdmittedSb3
  return relabelled
    ? parseProject(JSON.stringify(project))
    : validateAdmittedSb3(sb3)
}

// public validation authority: shared admission first, then Scratch 3 schema parsing
export async function validateSb3(
  sb3: Uint8Array,
  opts: { limits?: Sb3LimitOptions } = {}
): Promise<ValidateResult>
{
  try
  {
    await admitSb3(sb3, opts)
  }
  catch (error)
  {
    if (isSb3AdmissionError(error))
    {
      return {
        ok: false,
        projectVersion: 0,
        errors: [error.issue.message],
        admissionIssue: error.issue,
      }
    }
    throw error
  }
  return validateAdmittedSb3(sb3)
}
