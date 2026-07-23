// packages/runner/src/observation/runtime-observation.ts
// opt-in tagged runtime projections that never retain raw VM numeric or invalid scalar values

import {
  isRuntimeObservationNonScalarError,
  isRuntimeObservationOverflowError,
  refuseRuntimeObservationValueV1,
} from './observation.js'

import type {
  ObservedRuntimeScalarV1,
  RuntimeObservationBudgetTotalsV1,
  RuntimeObservationBudgetV1,
  RuntimeObservationNonScalarV1,
  RuntimeObservationOverflowV1,
} from './observation.js'

export type ObservedRuntimeValueV1 =
  | null
  | ObservedRuntimeScalarV1
  | readonly ObservedRuntimeValueV1[]
  | ObservedRuntimeRecordV1

interface ObservedRuntimeRecordV1
{
  readonly [key: string]: ObservedRuntimeValueV1
}

type RuntimeObservationCaptureIssueV1 =
  RuntimeObservationNonScalarV1 | RuntimeObservationOverflowV1

export type RuntimeObservationCaptureV1<T> =
  | {
      readonly status: 'observed'
      readonly value: T
      readonly totals: RuntimeObservationBudgetTotalsV1
    }
  | {
      readonly status: 'refused'
      readonly value: null
      readonly issue: RuntimeObservationCaptureIssueV1
      readonly totals: RuntimeObservationBudgetTotalsV1
    }

export interface RuntimeObservationRecordV1<T>
{
  readonly tick: number
  readonly scenarioStepIndex: number
  readonly label: string | null
  readonly capture: RuntimeObservationCaptureV1<T>
}

function plainRecord(value: unknown): value is Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  try
  {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  }
  catch
  {
    return false
  }
}

// recursively tags every scalar leaf while preserving only arrays, null, &
// plain data records; accessors & exotic prototypes never enter evidence
export function projectRuntimeObservationValueV1(
  value: unknown,
  budget: RuntimeObservationBudgetV1,
  scope: string,
  ancestors: ReadonlySet<object> = new Set<object>()
): ObservedRuntimeValueV1
{
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
    return budget.chargeScalar(scope, value)
  if (value === null) return null
  if (Array.isArray(value))
  {
    if (ancestors.has(value))
      return refuseRuntimeObservationValueV1(scope, 'plain-record', value)
    budget.chargeContainerItems(scope, value.length)
    budget.chargeRecords(scope, 1)
    const nested = new Set(ancestors)
    nested.add(value)
    return Object.freeze(
      value.map((entry, index) =>
        projectRuntimeObservationValueV1(
          entry,
          budget,
          `${scope}/${index}`,
          nested
        )
      )
    )
  }
  if (!plainRecord(value))
    return refuseRuntimeObservationValueV1(scope, 'plain-record', value)
  if (ancestors.has(value))
    return refuseRuntimeObservationValueV1(scope, 'plain-record', value)
  let keys: string[]
  let descriptors: PropertyDescriptorMap
  try
  {
    keys = Object.keys(value).sort()
    descriptors = Object.getOwnPropertyDescriptors(value)
  }
  catch
  {
    return refuseRuntimeObservationValueV1(scope, 'plain-record', value)
  }
  budget.chargeContainerItems(scope, keys.length)
  budget.chargeRecords(scope, 1)
  const projected = Object.create(null) as Record<
    string,
    ObservedRuntimeValueV1
  >
  const nested = new Set(ancestors)
  nested.add(value)
  for (const key of keys)
  {
    const descriptor = descriptors[key]
    if (descriptor === undefined || !('value' in descriptor))
      return refuseRuntimeObservationValueV1(
        `${scope}/${key}`,
        'data-property',
        descriptor?.get ?? descriptor?.set
      )
    projected[key] = projectRuntimeObservationValueV1(
      descriptor.value,
      budget,
      `${scope}/${key}`,
      nested
    )
  }
  return Object.freeze(projected)
}

// a scalar list is stricter than a generic array: one object-valued extension
// item aborts the cell instead of being accepted as a nested observation record
export function projectRuntimeObservationScalarListV1(
  value: unknown,
  budget: RuntimeObservationBudgetV1,
  scope: string
): readonly ObservedRuntimeScalarV1[]
{
  if (!Array.isArray(value))
    return refuseRuntimeObservationValueV1(scope, 'scalar-list', value)
  budget.chargeListItems(scope, value.length)
  return Object.freeze(
    value.map((entry, index) =>
      budget.chargeScalarBytes(`${scope}/${index}`, entry)
    )
  )
}

// refusal returns identity-only issue metadata & a null value; no prefix of a
// failed projection can survive into comparison, hashing, or later retries
export function captureRuntimeObservationV1<T>(
  budget: RuntimeObservationBudgetV1,
  read: () => T
): RuntimeObservationCaptureV1<T>
{
  try
  {
    return Object.freeze({
      status: 'observed' as const,
      value: read(),
      totals: budget.totals(),
    })
  }
  catch (error)
  {
    if (isRuntimeObservationNonScalarError(error))
      return Object.freeze({
        status: 'refused' as const,
        value: null,
        issue: error.issue,
        totals: budget.totals(),
      })
    if (isRuntimeObservationOverflowError(error))
      return Object.freeze({
        status: 'refused' as const,
        value: null,
        issue: error.overflow,
        totals: budget.totals(),
      })
    throw error
  }
}
