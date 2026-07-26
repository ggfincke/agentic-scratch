// packages/eval/src/fragility-check/fragility-check-input.ts
// read one selected sb3 through a bounded immutable file descriptor

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs'

import { DEFAULT_SB3_LIMITS } from '@scratch-agent/sb3'

export const MAX_FRAGILITY_INPUT_BYTES = DEFAULT_SB3_LIMITS.maxCompressedBytes

export type FragilityInputReadFailure =
  'unavailable' | 'not-regular' | 'too-large' | 'changed'

export class FragilityCheckInputError extends Error
{
  readonly failure: FragilityInputReadFailure

  constructor(failure: FragilityInputReadFailure, message: string)
  {
    super(message)
    this.name = 'FragilityCheckInputError'
    this.failure = failure
  }
}

function inputError(
  failure: FragilityInputReadFailure,
  message: string
): FragilityCheckInputError
{
  return new FragilityCheckInputError(failure, message)
}

export function readFragilityCheckInput(
  path: string,
  maximumBytes = MAX_FRAGILITY_INPUT_BYTES
): Uint8Array
{
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw inputError('unavailable', 'selected input byte limit is invalid')

  let descriptor: number
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  }
  catch (error)
  {
    const failure =
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ELOOP' || error.code === 'EISDIR')
        ? 'not-regular'
        : 'unavailable'
    throw inputError(
      failure,
      'selected input could not be opened as one bounded regular file'
    )
  }

  try
  {
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile())
      throw inputError('not-regular', 'selected input must be one regular file')
    if (before.size > BigInt(maximumBytes))
      throw inputError(
        'too-large',
        `selected input exceeds ${maximumBytes} bytes`
      )

    const bytes = Buffer.alloc(Number(before.size))
    let offset = 0
    while (offset < bytes.byteLength)
    {
      const count = readSync(
        descriptor,
        bytes,
        offset,
        bytes.byteLength - offset,
        null
      )
      if (count === 0) break
      offset += count
    }
    if (offset !== bytes.byteLength)
      throw inputError('changed', 'selected input changed while it was read')

    const after = fstatSync(descriptor, { bigint: true })
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw inputError('changed', 'selected input changed while it was read')
    return bytes
  }
  catch (error)
  {
    if (error instanceof FragilityCheckInputError) throw error
    throw inputError(
      'unavailable',
      'selected input could not be read as one bounded file'
    )
  }
  finally
  {
    closeSync(descriptor)
  }
}
