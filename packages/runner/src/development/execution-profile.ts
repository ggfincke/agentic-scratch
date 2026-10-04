// packages/runner/src/development/execution-profile.ts
// validate independent runtime, scheduler & clock selections for project debugging

export const PROJECT_DEBUG_RUNTIME_PROTOCOL_V1 = 'project-debug-v1' as const
export const PROJECT_DEBUG_RUNTIME_PROTOCOL_V2 = 'project-debug-v2' as const

export interface RuntimeExecutionProfileV1
{
  readonly schemaVersion: 1
  readonly runtime: 'scratch-official' | 'turbowarp'
  readonly scheduler: 'deterministic' | 'natural'
  readonly tickRate: 30 | 60
}

export const RUNTIME_EXECUTION_PRESETS_V1 = Object.freeze({
  'scratch-30': Object.freeze({
    schemaVersion: 1,
    runtime: 'scratch-official',
    scheduler: 'deterministic',
    tickRate: 30,
  } as const),
  'scratch-60': Object.freeze({
    schemaVersion: 1,
    runtime: 'scratch-official',
    scheduler: 'deterministic',
    tickRate: 60,
  } as const),
  'turbowarp-30': Object.freeze({
    schemaVersion: 1,
    runtime: 'turbowarp',
    scheduler: 'deterministic',
    tickRate: 30,
  } as const),
  'turbowarp-60': Object.freeze({
    schemaVersion: 1,
    runtime: 'turbowarp',
    scheduler: 'deterministic',
    tickRate: 60,
  } as const),
})

export type RuntimeExecutionPresetV1 = keyof typeof RUNTIME_EXECUTION_PRESETS_V1

export function validateRuntimeExecutionProfileV1(
  value: unknown
): RuntimeExecutionProfileV1
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('execution profile must be an object')
  const v = value as Record<string, unknown>
  if (
    Object.keys(v).some(
      (key) =>
        !['schemaVersion', 'runtime', 'scheduler', 'tickRate'].includes(key)
    ) ||
    v.schemaVersion !== 1 ||
    !['scratch-official', 'turbowarp'].includes(String(v.runtime)) ||
    !['deterministic', 'natural'].includes(String(v.scheduler)) ||
    (v.tickRate !== 30 && v.tickRate !== 60)
  )
    throw new Error(
      'execution profile requires schemaVersion 1, a supported runtime/scheduler and 30 or 60 ticks per second'
    )
  return Object.freeze({
    schemaVersion: 1,
    runtime: v.runtime,
    scheduler: v.scheduler,
    tickRate: v.tickRate,
  } as RuntimeExecutionProfileV1)
}

export function resolveRuntimeExecutionProfileV1(
  value?: RuntimeExecutionProfileV1 | RuntimeExecutionPresetV1
): RuntimeExecutionProfileV1
{
  if (value === undefined) return RUNTIME_EXECUTION_PRESETS_V1['turbowarp-60']
  if (typeof value === 'string')
  {
    if (!Object.hasOwn(RUNTIME_EXECUTION_PRESETS_V1, value))
      throw new Error('unknown execution profile preset')
    return RUNTIME_EXECUTION_PRESETS_V1[value]
  }
  return validateRuntimeExecutionProfileV1(value)
}
