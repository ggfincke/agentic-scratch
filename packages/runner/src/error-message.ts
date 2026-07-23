// packages/runner/src/error-message.ts
// browser-safe unknown-error to message coercion

export function errorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}
