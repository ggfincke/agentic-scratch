// packages/runner/src/development/viewer-entry.ts
// browse immutable ticks, selected state, declared overlays & animation evidence

import { resolveProfileNumericProbeV1 } from './selected-state.js'
import type { ProfileRuntimeFrameV1 } from './profile-browser-types.js'
import type {
  DevelopmentFrameRecordV1,
  DevelopmentFrameRecordV2,
  DevelopmentInputRecordV1,
} from './types.js'
import type {
  DevelopmentOverlayValueV1,
  DevelopmentViewerLaneV1,
  DevelopmentViewerMediaV1,
  DevelopmentViewerModelV1,
} from './viewer-types.js'

const data = JSON.parse(
  document.getElementById('viewer-data')!.textContent!
) as DevelopmentViewerModelV1
const app = document.getElementById('app')!
let selectedSegment = data.primary.trace.segments[0]?.segmentId ?? ''
let frameIndex = 0
let clipIndex = 0
let clipFrame = 0
let clipTimer: ReturnType<typeof setTimeout> | null = null
let clipStarted = 0
let imageQueue: Promise<void> = Promise.resolve()
let generation = 0
let clipGeneration = 0

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string
): HTMLElementTagNameMap[K]
{
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
function button(
  id: string,
  label: string,
  handler: () => void
): HTMLButtonElement
{
  const node = element('button', label)
  node.id = id
  node.type = 'button'
  node.addEventListener('click', handler)
  return node
}
function label(text: string, control: HTMLElement): HTMLLabelElement
{
  const node = element('label', text)
  node.append(control)
  return node
}
function checkbox(id: string, text: string): HTMLInputElement
{
  const node = element('input')
  node.type = 'checkbox'
  node.id = id
  node.checked = true
  controls.append(label(text, node))
  node.addEventListener('change', render)
  return node
}
function table(
  headers: string[],
  rows: readonly (readonly unknown[])[]
): HTMLTableElement
{
  const node = element('table'),
    head = element('thead'),
    row = element('tr')
  for (const title of headers) row.append(element('th', title))
  head.append(row)
  node.append(head)
  const body = element('tbody')
  for (const values of rows)
  {
    const row = element('tr')
    for (const value of values)
      row.append(
        element('td', typeof value === 'string' ? value : JSON.stringify(value))
      )
    body.append(row)
  }
  node.append(body)
  return node
}
function disclosure(title: string, value: unknown, parent: HTMLElement): void
{
  const details = element('details'),
    summary = element('summary', title),
    body = element('pre', JSON.stringify(value, null, 2), 'scroll')
  details.append(summary, body)
  parent.append(details)
}

const header = element('header'),
  heading = element('div'),
  identity = element(
    'p',
    `${data.primary.status.profile.runtime} · ${data.primary.status.profile.scheduler} · ${data.primary.status.profile.tickRate} Hz`,
    'muted'
  )
heading.append(element('h1', data.title), identity)
const source = element(
  'div',
  `Source ${data.primary.status.sourceSha256}`,
  'identity'
)
header.append(heading, source)
app.append(header)
app.append(
  element(
    'p',
    data.primary.trace.schemaVersion === 2
      ? `History is read-only. Each saved observation retains its exact browser input prefix.${data.primary.trace.captureComplete ? '' : ' Capture is incomplete; exact reproduction is unavailable.'}`
      : 'Legacy history is shown as recorded. Input/frame chronology was not guaranteed; new exact reproduction is unavailable.',
    'note'
  )
)
const controls = element('div', undefined, 'controls'),
  segmentSelect = element('select')
segmentSelect.id = 'segment-select'
for (const segment of data.primary.trace.segments)
{
  const option = element(
    'option',
    `Segment ${segment.ordinal + 1} · ${segment.finalTick} ticks`
  )
  option.value = segment.segmentId
  segmentSelect.append(option)
}
segmentSelect.addEventListener('change', () =>
{
  selectedSegment = segmentSelect.value
  frameIndex = 0
  render()
})
controls.append(label('Source segment', segmentSelect))
const previous = button('previous-frame', 'Previous', () =>
{
    frameIndex--
    render()
  }),
  next = button('next-frame', 'Next', () =>
  {
    frameIndex++
    render()
  }),
  range = element('input'),
  position = element('output')
range.type = 'range'
range.id = 'history-range'
range.min = '0'
range.value = '0'
range.setAttribute('aria-label', 'Retained observation')
range.addEventListener('input', () =>
{
  frameIndex = Number(range.value)
  render()
})
controls.append(previous, range, next, position)
app.append(controls)
const showOverlays = checkbox('show-overlays', 'Declared overlays'),
  showBounds = checkbox('show-bounds', 'Costume bounds')
const legend = element('div', undefined, 'legend')
legend.append(
  element('span', 'Selected state'),
  element('span', 'Declared collision'),
  element('span', 'Costume image extent')
)
app.append(legend)
const marks = element('div', undefined, 'marks')
for (const mark of data.primary.trace.marks)
{
  marks.append(
    button(`mark-${mark.markId}`, `${mark.label} · tick ${mark.tick}`, () =>
    {
      selectedSegment = mark.segmentId
      segmentSelect.value = selectedSegment
      const values = currentFrames()
      frameIndex = values.findIndex((frame) => frame.order === mark.frame.order)
      render()
    })
  )
}
if (marks.childElementCount)
{
  const row = element('div', undefined, 'controls')
  row.append(element('span', 'Marks'), marks)
  app.append(row)
}

function stage(name: string): {
  root: HTMLElement
  canvas: HTMLCanvasElement
  svg: SVGSVGElement
  caption: HTMLElement
  issues: HTMLElement
}
{
  const root = element('section'),
    surface = element('div', undefined, 'stage'),
    canvas = element('canvas'),
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'),
    caption = element('p', undefined, 'caption'),
    issues = element('p', undefined, 'warning')
  canvas.width = 480
  canvas.height = 360
  svg.setAttribute('viewBox', '0 0 480 360')
  svg.setAttribute('aria-hidden', 'true')
  surface.append(canvas, svg)
  root.append(element('h2', name), surface, caption, issues)
  return { root, canvas, svg, caption, issues }
}
const lanes = element('div', undefined, 'lanes'),
  primaryStage = stage('Selected session'),
  comparisonStage = data.comparison ? stage('Comparison session') : null
lanes.append(primaryStage.root)
if (comparisonStage) lanes.append(comparisonStage.root)
app.append(lanes)
const panels = element('div', undefined, 'panels'),
  selectedState = element('section'),
  inputPanel = element('section')
selectedState.append(element('h2', 'Selected state'))
inputPanel.append(element('h2', 'Applied inputs'))
const stateTable = element('div', undefined, 'scroll'),
  inputTable = element('div', undefined, 'scroll'),
  held = element('p', undefined, 'muted'),
  summary = element('p', undefined, 'muted'),
  diff = element('div')
selectedState.append(summary, stateTable, diff)
inputPanel.append(held, inputTable)
panels.append(selectedState, inputPanel)
app.append(panels)

function currentFrames(): readonly (
  DevelopmentFrameRecordV1 | DevelopmentFrameRecordV2
)[]
{
  const values = data.primary.trace.frames.filter(
    (frame) => frame.segmentId === selectedSegment
  )
  for (const mark of data.primary.trace.marks)
    if (
      mark.segmentId === selectedSegment &&
      !values.some((frame) => frame.order === mark.frame.order)
    )
      values.push(mark.frame)
  return values.sort((a, b) => a.tick - b.tick || a.order - b.order)
}
function hasFrameChronology(
  frame: DevelopmentFrameRecordV1
): frame is DevelopmentFrameRecordV2
{
  return (
    'captureSequence' in frame &&
    typeof frame.captureSequence === 'number' &&
    'inputOrdinal' in frame &&
    typeof frame.inputOrdinal === 'number'
  )
}
function nearest(values: readonly { tick: number }[], tick: number): number
{
  let selected = 0
  for (let i = 0; i < values.length; i++)
    if (values[i]!.tick <= tick) selected = i
  return selected
}
function svgNode(
  name: string,
  attrs: Record<string, string | number>,
  text?: string
): SVGElement
{
  const node = document.createElementNS('http://www.w3.org/2000/svg', name)
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value))
  if (text) node.textContent = text
  return node
}
function overlayValue(
  value: DevelopmentOverlayValueV1,
  frame: ProfileRuntimeFrameV1
): { value: number | null; issue: string | null }
{
  if (typeof value === 'number') return { value, issue: null }
  const resolved = resolveProfileNumericProbeV1(frame, value.probe)
  return {
    value: resolved.value,
    issue:
      resolved.status === 'available'
        ? null
        : (resolved.issue ?? resolved.status),
  }
}
function renderStage(
  surface: ReturnType<typeof stage>,
  lane: DevelopmentViewerLaneV1,
  frame: ProfileRuntimeFrameV1 | null,
  segmentId: string,
  own: boolean
): void
{
  const token = generation
  surface.svg.replaceChildren()
  const context = surface.canvas.getContext('2d')!
  context.fillStyle = '#eef0f4'
  context.fillRect(0, 0, 480, 360)
  if (!frame)
  {
    surface.caption.textContent = 'No retained observation for this segment.'
    return
  }
  const media = own
    ? data.media.find(
        (item) =>
          item.artifact.mimeType === 'image/png' &&
          item.segmentId === segmentId &&
          item.tick === frame.tick
      )
    : undefined
  const state = media?.state ?? frame
  surface.caption.textContent = media
    ? `Replay image · tick ${media.tick} · inspect reproduction evidence below`
    : `State diagram · tick ${frame.tick} · no retained image at this tick`
  if (media?.dataUrl) queueImage(surface.canvas, media, token)
  const issues: string[] = []
  if (!media)
  {
    surface.svg.append(
      svgNode('path', {
        d: 'M240 0V360 M0 180H480',
        stroke: '#c5cbd4',
        'stroke-width': 1,
      })
    )
    for (const target of state.targets)
      if (target.targetIndex !== 0 && target.visible)
      {
        const x = 240 + target.x,
          y = 180 - target.y
        surface.svg.append(
          svgNode('circle', { cx: x, cy: y, r: 4, fill: '#137c94' }),
          svgNode(
            'text',
            { x: x + 7, y: y - 7, fill: '#163f51', 'font-size': 11 },
            `${target.name}${target.instance === 'clone' ? ` [${String(target.cloneKey)}]` : ''}`
          )
        )
      }
  }
  if (showBounds.checked)
    for (const target of state.targets)
    {
      if (target.targetIndex === 0 || !target.visible) continue
      const bounds = lane.costumeBounds.find(
        (item) =>
          item.targetIndex === target.targetIndex &&
          item.costumeIndexOneBased === target.costumeIndexOneBased
      )
      if (!bounds) continue
      const scale = target.size / 100 / bounds.bitmapResolution
      const rotation =
        target.rotationStyle === 'all around' ? target.direction - 90 : 0
      const flip =
        target.rotationStyle === 'left-right' && target.direction < 0 ? -1 : 1
      surface.svg.append(
        svgNode('rect', {
          x: -bounds.rotationCenterX * scale,
          y: -bounds.rotationCenterY * scale,
          width: bounds.width * scale,
          height: bounds.height * scale,
          fill: 'none',
          stroke: '#4d6b91',
          'stroke-dasharray': '5 3',
          'stroke-width': 1,
          transform: `translate(${240 + target.x} ${180 - target.y}) rotate(${rotation}) scale(${flip} 1)`,
        })
      )
    }
  if (own && showOverlays.checked)
    for (const overlay of data.overlays)
    {
      const x = overlayValue(overlay.x, state),
        y = overlayValue(overlay.y, state)
      const values =
        overlay.kind === 'rectangle'
          ? [
              overlayValue(overlay.width, state),
              overlayValue(overlay.height, state),
            ]
          : [overlayValue(overlay.radius, state)]
      const error = [x, y, ...values].find((value) => value.issue)
      if (
        error ||
        x.value === null ||
        y.value === null ||
        values.some(
          (value) =>
            value.value === null ||
            value.value <= 0 ||
            Math.abs(value.value) > 10000
        )
      )
      {
        issues.push(
          `${overlay.label ?? overlay.id}: ${error?.issue ?? 'invalid extent'}`
        )
        continue
      }
      const style = {
        fill: 'none',
        stroke:
          overlay.purpose === 'declared-collision' ? '#c8750b' : '#0c869c',
        'stroke-width': 2,
      }
      const shape =
        overlay.kind === 'rectangle'
          ? svgNode('rect', {
              ...style,
              x: 240 + x.value - values[0]!.value! / 2,
              y: 180 - y.value - values[1]!.value! / 2,
              width: values[0]!.value!,
              height: values[1]!.value!,
            })
          : svgNode('circle', {
              ...style,
              cx: 240 + x.value,
              cy: 180 - y.value,
              r: values[0]!.value!,
            })
      const title = svgNode(
        'title',
        {},
        `${overlay.label ?? overlay.id} · ${overlay.purpose}`
      )
      shape.append(title)
      surface.svg.append(shape)
    }
  surface.issues.textContent = issues.join(' · ')
}

