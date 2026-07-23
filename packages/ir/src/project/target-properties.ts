// packages/ir/src/project/target-properties.ts
// define target-property value domains & target applicability for repairs

export const ROTATION_STYLES = [
  'all around',
  'left-right',
  "don't rotate",
] as const

export type RotationStyle = (typeof ROTATION_STYLES)[number]

export interface TargetPropertyValues
{
  x: number
  y: number
  direction: number
  size: number
  visible: boolean
  currentCostume: number
  rotationStyle: RotationStyle
  draggable: boolean
  volume: number
}

export type TargetProperty = keyof TargetPropertyValues

type TargetPropertyDescriptor =
  | {
      valueType: 'number' | 'boolean'
      target: 'all' | 'sprite'
    }
  | {
      valueType: 'rotation-style'
      target: 'sprite'
      values: typeof ROTATION_STYLES
    }

export const TARGET_PROPERTY_DESCRIPTORS = {
  x: { valueType: 'number', target: 'sprite' },
  y: { valueType: 'number', target: 'sprite' },
  direction: { valueType: 'number', target: 'sprite' },
  size: { valueType: 'number', target: 'sprite' },
  visible: { valueType: 'boolean', target: 'sprite' },
  currentCostume: { valueType: 'number', target: 'all' },
  rotationStyle: {
    valueType: 'rotation-style',
    target: 'sprite',
    values: ROTATION_STYLES,
  },
  draggable: { valueType: 'boolean', target: 'sprite' },
  volume: { valueType: 'number', target: 'all' },
} as const satisfies Record<TargetProperty, TargetPropertyDescriptor>

export const TARGET_PROPERTIES: readonly TargetProperty[] = Object.keys(
  TARGET_PROPERTY_DESCRIPTORS
) as TargetProperty[]

export function isTargetProperty(value: string): value is TargetProperty
{
  return Object.hasOwn(TARGET_PROPERTY_DESCRIPTORS, value)
}

export function isTargetPropertyValue<K extends TargetProperty>(
  property: K,
  value: unknown
): value is TargetPropertyValues[K]
{
  const descriptor = TARGET_PROPERTY_DESCRIPTORS[property]
  if (descriptor.valueType === 'number')
  {
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (descriptor.valueType === 'boolean') return typeof value === 'boolean'
  return (descriptor.values as readonly unknown[]).includes(value)
}
