// packages/eval/src/codex/host.ts
// shared Codex CLI probes, ChatGPT login gate, & isolated env allowlist

import { spawnSync } from 'node:child_process'

export const CODEX_HOST_ENVIRONMENT_VARIABLES = Object.freeze([
  'CODEX_HOME',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NO_COLOR',
  'PATH',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'TMPDIR',
] as const)

const SYNC_PROBE_TIMEOUT_MS = 10_000

// soft probe used by benches that record "unavailable" rather than fail setup
export function probeCodexCliVersion(command = 'codex'): string
{
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: SYNC_PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024,
  })
  if (result.error || result.status !== 0 || result.stdout.trim().length === 0)
    return 'unavailable'
  return result.stdout.trim()
}

export function requireCodexCliVersion(command = 'codex'): string
{
  const version = probeCodexCliVersion(command)
  if (version === 'unavailable') throw new Error('Codex CLI is unavailable')
  return version
}

export function requireCodexChatGptLogin(command = 'codex'): string
{
  const result = spawnSync(command, ['login', 'status'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: SYNC_PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024,
  })
  const output = `${result.stdout}\n${result.stderr}`.trim()
  if (
    result.error ||
    result.status !== 0 ||
    !output.includes('Logged in using ChatGPT')
  )
    throw new Error(
      'Codex must be logged in through ChatGPT; API-key authentication is not supported'
    )
  return output
}

export function isolatedCodexEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv
{
  const environment: NodeJS.ProcessEnv = { NO_COLOR: '1' }
  for (const key of CODEX_HOST_ENVIRONMENT_VARIABLES)
    if (source[key] !== undefined) environment[key] = source[key]
  return environment
}