function queueImage(
  canvas: HTMLCanvasElement,
  media: DevelopmentViewerMediaV1,
  token: number,
  clip?: { pivotX: number; pivotY: number; scale: number }
): void
{
  imageQueue = imageQueue
    .then(async () =>
    {
      if (token !== (clip ? clipGeneration : generation)) return
      const base64 = media.dataUrl!.split(',')[1]!,
        binary = atob(base64),
        bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const bitmap = await createImageBitmap(
        new Blob([bytes], { type: 'image/png' })
      )
      try
      {
        if (token !== (clip ? clipGeneration : generation)) return
        const context = canvas.getContext('2d')!
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.imageSmoothingEnabled = false
        if (clip)
        {
          const originX = canvas.width / 2,
            originY = canvas.height / 2
          context.strokeStyle = '#75818f'
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(originX, 0)
          context.lineTo(originX, canvas.height)
          context.moveTo(0, originY)
          context.lineTo(canvas.width, originY)
          context.stroke()
          context.drawImage(
            bitmap,
            originX - clip.pivotX * clip.scale,
            originY - clip.pivotY * clip.scale,
            bitmap.width * clip.scale,
            bitmap.height * clip.scale
          )
          context.fillStyle = '#0c869c'
          context.beginPath()
          context.arc(originX, originY, 3, 0, Math.PI * 2)
          context.fill()
        }
        else context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      }
      finally
      {
        bitmap.close()
      }
    })
    .catch((error: unknown) =>
    {
      primaryStage.issues.textContent = `Retained image unavailable: ${error instanceof Error ? error.message : String(error)}`
    })
}

