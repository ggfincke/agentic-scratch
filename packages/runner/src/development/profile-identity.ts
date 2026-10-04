// packages/runner/src/development/profile-identity.ts
// bind separate debug bundles & clock policy without changing legacy descriptors

import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import { hashRuntimeConfiguration } from '../observation/observation-host.js'
import {
  DEVELOPMENT_INPUT_POLICY_V1,
  DEVELOPMENT_INPUT_POLICY_V2,
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
} from './input-policy.js'
import {
  PROJECT_DEBUG_RUNTIME_PROTOCOL_V1,
  PROJECT_DEBUG_RUNTIME_PROTOCOL_V2,
  type RuntimeExecutionProfileV1,
} from './execution-profile.js'

export function bindProfileRuntimeDescriptorV1(
  base: RuntimeDescriptorV1,
  profile: RuntimeExecutionProfileV1,
  inputMode: 'agent' | 'human' = 'agent'
): RuntimeDescriptorV1
{
  return bindProfileRuntimeDescriptor(base, profile, inputMode, 1)
}

export function bindProfileRuntimeDescriptorV2(
  base: RuntimeDescriptorV1,
  profile: RuntimeExecutionProfileV1,
  inputMode: 'agent' | 'human' = 'agent'
): RuntimeDescriptorV1
{
  return bindProfileRuntimeDescriptor(base, profile, inputMode, 2)
}

function bindProfileRuntimeDescriptor(
  base: RuntimeDescriptorV1,
  profile: RuntimeExecutionProfileV1,
  inputMode: 'agent' | 'human',
  version: 1 | 2
): RuntimeDescriptorV1
{
  const protocol =
    version === 1
      ? PROJECT_DEBUG_RUNTIME_PROTOCOL_V1
      : PROJECT_DEBUG_RUNTIME_PROTOCOL_V2
  const configuration = {
    protocol,
    runtimeConfigurationSha256: base.configurationSha256,
    profile,
    clock: {
      drive: profile.scheduler === 'deterministic' ? 'manual' : 'native',
      tickMs: 1000 / profile.tickRate,
      deterministicTimers: profile.scheduler === 'deterministic',
    },
    compatibilityMode: profile.tickRate === 30,
    inputMode,
    physicalInput: inputMode === 'human',
    inputPolicy:
      version === 1 ? DEVELOPMENT_INPUT_POLICY_V1 : DEVELOPMENT_INPUT_POLICY_V2,
    processSignals: 'development-owner-bounded-cleanup-v1',
    devices: 'disabled-until-explicit-human-browser-permission',
    observation: 'bounded-post-step-renderer-free-v1',
    checkpointReservation:
      version === 1
        ? 'exact-owned-record-byte-totals-v2'
        : 'persistent-terminal-artifact-reservation-v3',
    ...(version === 2 ? { chronology: DEVELOPMENT_CHRONOLOGY_POLICY_V2 } : {}),
    visualCapture: 'native-suspended-without-input-release',
    editorDragging: false,
    cloneAssociation: 'game-owned-local-key-unique-only-v1',
    diagnostics:
      'bounded-sound-invocations-internal-output-native-performance-v1',
    denseVisual: {
      defaultFrames: 120,
      defaultBytes: 25 * 1024 * 1024,
      maximumFrames: 240,
      maximumBytes: 50 * 1024 * 1024,
    },
  }
  const configurationSha256 = hashRuntimeConfiguration(configuration)
  return {
    ...base,
    id: `${protocol}:${profile.runtime}:${profile.scheduler}:${profile.tickRate}:${configurationSha256.slice(0, 12)}`,
    configurationSha256,
    bundle:
      base.bundle === null
        ? null
        : {
            ...base.bundle,
            path:
              profile.runtime === 'turbowarp'
                ? 'browser/debug-page.js'
                : 'browser/official-debug-page.js',
          },
    ...{
      executionProfile: profile,
      profileProtocol: protocol,
      clock: configuration.clock,
    },
  }
}
