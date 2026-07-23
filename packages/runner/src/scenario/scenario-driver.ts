// packages/runner/src/scenario/scenario-driver.ts
// lane-agnostic scenario driver: one Step[] timeline drives any engine (vm or browser)

import { SCENARIO_STEP_KINDS, type Scenario, type Step } from '../policy/types.js'
import { RUN_ISSUE_CODES, RunnerIssueError, createRunIssue } from '../policy/issues.js'

export const DEFAULT_MAX_TICKS = 10000
export const DEFAULT_WAIT_CAP = 600

const STEP_KINDS = new Set<string>(SCENARIO_STEP_KINDS)

function validTickCount(value: number): boolean
{
  return Number.isSafeInteger(value) && value >= 0
}

// how many of `requested` ticks may run before hitting maxTicks; shared so both lanes bound the
// timeline identically (browser tick N == vm tick N, incl. how far a step advances before it caps)
export function ticksAllowed(
  tick: number,
  requested: number,
  maxTicks: number
): number
{
  return Math.min(requested, Math.max(0, maxTicks - tick))
}

// the single maxTicks-exceeded error both lanes throw
export function maxTicksError(maxTicks: number): Error
{
  return new RunnerIssueError(
    createRunIssue({
      code: RUN_ISSUE_CODES.tickBudgetExceeded,
      kind: 'tick-budget',
      responsibility: 'project',
      message: `scenario exceeded maxTicks (${maxTicks})`,
      location: { kind: 'project' },
    })
  )
}

// after a broadcastAndWait loop leaves receivers running, pick the SAME error on both lanes:
// budget-exhausted (hit the global maxTicks) vs cap-exhausted (hit the per-broadcast cap)
export function broadcastExhaustion(
  name: string,
  cap: number,
  tick: number,
  maxTicks: number
): Error
{
  if (tick >= maxTicks) return maxTicksError(maxTicks)
  return new RunnerIssueError(
    createRunIssue({
      code: RUN_ISSUE_CODES.broadcastTickBudgetExceeded,
      kind: 'tick-budget',
      responsibility: 'project',
      message: `broadcastAndWait "${name}" exceeded maxTicks (${cap}) with receiver threads still running`,
      location: { kind: 'project' },
    })
  )
}

// the per-lane primitives a Step timeline is lowered onto; browser impls round-trip to the page
export interface ScenarioEngine
{
  beginScenarioStep?(index: number, step: Step): void | Promise<void>
  greenFlag(): Promise<void>
  // advance n frame-exact ticks (_step + fire-due-timers + render where applicable)
  step(n: number): Promise<void>
  pressKey(key: string): Promise<void>
  releaseKey(key: string): Promise<void>
  clickSprite(name: string): Promise<void>
  clickStage(): Promise<void>
  broadcast(name: string): Promise<void>
  broadcastAndWait(name: string, cap: number): Promise<void>
  moveMouse(x: number, y: number): Promise<void>
  mouseDown(x: number, y: number): Promise<void>
  mouseUp(x: number, y: number): Promise<void>
  answer(text: string): Promise<void>
  // capture a labeled snapshot at the current tick (browser engines also screenshot)
  snapshot(label: string): Promise<void>
}