function render(): void
{
  generation++
  const values = currentFrames()
  frameIndex = Math.max(0, Math.min(frameIndex, values.length - 1))
  const frame = values[frameIndex] ?? null
  range.max = String(Math.max(0, values.length - 1))
  range.value = String(frameIndex)
  range.disabled = !values.length
  previous.disabled = frameIndex === 0
  next.disabled = frameIndex >= values.length - 1
  position.textContent = frame
    ? `Tick ${frame.tick} · observation ${frameIndex + 1}/${values.length}`
    : 'No retained state'
  range.setAttribute('aria-valuetext', position.textContent)
  renderStage(primaryStage, data.primary, frame, selectedSegment, true)
  let compared: DevelopmentFrameRecordV1 | null = null
  if (data.comparison && comparisonStage)
  {
    const ordinal = data.primary.trace.segments.find(
      (value) => value.segmentId === selectedSegment
    )?.ordinal
    const segment = data.comparison.trace.segments.find(
      (value) => value.ordinal === ordinal
    )
    const candidates = data.comparison.trace.frames.filter(
      (value) => value.segmentId === segment?.segmentId
    )
    compared =
      frame && candidates[0] && candidates[0].tick <= frame.tick
        ? (candidates[nearest(candidates, frame.tick)] ?? null)
        : null
    renderStage(
      comparisonStage,
      data.comparison,
      compared,
      segment?.segmentId ?? '',
      false
    )
    comparisonStage.caption.textContent += ` · ${data.comparison.status.profile.runtime} ${data.comparison.status.profile.tickRate} Hz; aligned by retained tick`
  }
  stateTable.replaceChildren()
  inputTable.replaceChildren()
  diff.replaceChildren()
  if (!frame)
  {
    summary.textContent = 'This session has no recorded post-step state.'
    return
  }
  const trace = data.primary.trace
  const exactFrame =
    trace.schemaVersion === 2 && hasFrameChronology(frame) ? frame : null
  summary.textContent = `Timer ${frame.timer ?? 'unavailable'} s · clones ${frame.cloneCounts?.total ?? 'unavailable'} · draw epoch ${frame.drawEpoch}${exactFrame ? ` · capture ${exactFrame.captureSequence} · input prefix ${exactFrame.inputOrdinal}` : ' · legacy recorded order'}`
  stateTable.append(
    table(
      ['Target / instance', 'Position / costume', 'Variables / sampled lists'],
      frame.targets.map((target) => [
        `${target.name} (${target.targetIndex}) · ${target.instance === 'original' ? 'original' : `${target.cloneIdentity}: ${String(target.cloneKey)}`}`,
        `x ${target.x}, y ${target.y}, direction ${target.direction}, size ${target.size}% · ${target.costumeIndexOneBased}: ${target.costumeName}`,
        JSON.stringify({ variables: target.variables, lists: target.lists }),
      ])
    )
  )
  let inputs: readonly DevelopmentInputRecordV1[]
  const heldKeys = new Set<string>()
  if (trace.schemaVersion === 2 && exactFrame)
  {
    const exactInputs = trace.inputs.filter(
      (input) =>
        input.segmentId === selectedSegment &&
        input.ordinal <= exactFrame.inputOrdinal &&
        input.captureSequence < exactFrame.captureSequence
    )
    inputs = exactInputs
    for (const input of exactInputs)
      if (input.device === 'keyboard')
      {
        if (input.data.isDown && input.interpretedKey !== null)
          heldKeys.add(input.interpretedKey)
        for (const key of input.releasedKeys) heldKeys.delete(key)
      }
  }
  else
  {
    inputs = trace.inputs.filter(
      (input) =>
        input.segmentId === selectedSegment && input.order < frame.order
    )
    for (const input of inputs)
      if (input.device === 'keyboard')
      {
        if (input.data.isDown) heldKeys.add(String(input.data.key))
        else heldKeys.delete(String(input.data.key))
      }
  }
  held.textContent = `Held keys after recorded inputs: ${[...heldKeys].sort().join(', ') || 'none'}`
  inputTable.append(
    table(
      ['Order / tick', 'Source / device', 'Applied VM payload'],
      inputs
        .slice(-32)
        .map((input) => [
          `${input.ordinal} / ${input.tick}`,
          `${input.source} / ${input.device}`,
          JSON.stringify(input.data),
        ])
    )
  )
  if (compared)
  {
    diff.append(
      element('h2', 'State comparison'),
      table(
        ['Target', 'Selected x / y', 'Compared x / y'],
        frame.targets.map((target) =>
        {
          const other = compared!.targets.find(
            (row) =>
              row.targetIndex === target.targetIndex &&
              row.instance === target.instance &&
              row.cloneKey === target.cloneKey
          )
          return [
            target.name,
            `${target.x} / ${target.y}`,
            other ? `${other.x} / ${other.y}` : 'unavailable',
          ]
        })
      )
    )
  }
}

