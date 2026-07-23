// packages/runner/src/vm/vm-lane.ts
// headless Node VM lane: load a .sb3 in @scratch/scratch-vm, fire green flag, read state

import type { RunScenario, StateSnapshot, Step, VmLaneResult } from '../policy/types.js'
import { runIssueMessages } from '../policy/issues.js'
import { toStateSnapshot } from '../observation/snapshot.js'
import { runScenario } from '../scenario/run-scenario.js'

// lower the legacy RunScenario (greenFlag + snapshot ticks) into a Step[] timeline
export function snapshotSteps(scenario: RunScenario): Step[]
{
  const wanted = [...new Set(scenario.snapshots)]
    .filter((tick) => tick >= 0 && tick <= scenario.ticks)
    .sort((a, b) => a - b)
  const wantsInitial = wanted.includes(0)
  const sampleTicks = wanted
    .filter((tick) => tick > 0)
    .concat(!wanted.includes(scenario.ticks) ? [scenario.ticks] : [])
    .filter((tick, i, ticks) => tick >= 0 && ticks.indexOf(tick) === i)
    .sort((a, b) => a - b)
  const steps: Step[] = []
  let currentTick = 0

  if (wantsInitial)
  {
    steps.push({ do: 'snapshot', label: 'tick-0' })
  }
  if (scenario.greenFlag) steps.push({ do: 'greenFlag' })

  if (sampleTicks.includes(0))
  {
    steps.push({ do: 'snapshot', label: 'tick-0' })
  }

  for (const tick of sampleTicks.filter((tick) => tick > 0))
  {
    steps.push({ do: 'wait', ticks: tick - currentTick })
    steps.push({ do: 'snapshot', label: `tick-${tick}` })
    currentTick = tick
  }

  return steps
}

export async function runVm(
  sb3: Uint8Array,
  scenario: RunScenario
): Promise<VmLaneResult>
{
  const trace = await runScenario(sb3, {
    ...(scenario.allowNetwork === undefined
      ? {}
      : { allowNetwork: scenario.allowNetwork }),
    ...(scenario.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: scenario.allowedOrigins }),
    steps: snapshotSteps(scenario),
  })
  const snapshots: StateSnapshot[] = trace.snapshots.map(toStateSnapshot)
  const issues = trace.issues
  return {
    ok: issues.length === 0,
    runtime: trace.runtime,
    snapshots,
    errors: runIssueMessages(issues),
    issues,
  }
}
