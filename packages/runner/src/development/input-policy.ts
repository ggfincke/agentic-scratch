// packages/runner/src/development/input-policy.ts
// share finite ordinary & release admission across recording & reproduction

export const DEVELOPMENT_INPUT_POLICY_V1 = Object.freeze({
  identity: 'development-input-capacity-v2',
  maxInputEvents: 4096,
  maxReleaseEvents: 256,
  maxAppliedOrdinal: 4352,
  releaseAdmission: 'reserve-one-event-per-held-key-or-mouse-button',
  replay: 'archived-budget-provenance-with-agent-application',
})

export const DEVELOPMENT_CHRONOLOGY_POLICY_V2 =
  'browser-atomic-evidence-v2' as const

export const DEVELOPMENT_INPUT_POLICY_V2 = Object.freeze({
  ...DEVELOPMENT_INPUT_POLICY_V1,
  identity: 'development-canonical-input-v3',
  maxKeyCodeUnits: 64,
  maxHeldKeys: 64,
  maxReleasedKeysPerInputEvent: 2,
  maxReleasedKeysPerCleanupEvent: 1,
  heldIdentity: 'pinned-vm-interpreted-key-and-observed-release-delta',
  chronology: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
})

export function isDevelopmentReleaseSourceV1(source: string): boolean
{
  return source === 'cleanup' || source === 'focus-release'
}

export function countDevelopmentInputEventsV1(
  events: readonly {
    readonly source: string
    readonly data: Readonly<Record<string, string | number | boolean>>
  }[],
  limits: {
    readonly maxInputEvents: number
    readonly maxReleaseEvents: number
  } = DEVELOPMENT_INPUT_POLICY_V1
): { readonly inputEvents: number; readonly releaseEvents: number }
{
  let inputEvents = 0
  let releaseEvents = 0
  for (const event of events)
  {
    if (!['agent', 'human', 'focus-release', 'cleanup'].includes(event.source))
      throw new Error('retained input has unsupported application provenance')
    if (isDevelopmentReleaseSourceV1(event.source))
    {
      if (event.data.isDown !== false)
        throw new Error('retained cleanup input must release a held control')
      releaseEvents++
    }
    else inputEvents++
    if (
      inputEvents > limits.maxInputEvents ||
      releaseEvents > limits.maxReleaseEvents
    )
      throw new Error('retained input exceeds its ordinary or release budget')
  }
  return { inputEvents, releaseEvents }
}
