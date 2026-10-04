// packages/runner/src/browser/debug-physical-input.ts
// send official browser keyboard & stage mouse transitions through the captured VM boundary

import type { ScratchVm } from '../vm/vm-api.js'

export function installDebugPhysicalInputV1(
  vm: ScratchVm,
  canvas: HTMLCanvasElement
): void
{
  function keyboard(event: KeyboardEvent, isDown: boolean): void
  {
    if (
      isDown &&
      event.target !== document.body &&
      event.target !== document &&
      event.target !== canvas
    )
      return
    if (
      !window.__projectDebug ||
      window.__projectDebug.status().status === 'closed'
    )
      return
    vm.postIOData('keyboard', {
      key: event.key,
      keyCode: event.keyCode,
      isDown,
    })
    if (event.cancelable) event.preventDefault()
  }
  document.addEventListener('keydown', (event) => keyboard(event, true))
  document.addEventListener('keyup', (event) => keyboard(event, false))
  function mouse(event: MouseEvent, isDown?: boolean): void
  {
    if (
      !window.__projectDebug ||
      window.__projectDebug.status().status === 'closed'
    )
      return
    if (isDown !== undefined && event.button !== 0) return
    const rect = canvas.getBoundingClientRect()
    const data: Record<string, number | boolean> = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      canvasWidth: rect.width,
      canvasHeight: rect.height,
    }
    if (isDown !== undefined)
    {
      data.isDown = isDown
      data.button = 0
    }
    vm.postIOData('mouse', data)
  }
  canvas.addEventListener('mousemove', (event) => mouse(event))
  canvas.addEventListener('mousedown', (event) => mouse(event, true))
  document.addEventListener('mouseup', (event) => mouse(event, false))
}
