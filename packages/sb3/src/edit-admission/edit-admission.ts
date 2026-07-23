// packages/sb3/src/edit-admission/edit-admission.ts
// opt-in ordered source admission before semantic indexing or runtime load

import {
  admitSb3,
  type AdmitOptions,
  type Asset,
  type Sb3Admission,
} from '../admission/admission.js'
import {
  resolveEditAdmissionLimits,
  type EditAdmissionLimitOptions,
  type EditAdmissionLimits,
} from './edit-admission-limits.js'
import {
  DEFAULT_SB3_LIMITS,
  resolveSb3Limits,
  type Sb3Limits,
} from '../admission/limits.js'
import {
  validateEditProjectShape,
  type EditProjectCounts,
} from './edit-project-shape.js'
import {
  MEDIA_CLASSIFICATION_CODES,
  MediaClassificationError,
  classifyProjectMedia,
  type ProjectMediaAdmission,
} from '../media/media.js'
import { scanStrictJson, type StrictJsonMetrics } from '../json/strict-json.js'
import type { ProjectJson } from '../json/project-json.js'

export const EDIT_SB3_ADMISSION_BRAND: unique symbol = Symbol(
  'scratch-agent.edit-sb3-admission-v1'
)

export const EDIT_ADMISSION_STAGES = [
  'archive',
  'raw-json',
  'project-shape-and-counts',
  'media',
  'complete',
] as const

export type EditAdmissionStage = (typeof EDIT_ADMISSION_STAGES)[number]
type EditAdmissionStageStatus = 'started' | 'completed'

interface EditAdmissionStageEvent
{
  stage: EditAdmissionStage
  status: EditAdmissionStageStatus
  sequence: number
}

interface EditSb3AdmissionOptions extends AdmitOptions
{
  editLimits?: EditAdmissionLimitOptions
  onStage?: (event: EditAdmissionStageEvent) => void
}

export interface EditSb3Admission
{
  readonly [EDIT_SB3_ADMISSION_BRAND]: true
  project: ProjectJson
  projectJsonText: string
  assets: Asset[]
  archive: Sb3Admission
  limits: EditAdmissionLimits
  jsonMetrics: StrictJsonMetrics
  projectCounts: EditProjectCounts
  media: ProjectMediaAdmission
  completedStages: readonly EditAdmissionStage[]
}

class EditSb3AdmissionError extends Error
{
  readonly stage: EditAdmissionStage
  readonly completedStages: readonly EditAdmissionStage[]
  readonly detailCode: string | undefined

  constructor(
    stage: EditAdmissionStage,
    completedStages: readonly EditAdmissionStage[],
    cause: unknown
  )
  {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`Phase 8 edit admission failed during ${stage}: ${detail}`, { cause })
    this.name = 'EditSb3AdmissionError'
    this.stage = stage
    this.completedStages = [...completedStages]
    this.detailCode =
      cause !== null &&
      typeof cause === 'object' &&
      'code' in cause &&
      typeof cause.code === 'string'
        ? cause.code
        : undefined
  }
}

function resolveEditArchiveLimits(options: AdmitOptions['limits']): Sb3Limits
{
  const limits = resolveSb3Limits(options)
  for (const key of Object.keys(limits) as Array<keyof Sb3Limits>)
  {
    if (limits[key] > DEFAULT_SB3_LIMITS[key])
    {
      throw new RangeError(
        `Phase 8 ${key} cannot exceed ${DEFAULT_SB3_LIMITS[key]}`
      )
    }
  }
  return limits
}

export function isEditSb3Admission(value: unknown): value is EditSb3Admission
{
  if (value === null || typeof value !== 'object') return false
  const brand = Object.getOwnPropertyDescriptor(value, EDIT_SB3_ADMISSION_BRAND)
  return brand?.enumerable === true && 'value' in brand && brand.value === true
}

export async function admitSb3ForEdit(
  bytes: Uint8Array,
  options: EditSb3AdmissionOptions = {}
): Promise<EditSb3Admission>
{
  const completed: EditAdmissionStage[] = []
  let sequence = 0
  const emit = (
    stage: EditAdmissionStage,
    status: EditAdmissionStageStatus
  ): void =>
  {
    options.onStage?.({ stage, status, sequence: sequence++ })
  }
  const run = async <T>(
    stage: EditAdmissionStage,
    operation: () => T | Promise<T>
  ): Promise<T> =>
  {
    emit(stage, 'started')
    try
    {
      const value = await operation()
      completed.push(stage)
      emit(stage, 'completed')
      return value
    }
    catch (cause)
    {
      throw new EditSb3AdmissionError(stage, completed, cause)
    }
  }

  const limits = resolveEditAdmissionLimits(options.editLimits)
  const archiveLimits = resolveEditArchiveLimits(options.limits)
  const archive = await run('archive', () =>
    admitSb3(bytes, { limits: archiveLimits })
  )
  const scanned = await run('raw-json', () =>
    scanStrictJson(archive.projectJsonText, {
      maxDepth: limits.maxJsonDepth,
      maxMembersPerContainer: limits.maxMembersPerContainer,
      maxNodes: limits.maxJsonNodes,
    })
  )
  const shaped = await run('project-shape-and-counts', () =>
    validateEditProjectShape(scanned.value, limits)
  )
  const media = await run('media', async () =>
  {
    const classified = await classifyProjectMedia(
      shaped.project,
      archive.assets,
      limits
    )
    if (classified.missingReferencedAssetPaths.length > 0)
    {
      throw new MediaClassificationError(
        MEDIA_CLASSIFICATION_CODES.referencedAssetMissing,
        `referenced assets are missing: ${classified.missingReferencedAssetPaths.join(', ')}`
      )
    }
    return classified
  })
  await run('complete', () => undefined)
  return {
    [EDIT_SB3_ADMISSION_BRAND]: true,
    project: shaped.project,
    projectJsonText: archive.projectJsonText,
    assets: archive.assets,
    archive,
    limits,
    jsonMetrics: scanned.metrics,
    projectCounts: shaped.counts,
    media,
    completedStages: [...completed],
  }
}