// lower one Step onto the engine; tapKey/typeAnswer/wait compose from the primitives
async function runStep(engine: ScenarioEngine, s: Step): Promise<void>
{
  switch (s.do)
  {
    case 'greenFlag':
      await engine.greenFlag()
      break
    case 'wait':
      if (!validTickCount(s.ticks))
      {
        throw new RunnerIssueError(
          createRunIssue({
            code: RUN_ISSUE_CODES.scenarioInvalidWaitTicks,
            kind: 'scenario',
            responsibility: 'repair-case',
            message: `wait: invalid tick count ${s.ticks}`,
          })
        )
      }
      await engine.step(s.ticks)
      break
    case 'pressKey':
    case 'keyDown':
      await engine.pressKey(s.key)
      break
    case 'releaseKey':
    case 'keyUp':
      await engine.releaseKey(s.key)
      break
    case 'tapKey':
      await engine.pressKey(s.key)
      await engine.step(s.ticks ?? 1)
      await engine.releaseKey(s.key)
      break
    case 'clickSprite':
      await engine.clickSprite(s.sprite)
      break
    case 'clickStage':
      await engine.clickStage()
      break
    case 'broadcast':
      await engine.broadcast(s.name)
      break
    case 'broadcastAndWait':
    {
      const cap = s.maxTicks ?? DEFAULT_WAIT_CAP
      if (!validTickCount(cap))
      {
        throw new RunnerIssueError(
          createRunIssue({
            code: RUN_ISSUE_CODES.scenarioInvalidBroadcastTicks,
            kind: 'scenario',
            responsibility: 'repair-case',
            message: `broadcastAndWait: invalid maxTicks ${cap}`,
          })
        )
      }
      await engine.broadcastAndWait(s.name, cap)
      break
    }
    case 'moveMouse':
      await engine.moveMouse(s.x, s.y)
      break
    case 'mouseDown':
      await engine.mouseDown(s.x, s.y)
      break
    case 'mouseUp':
      await engine.mouseUp(s.x, s.y)
      break
    case 'typeAnswer':
      await engine.answer(s.text)
      await engine.step(1)
      break
    case 'snapshot':
      await engine.snapshot(s.label)
      break
    default:
    {
      // exhaustiveness guard: a malformed step fails loudly instead of no-op passing
      const unknown: never = s
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.scenarioUnknownStep,
          kind: 'scenario',
          responsibility: 'repair-case',
          message: `unknown step: ${JSON.stringify(unknown)}`,
        })
      )
    }
  }
}

export function validateScenario(scenario: Scenario): void
{
  if (scenario.maxTicks !== undefined && !validTickCount(scenario.maxTicks))
  {
    throw new RunnerIssueError(
      createRunIssue({
        code: RUN_ISSUE_CODES.scenarioInvalidMaxTicks,
        kind: 'scenario',
        responsibility: 'repair-case',
        message: `scenario: invalid maxTicks ${scenario.maxTicks}`,
      })
    )
  }

  const labels = new Set<string>()
  for (const step of scenario.steps)
  {
    if (!STEP_KINDS.has(step.do))
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.scenarioUnknownStep,
          kind: 'scenario',
          responsibility: 'repair-case',
          message: `unknown step: ${JSON.stringify(step)}`,
        })
      )
    }
    if (step.do === 'wait' && !validTickCount(step.ticks))
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.scenarioInvalidWaitTicks,
          kind: 'scenario',
          responsibility: 'repair-case',
          message: `wait: invalid tick count ${step.ticks}`,
        })
      )
    }
    if (
      step.do === 'tapKey' &&
      step.ticks !== undefined &&
      !validTickCount(step.ticks)
    )
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.scenarioInvalidTapTicks,
          kind: 'scenario',
          responsibility: 'repair-case',
          message: `tapKey: invalid tick count ${step.ticks}`,
        })
      )
    }
    if (step.do === 'broadcastAndWait')
    {
      const cap = step.maxTicks ?? DEFAULT_WAIT_CAP
      if (!validTickCount(cap))
      {
        throw new RunnerIssueError(
          createRunIssue({
            code: RUN_ISSUE_CODES.scenarioInvalidBroadcastTicks,
            kind: 'scenario',
            responsibility: 'repair-case',
            message: `broadcastAndWait: invalid maxTicks ${cap}`,
          })
        )
      }
    }
    if (step.do !== 'snapshot') continue
    if (labels.has(step.label))
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.scenarioDuplicateSnapshot,
          kind: 'scenario',
          responsibility: 'repair-case',
          message: `duplicate snapshot label: "${step.label}"`,
        })
      )
    }
    labels.add(step.label)
  }
}

// walk the timeline in order; any engine failure propagates to the lane's error handler
export async function driveScenario(
  engine: ScenarioEngine,
  scenario: Scenario
): Promise<void>
{
  validateScenario(scenario)
  for (let index = 0; index < scenario.steps.length; index++)
  {
    const step = scenario.steps[index]!
    await engine.beginScenarioStep?.(index, step)
    await runStep(engine, step)
  }
}
