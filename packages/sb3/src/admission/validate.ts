// packages/sb3/src/admission/validate.ts
// validate a .sb3 buffer w/ scratch-parser@6 (CJS, no types)

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
  input: Buffer,
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

// run scratch-parser after a caller has already admitted these exact bytes
export function validateAdmittedSb3(sb3: Uint8Array): Promise<ValidateResult>
{
  const input = Buffer.isBuffer(sb3) ? sb3 : Buffer.from(sb3)
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
