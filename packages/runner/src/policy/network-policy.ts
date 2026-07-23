// packages/runner/src/policy/network-policy.ts
// offline-by-default fetch & WebSocket policy for untrusted Scratch execution

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { RUN_ISSUE_CODES, createRunIssue, type RunIssue } from './issues.js'
import { poisonRunnerExecution } from './execution-coordinator.js'

interface NetworkPolicyOptions
{
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
}

export interface InstalledNetworkPolicy
{
  blockedUrls: string[]
  restore(): void
}

type FetchFn = typeof fetch
type WebSocketCtor = typeof WebSocket

interface FetchWithTimeoutModule
{
  setFetch(fetchFn: FetchFn): void
}

const requireCjs = createRequire(import.meta.url)
const globals = globalThis as typeof globalThis & {
  fetch?: FetchFn
  WebSocket?: WebSocketCtor
}
const baseFetch = globals.fetch?.bind(globalThis) as FetchFn | undefined
const baseWebSocket = globals.WebSocket

interface ActivePolicy
{
  allowNetwork: boolean
  allowedOrigins: Set<string>
  blockedUrls: string[]
}

let activePolicy: ActivePolicy | null = null

export function runnerNetworkPolicyActive(): boolean
{
  return activePolicy !== null
}

function restoreNetworkPolicy(
  previousFetch: FetchFn | undefined,
  previousWebSocket: WebSocketCtor | undefined,
  previousPolicy: ActivePolicy | null,
  hook: FetchWithTimeoutModule | null
): void
{
  let failed = false
  let firstFailure: unknown
  const attemptRestore = (callback: () => void): void =>
  {
    try
    {
      callback()
    }
    catch (error)
    {
      if (!failed) firstFailure = error
      failed = true
    }
  }
  activePolicy = previousPolicy
  attemptRestore(() =>
  {
    if (previousFetch) globals.fetch = previousFetch
    else Reflect.deleteProperty(globals, 'fetch')
  })
  attemptRestore(() =>
  {
    if (previousWebSocket) globals.WebSocket = previousWebSocket
    else Reflect.deleteProperty(globals, 'WebSocket')
  })
  attemptRestore(() =>
  {
    hook?.setFetch(managedFetch)
  })
  if (failed)
  {
    poisonRunnerExecution(firstFailure)
    throw firstFailure
  }
}

function fetchWithTimeoutPath(): string
{
  const main = requireCjs.resolve('@scratch/scratch-vm')
  return join(dirname(main), '..', '..', 'src', 'util', 'fetch-with-timeout.js')
}

function loadFetchHook(): FetchWithTimeoutModule | null
{
  try
  {
    return requireCjs(fetchWithTimeoutPath()) as FetchWithTimeoutModule
  }
  catch
  {
    return null
  }
}

function requestUrl(input: RequestInfo | URL): string
{
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function originOf(url: string): string | null
{
  try
  {
    return new URL(url).origin
  }
  catch
  {
    return null
  }
}

function addBlocked(blockedUrls: string[], url: string): void
{
  if (!blockedUrls.includes(url)) blockedUrls.push(url)
}

const managedFetch: FetchFn = (input, init) =>
{
  const url = requestUrl(input)
  const policy = activePolicy
  if (!policy)
  {
    if (baseFetch) return baseFetch(input, init)
    return Promise.reject(new Error(`fetch is unavailable: ${url}`))
  }

  const origin = originOf(url)
  const allowed =
    policy.allowNetwork ||
    (origin !== null && policy.allowedOrigins.has(origin))
  if (allowed && baseFetch)
  {
    return baseFetch(input, init)
  }
  addBlocked(policy.blockedUrls, url)
  return Promise.reject(new Error(`network disabled: ${url}`))
}

const ManagedWebSocket = function (
  this: unknown,
  url: string | URL,
  protocols?: string | string[]
): WebSocket
{
  const normalizedUrl = String(url)
  const policy = activePolicy
  const origin = originOf(normalizedUrl)
  const allowed =
    !policy ||
    policy.allowNetwork ||
    (origin !== null && policy.allowedOrigins.has(origin))
  if (!allowed)
  {
    addBlocked(policy.blockedUrls, normalizedUrl)
    throw new Error(`network disabled: ${normalizedUrl}`)
  }
  if (!baseWebSocket)
    throw new Error(`WebSocket is unavailable: ${normalizedUrl}`)
  return protocols === undefined
    ? new baseWebSocket(normalizedUrl)
    : new baseWebSocket(normalizedUrl, protocols)
} as unknown as WebSocketCtor

if (baseWebSocket)
{
  Object.setPrototypeOf(ManagedWebSocket, baseWebSocket)
  Object.defineProperty(ManagedWebSocket, 'prototype', {
    value: baseWebSocket.prototype,
  })
}

export function blockedNetworkIssues(
  policy: InstalledNetworkPolicy | undefined
): RunIssue[]
{
  return (policy?.blockedUrls ?? []).map((url) =>
    createRunIssue({
      code: RUN_ISSUE_CODES.networkRequestDenied,
      kind: 'network-policy',
      responsibility: 'unsupported',
      message: `blocked network request: ${url}`,
    })
  )
}

export function installNetworkPolicy(
  options: NetworkPolicyOptions = {}
): InstalledNetworkPolicy
{
  const previousFetch = globals.fetch
  const previousWebSocket = globals.WebSocket
  const previousPolicy = activePolicy
  const hook = loadFetchHook()
  const blockedUrls: string[] = []

  try
  {
    activePolicy = {
      allowNetwork: options.allowNetwork === true,
      allowedOrigins: new Set(options.allowedOrigins ?? []),
      blockedUrls,
    }
    globals.fetch = managedFetch
    globals.WebSocket = ManagedWebSocket
    hook?.setFetch(managedFetch)
  }
  catch (error)
  {
    try
    {
      restoreNetworkPolicy(
        previousFetch,
        previousWebSocket,
        previousPolicy,
        hook
      )
    }
    catch (restoreError)
    {
      throw new AggregateError(
        [error, restoreError],
        'network policy installation and rollback failed'
      )
    }
    throw error
  }

  return {
    blockedUrls,
    restore(): void
    {
      restoreNetworkPolicy(
        previousFetch,
        previousWebSocket,
        previousPolicy,
        hook
      )
    },
  }
}
