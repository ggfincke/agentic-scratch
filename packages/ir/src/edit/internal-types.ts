// packages/ir/src/edit/internal-types.ts
// share package-internal conditional utility types

export type Without<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, K>>
  : never
