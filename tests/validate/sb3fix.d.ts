// tests/validate/sb3fix.d.ts
// minimal surface types for the untyped CJS @turbowarp/sb3fix package

declare module '@turbowarp/sb3fix'
{
  interface FixOptions
  {
    platform?: 'scratch' | 'turbowarp'
    logCallback?: (message: string) => void
  }
  // mutates parsed objects in place & returns them; strings are parsed first
  export function fixJSON(
    data: unknown,
    options?: FixOptions
  ): Record<string, unknown>
  const sb3fix: { fixJSON: typeof fixJSON }
  export default sb3fix
}
