// packages/runner/src/policy/runtime-log.ts
// classify & bound VM/browser logs without leaking floods onto protocol stdout

import type {
  BrowserConsoleCategorySummary,
  BrowserConsoleSummary,
  RuntimeLogCategorySummary,
  RuntimeLogSummary,
} from './types.js'

const VM_RUNTIME_LOG_CODES = {
  costumeStorageUnavailable: 'runner.vm.log.costume-storage-unavailable',
  soundStorageUnavailable: 'runner.vm.log.sound-storage-unavailable',
  costumeRendererUnavailable: 'runner.vm.log.costume-renderer-unavailable',
  soundEngineUnavailable: 'runner.vm.log.sound-engine-unavailable',
  unknownWarning: 'runner.vm.log.unknown-warning',
  unknownError: 'runner.vm.log.unknown-error',
  other: 'runner.vm.log.other',
} as const

const BROWSER_CONSOLE_CODES = {
  gpuReadback: 'runner.browser.console.gpu-readback',
  canvasReadback: 'runner.browser.console.canvas-readback',
  networkBlocked: 'runner.browser.console.network-blocked',
  unknownWarning: 'runner.browser.console.unknown-warning',
  unknownError: 'runner.browser.console.unknown-error',
  other: 'runner.browser.console.other',
} as const

type Disposition = 'expected-environment' | 'advisory' | 'failure'

interface Classification
{
  code: string
  level: string
  disposition: Disposition
  uniqueValue?: string
}

interface MutableCategory
{
  code: string
  level: string
  disposition: Disposition
  count: number
  samples: string[]
  uniqueValues?: Set<string>
}

const MAX_SAMPLES_PER_CATEGORY = 3
const MAX_SAMPLE_BYTES = 500
const MAX_BROWSER_LOG_ENTRIES = 200
const MAX_BROWSER_LOG_BYTES = 64 * 1024
const MAX_BROWSER_ENTRY_BYTES = 2000

export function emptyRuntimeLogSummary(): RuntimeLogSummary
{
  return { total: 0, categories: [], droppedEvents: 0, truncatedBytes: 0 }
}

export function emptyBrowserConsoleSummary(): BrowserConsoleSummary
{
  return {
    total: 0,
    retainedEntries: 0,
    droppedEntries: 0,
    truncatedBytes: 0,
    categories: [],
  }
}

function stripAnsi(value: string): string
{
  let result = ''
  for (let index = 0; index < value.length; index++)
  {
    if (value.charCodeAt(index) !== 27 || value[index + 1] !== '[')
    {
      result += value[index]
      continue
    }
    index += 2
    while (index < value.length && /[0-9;]/.test(value[index]!)) index++
    if (value[index] !== 'm') result += value[index] ?? ''
  }
  return result
}

function boundUtf8(
  value: string,
  maxBytes: number,
  observedBytes = Buffer.byteLength(value, 'utf-8')
): { value: string; droppedBytes: number }
{
  if (observedBytes <= maxBytes) return { value, droppedBytes: 0 }
  const suffix = '...'
  const suffixBytes = Buffer.byteLength(suffix)
  let kept = ''
  let keptBytes = 0
  for (const character of value)
  {
    const characterBytes = Buffer.byteLength(character, 'utf-8')
    if (keptBytes + characterBytes + suffixBytes > maxBytes) break
    kept += character
    keptBytes += characterBytes
  }
  return { value: kept + suffix, droppedBytes: observedBytes - keptBytes }
}

class CategoryAccumulator
{
  private readonly categories = new Map<string, MutableCategory>()
  private total = 0
  private totalBytes = 0
  private sampleBytes = 0

