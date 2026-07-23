// packages/ir/src/edit/procedure-parameter-catalog.ts
// one encoding authority for authored Scratch procedure parameter types

export const PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1 = Object.freeze({
  stringOrNumber: Object.freeze({
    placeholder: '%s',
    reporterOpcode: 'argument_reporter_string_number',
    literalPrimitiveTag: 10,
    literalValueMode: 'stringify',
    inputShape: 'round',
    defaultValueMode: 'preserveNumberOrStringify',
  }),
  number: Object.freeze({
    placeholder: '%n',
    reporterOpcode: 'argument_reporter_string_number',
    literalPrimitiveTag: 4,
    literalValueMode: 'preserveNumber',
    inputShape: 'round',
    defaultValueMode: 'coerceNumber',
  }),
  boolean: Object.freeze({
    placeholder: '%b',
    reporterOpcode: 'argument_reporter_boolean',
    literalPrimitiveTag: 10,
    literalValueMode: 'unsupported',
    inputShape: 'boolean',
    defaultValueMode: 'coerceBoolean',
  }),
} as const)

export type ProcedureParameterTypeV1 =
  keyof typeof PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1

type ProcedureParameterPlaceholderV1 = 's' | 'n' | 'b'

const PROCEDURE_PARAMETER_TYPE_BY_PLACEHOLDER_V1 = Object.freeze({
  s: 'stringOrNumber',
  n: 'number',
  b: 'boolean',
} as const satisfies Record<
  ProcedureParameterPlaceholderV1,
  ProcedureParameterTypeV1
>)

export function procedureParameterTypeForPlaceholderV1(
  placeholder: ProcedureParameterPlaceholderV1
): ProcedureParameterTypeV1
{
  return PROCEDURE_PARAMETER_TYPE_BY_PLACEHOLDER_V1[placeholder]
}

export function procedureParameterEncodingForPlaceholderV1(
  placeholder: ProcedureParameterPlaceholderV1
): (typeof PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1)[ProcedureParameterTypeV1]
{
  return PROCEDURE_PARAMETER_ENCODING_BY_TYPE_V1[
    procedureParameterTypeForPlaceholderV1(placeholder)
  ]
}
