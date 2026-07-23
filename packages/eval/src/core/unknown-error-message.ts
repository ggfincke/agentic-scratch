// packages/eval/src/core/unknown-error-message.ts
// convert unknown thrown values to their stable message text

export function unknownErrorMessage(error: unknown): string
{
  return error instanceof Error ? error.message : String(error)
}
