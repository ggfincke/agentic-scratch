// scripts/lib/codex.ts
// provides behavior-identical codex configuration & trace micro-helpers

export function unknownRecord(
  value: unknown
): Record<string, unknown> | null
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function tomlString(value: string): string
{
  return JSON.stringify(value)
}

export function forbiddenExecutionEvent(type: string): boolean
{
  return (
    type === 'command_execution' ||
    type === 'file_change' ||
    type === 'web_search' ||
    type === 'image_generation' ||
    type.startsWith('computer_') ||
    (type.endsWith('_tool_call') && type !== 'mcp_tool_call')
  )
}
