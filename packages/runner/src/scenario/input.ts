// packages/runner/src/scenario/input.ts
// faithful headless input: keyboard via postIOData; sprite/stage clicks & broadcasts via startHats

import type { ScratchVm } from '../vm/vm-api.js'
import {
  RUN_ISSUE_CODES,
  RunnerIssueError,
  createRunIssue,
} from '../policy/issues.js'
import { STAGE_HEIGHT, STAGE_WIDTH } from './stage.js'

// mouse.postData derives coords from stage canvas px centered at (0,0)

// map friendly scenario key names to the DOM-event `key` string the VM normalizes
const KEY_ALIASES: Record<string, string> = {
  right: 'ArrowRight',
  arrowright: 'ArrowRight',
  'right arrow': 'ArrowRight',
  left: 'ArrowLeft',
  arrowleft: 'ArrowLeft',
  'left arrow': 'ArrowLeft',
  up: 'ArrowUp',
  arrowup: 'ArrowUp',
  'up arrow': 'ArrowUp',
  down: 'ArrowDown',
  arrowdown: 'ArrowDown',
  'down arrow': 'ArrowDown',
  space: ' ',
  ' ': ' ',
  enter: 'Enter',
}

export function normalizeInputKey(key: string): string
{
  return KEY_ALIASES[key.toLowerCase()] ?? key
}

export function canonicalInputKey(key: string): string | null
{
  const normalized = normalizeInputKey(key)
  if (
    normalized === 'ArrowRight' ||
    normalized === 'ArrowLeft' ||
    normalized === 'ArrowUp' ||
    normalized === 'ArrowDown' ||
    normalized === ' ' ||
    normalized === 'Enter'
  )
    return normalized
  if (normalized.length !== 1) return null
  const canonical = normalized.toUpperCase()
  return canonical.length === 1 ? canonical : null
}

export class InputController
{
  constructor(private readonly vm: ScratchVm)
  {}

  // whenkeypressed fires synchronously inside postData; the body advances on later _step()
  pressKey(key: string): void
  {
    this.vm.postIOData('keyboard', {
      key: normalizeInputKey(key),
      isDown: true,
    })
  }

  releaseKey(key: string): void
  {
    this.vm.postIOData('keyboard', {
      key: normalizeInputKey(key),
      isDown: false,
    })
  }

  moveMouse(scratchX: number, scratchY: number): void
  {
    this.postMouse(scratchX, scratchY, undefined)
  }

  mouseDown(scratchX: number, scratchY: number): void
  {
    this.postMouse(scratchX, scratchY, true)
  }

  mouseUp(scratchX: number, scratchY: number): void
  {
    this.postMouse(scratchX, scratchY, false)
  }

  // no renderer headless -> a positional click resolves to the Stage; fire the hat directly
  clickSprite(name: string): void
  {
    const target = this.vm.runtime.getSpriteTargetByName(name)
    if (!target)
    {
      throw new RunnerIssueError(
        createRunIssue({
          code: RUN_ISSUE_CODES.scenarioMissingTarget,
          kind: 'scenario',
          responsibility: 'repair-case',
          message: `clickSprite: no sprite named "${name}"`,
          location: { kind: 'unresolved-target', name },
        })
      )
    }
    this.vm.runtime.startHats('event_whenthisspriteclicked', null, target)
  }

  clickStage(): void
  {
    const stage = this.vm.runtime.getTargetForStage()
    this.vm.runtime.startHats('event_whenstageclicked', null, stage)
  }

  // fire receivers by message name (case-insensitive); bodies advance on later _step()
  broadcast(name: string): void
  {
    this.vm.runtime.startHats('event_whenbroadcastreceived', {
      BROADCAST_OPTION: name,
    })
  }

  // resolve the first queued question (from a sensing ask block)
  answer(text: string): void
  {
    this.vm.runtime.emit('ANSWER', text)
  }

  private postMouse(
    scratchX: number,
    scratchY: number,
    isDown: boolean | undefined
  ): void
  {
    const x = STAGE_WIDTH * (scratchX / STAGE_WIDTH + 0.5)
    const y = STAGE_HEIGHT * (0.5 - scratchY / STAGE_HEIGHT)
    const data: Record<string, unknown> = {
      x,
      y,
      canvasWidth: STAGE_WIDTH,
      canvasHeight: STAGE_HEIGHT,
    }
    if (isDown !== undefined) data.isDown = isDown
    this.vm.postIOData('mouse', data)
  }
}