if (data.clips?.clips.length)
{
  const root = element('section', undefined, 'clip'),
    toolbar = element('div', undefined, 'controls'),
    select = element('select'),
    canvas = element('canvas'),
    status = element('output'),
    names = element('div', undefined, 'scroll')
  canvas.width = 512
  canvas.height = 512
  select.id = 'clip-select'
  data.clips.clips.forEach((clip, index) =>
  {
    const option = element('option', clip.name)
    option.value = String(index)
    select.append(option)
  })
  const play = button('clip-play', 'Play clip', () =>
  {
    if (clipTimer) stop()
    else
    {
      clipStarted = performance.now()
      play.textContent = 'Pause clip'
      schedule()
    }
  })
  function stop(): void
  {
    if (clipTimer) clearTimeout(clipTimer)
    clipTimer = null
    play.textContent = 'Play clip'
  }
  function draw(): void
  {
    const clip = data.clips!.clips[clipIndex]!,
      frame = clip.frames[clipFrame]!
    const image = data.media.find(
      (item) => item.artifact.key === frame.image.key
    )
    status.textContent = `${clipFrame + 1}/${clip.frames.length} · ${frame.costumeName} (${frame.costumeIndexOneBased}) · ${frame.durationMs} ms · pivot ${frame.rotationCenterX}, ${frame.rotationCenterY}`
    const extent = Math.max(
      1,
      ...clip.frames.flatMap((value) =>
        [
          value.rotationCenterX,
          value.width - value.rotationCenterX,
          value.rotationCenterY,
          value.height - value.rotationCenterY,
        ].map((distance) => Math.abs(distance) / value.bitmapResolution)
      )
    )
    if (image?.dataUrl)
      queueImage(canvas, image, ++clipGeneration, {
        pivotX: frame.rotationCenterX,
        pivotY: frame.rotationCenterY,
        scale: Math.min(4, 224 / extent) / frame.bitmapResolution,
      })
    names.replaceChildren(
      table(
        ['Frame', 'Costume', 'Duration / pivot'],
        clip.frames.map((value, index) => [
          index + 1,
          `${value.costumeName} (${value.costumeIndexOneBased})`,
          `${value.durationMs} ms · ${value.rotationCenterX}, ${value.rotationCenterY}`,
        ])
      )
    )
  }
  function schedule(): void
  {
    const clip = data.clips!.clips[clipIndex]!
    if (performance.now() - clipStarted >= 60000)
    {
      stop()
      return
    }
    clipTimer = setTimeout(() =>
    {
      if (clipFrame + 1 >= clip.frames.length && !clip.loop)
      {
        stop()
        return
      }
      clipFrame = (clipFrame + 1) % clip.frames.length
      draw()
      schedule()
    }, clip.frames[clipFrame]!.durationMs)
  }
  select.addEventListener('change', () =>
  {
    stop()
    clipIndex = Number(select.value)
    clipFrame = 0
    draw()
  })
  toolbar.append(
    label('Animation clip', select),
    button('clip-previous', 'Previous clip frame', () =>
    {
      stop()
      const clip = data.clips!.clips[clipIndex]!
      clipFrame = (clipFrame - 1 + clip.frames.length) % clip.frames.length
      draw()
    }),
    play,
    button('clip-next', 'Next clip frame', () =>
    {
      stop()
      const clip = data.clips!.clips[clipIndex]!
      clipFrame = (clipFrame + 1) % clip.frames.length
      draw()
    })
  )
  root.append(
    element('h2', 'Animation preview'),
    toolbar,
    canvas,
    element(
      'p',
      'Prepared costume order and authored durations share one marked pivot and scale. Playback stops after 60 seconds.',
      'muted'
    ),
    status,
    names
  )
  app.append(root)
  draw()
}
const audio = data.media.filter((item) =>
  item.artifact.mimeType.startsWith('audio/')
)
if (audio.length)
{
  const root = element('section')
  root.append(
    element('h2', 'Output audio'),
    element(
      'p',
      'Diagnostic capture of the internal runtime output; playback requires a local gesture.',
      'muted'
    )
  )
  for (const item of audio)
  {
    const control = element('audio')
    control.controls = true
    control.preload = 'none'
    control.src = item.dataUrl!
    control.setAttribute('aria-label', `Output audio ${item.artifact.key}`)
    root.append(control)
  }
  app.append(root)
}
if (data.reproduction) disclosure('Reproduction result', data.reproduction, app)
disclosure('Lifecycle command history', data.primary.trace.commands, app)
disclosure('Source, runtime and device evidence', data.primary.status, app)
if (data.comparison)
  disclosure('Comparison source and runtime', data.comparison.status, app)
disclosure(
  'Limitations and diagnostics',
  [...data.limitations, ...data.primary.trace.issues],
  app
)
render()
