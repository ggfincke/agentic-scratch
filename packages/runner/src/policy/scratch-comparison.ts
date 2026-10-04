// packages/runner/src/policy/scratch-comparison.ts
// share the pinned Scratch cast comparison across behavioral oracles

export const SCRATCH_COMPARISON_POLICY_V1 = Object.freeze({
  schemaVersion: 1,
  id: 'scratch-cast-comparison-v1',
  runtimePackage: '@scratch/scratch-vm',
  runtimeVersion: '15.1.0',
  runtimeSource: 'src/util/cast.js',
  runtimeSourceSha256:
    'a62f91e1da7c0dd653780b5af073ace608e0cf36f7113e741a8718569cd04c77',
  blank: 'null-or-trim-empty-string',
  blankGuard: 'left-zero-first-else-right-zero',
  nonNumeric: 'lowercase-string-lexicographic',
  sameSignedInfinity: 'equal',
  numeric: 'left-minus-right',
})

export function scratchComparisonPolicySha256V1(): string
{
  return '70834fd7d285315a8d251d737fad265757aa8dd8a381d82f6d8ce343e92cf013'
}

function isBlank(value: unknown): boolean
{
  return (
    value === null || (typeof value === 'string' && value.trim().length === 0)
  )
}

export function compareScratchValuesV1(left: unknown, right: unknown): number
{
  let leftNumber = Number(left)
  let rightNumber = Number(right)
  if (leftNumber === 0 && isBlank(left)) leftNumber = NaN
  else if (rightNumber === 0 && isBlank(right)) rightNumber = NaN
  if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber))
  {
    const leftString = String(left).toLowerCase()
    const rightString = String(right).toLowerCase()
    return leftString < rightString ? -1 : leftString > rightString ? 1 : 0
  }
  if (
    (leftNumber === Infinity && rightNumber === Infinity) ||
    (leftNumber === -Infinity && rightNumber === -Infinity)
  )
    return 0
  return leftNumber - rightNumber
}