  add(
    message: string,
    classification: Classification,
    observedBytes = Buffer.byteLength(message, 'utf-8')
  ): void
  {
    this.total++
    this.totalBytes += observedBytes
    let category = this.categories.get(classification.code)
    if (!category)
    {
      category = {
        code: classification.code,
        level: classification.level,
        disposition: classification.disposition,
        count: 0,
        samples: [],
      }
      this.categories.set(classification.code, category)
    }
    category.count++
    if (classification.uniqueValue)
    {
      category.uniqueValues ??= new Set<string>()
      category.uniqueValues.add(classification.uniqueValue)
    }
    if (category.samples.length < MAX_SAMPLES_PER_CATEGORY)
    {
      const sample = boundUtf8(message, MAX_SAMPLE_BYTES).value
      category.samples.push(sample)
      this.sampleBytes += Buffer.byteLength(sample, 'utf-8')
    }
  }

  summary(): {
    total: number
    droppedEvents: number
    truncatedBytes: number
    categories: Array<BrowserConsoleCategorySummary | RuntimeLogCategorySummary>
  }
  {
    const categories = [...this.categories.values()]
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      .map((category) => ({
        code: category.code,
        level: category.level,
        disposition: category.disposition,
        count: category.count,
        samples: [...category.samples],
        ...(category.uniqueValues
          ? { uniqueValues: category.uniqueValues.size }
          : {}),
      }))
    const retainedEvents = categories.reduce(
      (total, category) => total + category.samples.length,
      0
    )
    return {
      total: this.total,
      droppedEvents: this.total - retainedEvents,
      truncatedBytes: Math.max(0, this.totalBytes - this.sampleBytes),
      categories,
    }
  }
}

function messageOf(args: unknown[]): string
{
  return stripAnsi(args.map((arg) => String(arg)).join(' ')).trim()
}

function isScratchVmLog(message: string): boolean
{
  return message.includes('\tscratch-vm\t')
}

function scratchVmSample(message: string): string
{
  const marker = '\tscratch-vm\t'
  const offset = message.indexOf(marker)
  return offset === -1
    ? message
    : `scratch-vm: ${message.slice(offset + marker.length)}`
}

function trailingValue(message: string): string | undefined
{
  const separator = message.lastIndexOf(': ')
  return separator === -1 ? undefined : message.slice(separator + 2)
}

function classifyVm(message: string): Classification
{
  if (
    message.includes('No storage module present; cannot load costume asset:')
  )
  {
    return {
      code: VM_RUNTIME_LOG_CODES.costumeStorageUnavailable,
      level: 'warning',
      disposition: 'expected-environment',
      uniqueValue: trailingValue(message),
    }
  }
  if (message.includes('No storage module present; cannot load sound asset:'))
  {
    return {
      code: VM_RUNTIME_LOG_CODES.soundStorageUnavailable,
      level: 'warning',
      disposition: 'expected-environment',
      uniqueValue: trailingValue(message),
    }
  }
  if (message.includes('No rendering module present; cannot load costume:'))
  {
    return {
      code: VM_RUNTIME_LOG_CODES.costumeRendererUnavailable,
      level: 'warning',
      disposition: 'expected-environment',
      uniqueValue: trailingValue(message),
    }
  }
  if (message.includes('No audio engine present; cannot load sound:'))
  {
    return {
      code: VM_RUNTIME_LOG_CODES.soundEngineUnavailable,
      level: 'warning',
      disposition: 'expected-environment',
      uniqueValue: trailingValue(message),
    }
  }
  if (message.includes('\tERROR\t') || message.includes('\tFATAL\t'))
  {
    return {
      code: VM_RUNTIME_LOG_CODES.unknownError,
      level: 'error',
      disposition: 'failure',
    }
  }
  if (message.includes('\tWARN\t'))
  {
    return {
      code: VM_RUNTIME_LOG_CODES.unknownWarning,
      level: 'warning',
      disposition: 'advisory',
    }
  }
  return {
    code: VM_RUNTIME_LOG_CODES.other,
    level: 'other',
    disposition: 'advisory',
  }
}

