// packages/repair/src/policy/redaction.ts
// remove credentials & host paths from durable repair projections

import type { RepairProposal } from './contracts.js'

const CREDENTIAL_KEY =
  /(?:authorization|cookie|credential|password|secret|token|api[-_]?key|private[-_]?key)/i
const CREDENTIAL_TEXT =
  /\b(authorization|bearer|basic|password|secret|token|api[-_ ]?key)\s*(?::|=|\s)\s*([^\s,;]+)/gi
const PROVIDER_CREDENTIAL =
  /\b(?:sk-[a-zA-Z0-9_-]{8,}|AKIA[A-Z0-9]{16}|gh[pousr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,}|glpat-[a-zA-Z0-9_-]{20,}|xox[baprs]-[a-zA-Z0-9-]{10,}|sk_live_[a-zA-Z0-9]{16,}|AIza[a-zA-Z0-9_-]{20,}|eyJ[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,})\b/g
const PEM_CREDENTIAL =
  /-----BEGIN [^-\r\n]+-----[\s\S]*?-----END [^-\r\n]+-----/g
const POSIX_HOST_PATH = /(^|[^a-zA-Z0-9/])\/(?!\/)(?:[^\s"'`),;\]}<>]+\/?)+/g
const WINDOWS_HOST_PATH =
  /(^|[^a-zA-Z0-9])(?:[a-zA-Z]:\\)(?:[^\s"'`),;\]}\\]+\\?)+/g

interface ArtifactSafeProjection<T>
{
  value: T
  redacted: boolean
}

function redactText(value: string): string
{
  return value
    .replace(PEM_CREDENTIAL, '[credential]')
    .replace(CREDENTIAL_TEXT, '$1=[credential]')
    .replace(PROVIDER_CREDENTIAL, '[credential]')
    .replace(POSIX_HOST_PATH, '$1[host-path]')
    .replace(WINDOWS_HOST_PATH, '$1[host-path]')
}

export function durableProposalProjection(
  proposal: RepairProposal
): ArtifactSafeProjection<RepairProposal>
{
  const projected = artifactSafeProjection({
    ...proposal,
    rationale: '[omitted free-form agent text]',
    expectedEffect: '[omitted free-form agent text]',
  })
  return { value: projected.value, redacted: true }
}

export function artifactSafeProjection<T>(value: T): ArtifactSafeProjection<T>
{
  let redacted = false
  const serialized = JSON.stringify(value, (key, entry: unknown) =>
  {
    if (
      key &&
      CREDENTIAL_KEY.test(key) &&
      entry !== null &&
      typeof entry !== 'number' &&
      typeof entry !== 'boolean'
    )
    {
      redacted = true
      return '[redacted]'
    }
    if (typeof entry !== 'string') return entry
    const safe = redactText(entry)
    if (safe !== entry) redacted = true
    return safe
  })
  if (serialized === undefined)
  {
    throw new TypeError('artifact value is not serializable JSON')
  }
  return { value: JSON.parse(serialized) as T, redacted }
}
