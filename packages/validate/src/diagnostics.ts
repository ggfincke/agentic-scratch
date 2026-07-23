// packages/validate/src/diagnostics.ts
// shared diagnostic model: severity, location, & a small collector for checks

export type Severity = 'error' | 'warning' | 'info'

// where a diagnostic points; an unset field widens scope (none set = whole project)
export interface DiagnosticLocation
{
  target?: string
  block?: string
  asset?: string
  monitor?: string
}

export interface Diagnostic
{
  code: string
  severity: Severity
  message: string
  location: DiagnosticLocation
}

// a check pushes findings here; the severity helpers keep call sites terse
export class Diagnostics
{
  readonly list: Diagnostic[] = []

  error(
    code: string,
    message: string,
    location: DiagnosticLocation = {}
  ): void
  {
    this.list.push({ code, severity: 'error', message, location })
  }

  warn(code: string, message: string, location: DiagnosticLocation = {}): void
  {
    this.list.push({ code, severity: 'warning', message, location })
  }

  info(code: string, message: string, location: DiagnosticLocation = {}): void
  {
    this.list.push({ code, severity: 'info', message, location })
  }
}

export interface DiagnosticCounts
{
  error: number
  warning: number
  info: number
}

export function countBySeverity(diags: Diagnostic[]): DiagnosticCounts
{
  const counts: DiagnosticCounts = { error: 0, warning: 0, info: 0 }
  for (const d of diags) counts[d.severity]++
  return counts
}

function formatLocation(loc: DiagnosticLocation): string
{
  const parts: string[] = []
  if (loc.target) parts.push(loc.target)
  if (loc.block) parts.push(`block ${loc.block}`)
  if (loc.asset) parts.push(`asset ${loc.asset}`)
  if (loc.monitor) parts.push(`monitor ${loc.monitor}`)
  return parts.join(' > ')
}

// one-line render: "severity code  message  (target > block)"
export function formatDiagnostic(d: Diagnostic): string
{
  const loc = formatLocation(d.location)
  const where = loc ? `  (${loc})` : ''
  return `${d.severity} ${d.code}  ${d.message}${where}`
}