function classifyBrowser(type: string, message: string): Classification
{
  if (/net::ERR_BLOCKED_BY_CLIENT/i.test(message))
  {
    return {
      code: BROWSER_CONSOLE_CODES.networkBlocked,
      level: type,
      disposition: 'expected-environment',
    }
  }
  if (/ReadPixels|GPU stall due to ReadPixels|SwiftShader/i.test(message))
  {
    return {
      code: BROWSER_CONSOLE_CODES.gpuReadback,
      level: type,
      disposition: 'expected-environment',
    }
  }
  if (/willReadFrequently/i.test(message))
  {
    return {
      code: BROWSER_CONSOLE_CODES.canvasReadback,
      level: type,
      disposition: 'expected-environment',
    }
  }
  if (type === 'error' || type === 'assert')
  {
    return {
      code: BROWSER_CONSOLE_CODES.unknownError,
      level: type,
      disposition: 'failure',
    }
  }
  if (type === 'warning')
  {
    return {
      code: BROWSER_CONSOLE_CODES.unknownWarning,
      level: type,
      disposition: 'advisory',
    }
  }
  return {
    code: BROWSER_CONSOLE_CODES.other,
    level: type,
    disposition: 'advisory',
  }
}

type CapturedScratchVmWork<T> =
  | { ok: true; value: T; log: RuntimeLogSummary }
  | { ok: false; error: unknown; log: RuntimeLogSummary }

export async function captureScratchVmLoadLogs<T>(
  work: () => Promise<T>
): Promise<CapturedScratchVmWork<T>>
{
  const original = console.log
  const accumulator = new CategoryAccumulator()
  console.log = (...args: unknown[]): void =>
  {
    const message = messageOf(args)
    if (isScratchVmLog(message))
    {
      accumulator.add(
        scratchVmSample(message),
        classifyVm(message),
        Buffer.byteLength(message, 'utf-8')
      )
      return
    }
    original(...args)
  }
  try
  {
    const value = await work()
    return {
      ok: true,
      value,
      log: accumulator.summary() as RuntimeLogSummary,
    }
  }
  catch (error)
  {
    return {
      ok: false,
      error,
      log: accumulator.summary() as RuntimeLogSummary,
    }
  }
  finally
  {
    console.log = original
  }
}

export class BrowserConsoleCollector
{
  readonly entries: string[] = []
  private readonly accumulator = new CategoryAccumulator()
  private retainedBytes = 0
  private droppedEntries = 0
  private rawTruncatedBytes = 0

  add(type: string, text: string): Classification
  {
    const message = `${type}: ${stripAnsi(text)}`
    const classification = classifyBrowser(type, message)
    const messageBytes = Buffer.byteLength(message, 'utf-8')
    this.accumulator.add(message, classification, messageBytes)
    const bounded = boundUtf8(
      message,
      MAX_BROWSER_ENTRY_BYTES,
      messageBytes
    )
    const bytes = Buffer.byteLength(bounded.value, 'utf-8')
    if (
      this.entries.length < MAX_BROWSER_LOG_ENTRIES &&
      this.retainedBytes + bytes <= MAX_BROWSER_LOG_BYTES
    )
    {
      this.entries.push(bounded.value)
      this.retainedBytes += bytes
      this.rawTruncatedBytes += bounded.droppedBytes
    }
    else
    {
      this.droppedEntries++
      this.rawTruncatedBytes += messageBytes
    }
    return classification
  }

  summary(): BrowserConsoleSummary
  {
    const summary = this.accumulator.summary()
    return {
      total: summary.total,
      retainedEntries: this.entries.length,
      droppedEntries: this.droppedEntries,
      truncatedBytes: this.rawTruncatedBytes,
      categories: summary.categories.map((category) => ({
        code: category.code,
        level: category.level,
        disposition: category.disposition,
        count: category.count,
        samples: category.samples,
      })),
    }
  }
}
