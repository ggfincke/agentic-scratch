// packages/sb3/src/edit-admission/edit-admission-limits.ts
// frozen default & hard resource ceilings for edit admission

export interface EditAdmissionLimits
{
  maxJsonDepth: number
  maxMembersPerContainer: number
  maxJsonNodes: number
  maxTargets: number
  maxBlockRecords: number
  maxScriptRoots: number
  maxDeclarationRecords: number
  maxProcedureParametersPerProcedure: number
  maxProcedureParametersTotal: number
  maxProcedureMutationStringBytes: number
  maxProcedureMutationStringsTotalBytes: number
  maxListItemsPerList: number
  maxMonitorParamsPerMonitor: number
  maxMonitorListSnapshotItemsPerMonitor: number
  maxRuntimeScalarSlots: number
  maxCommentRecords: number
  maxMonitorRecords: number
  maxCostumeRecords: number
  maxCostumesPerTarget: number
  maxSoundRecords: number
  maxSoundsPerTarget: number
  maxIndexedSemanticRecords: number
  maxPngWidth: number
  maxPngHeight: number
  maxPngCanvasPixels: number
  maxPngInflatedSampleBytes: number
  maxApngFrames: number
  maxApngCumulativeFramePixels: number
  maxApngCumulativeInflatedSampleBytes: number
  maxPngReferencePixels: number
  maxPngDecodedRgbaBytes: number
}

export type EditAdmissionLimitOptions = Partial<EditAdmissionLimits>

export const DEFAULT_EDIT_ADMISSION_LIMITS: Readonly<EditAdmissionLimits> =
  Object.freeze({
    maxJsonDepth: 128,
    maxMembersPerContainer: 100_000,
    maxJsonNodes: 2_000_000,
    maxTargets: 256,
    maxBlockRecords: 25_000,
    maxScriptRoots: 4_096,
    maxDeclarationRecords: 4_096,
    maxProcedureParametersPerProcedure: 64,
    maxProcedureParametersTotal: 4_096,
    maxProcedureMutationStringBytes: 128 * 1024,
    maxProcedureMutationStringsTotalBytes: 2 * 1024 * 1024,
    maxListItemsPerList: 25_000,
    maxMonitorParamsPerMonitor: 64,
    maxMonitorListSnapshotItemsPerMonitor: 25_000,
    maxRuntimeScalarSlots: 100_000,
    maxCommentRecords: 4_096,
    maxMonitorRecords: 4_096,
    maxCostumeRecords: 4_096,
    maxCostumesPerTarget: 1_024,
    maxSoundRecords: 2_048,
    maxSoundsPerTarget: 512,
    maxIndexedSemanticRecords: 50_000,
    maxPngWidth: 4_096,
    maxPngHeight: 4_096,
    maxPngCanvasPixels: 16_777_216,
    maxPngInflatedSampleBytes: 64 * 1024 * 1024,
    maxApngFrames: 4_096,
    maxApngCumulativeFramePixels: 134_217_728,
    maxApngCumulativeInflatedSampleBytes: 512 * 1024 * 1024,
    maxPngReferencePixels: 67_108_864,
    maxPngDecodedRgbaBytes: 256 * 1024 * 1024,
  })

export const HARD_EDIT_ADMISSION_LIMITS: Readonly<EditAdmissionLimits> =
  Object.freeze({
    maxJsonDepth: 128,
    maxMembersPerContainer: 100_000,
    maxJsonNodes: 2_000_000,
    maxTargets: 512,
    maxBlockRecords: 50_000,
    maxScriptRoots: 8_192,
    maxDeclarationRecords: 8_192,
    maxProcedureParametersPerProcedure: 128,
    maxProcedureParametersTotal: 8_192,
    maxProcedureMutationStringBytes: 256 * 1024,
    maxProcedureMutationStringsTotalBytes: 4 * 1024 * 1024,
    maxListItemsPerList: 50_000,
    maxMonitorParamsPerMonitor: 128,
    maxMonitorListSnapshotItemsPerMonitor: 50_000,
    maxRuntimeScalarSlots: 250_000,
    maxCommentRecords: 8_192,
    maxMonitorRecords: 8_192,
    maxCostumeRecords: 8_192,
    maxCostumesPerTarget: 2_048,
    maxSoundRecords: 4_096,
    maxSoundsPerTarget: 1_024,
    maxIndexedSemanticRecords: 100_000,
    maxPngWidth: 4_096,
    maxPngHeight: 4_096,
    maxPngCanvasPixels: 16_777_216,
    maxPngInflatedSampleBytes: 64 * 1024 * 1024,
    maxApngFrames: 4_096,
    maxApngCumulativeFramePixels: 134_217_728,
    maxApngCumulativeInflatedSampleBytes: 512 * 1024 * 1024,
    maxPngReferencePixels: 134_217_728,
    maxPngDecodedRgbaBytes: 512 * 1024 * 1024,
  })

export function resolveEditAdmissionLimits(
  options: EditAdmissionLimitOptions = {}
): EditAdmissionLimits
{
  const limits = { ...DEFAULT_EDIT_ADMISSION_LIMITS, ...options }
  for (const key of Object.keys(limits) as Array<keyof EditAdmissionLimits>)
  {
    const value = limits[key]
    const hard = HARD_EDIT_ADMISSION_LIMITS[key]
    if (!Number.isSafeInteger(value) || value < 0 || value > hard)
    {
      throw new RangeError(
        `${key} must be a nonnegative safe integer at most ${hard}`
      )
    }
  }
  return limits
}
