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
import { resolveHardBoundedSb3Limits } from '../admission/limits.js'
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

export function isEditSb3Admission(value: unknown): value is EditSb3Admission
{
  if (value === null || typeof value !== 'object') return false
  const brand = Object.getOwnPropertyDescriptor(value, EDIT_SB3_ADMISSION_BRAND)
  return brand?.enumerable === true && 'value' in brand && brand.value === true
}

// the ordered stage runner: each stage reports start & completion, & a failure names the stage & those completed
function stageRunner(options: Pick<EditSb3AdmissionOptions, 'onStage'>)
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
  return { run, completed }
}

// the stages after the archive, over the project.json text & the assets read w/ it
async function admitContents(
  projectJsonText: string,
  assets: readonly Asset[],
  limits: EditAdmissionLimits,
  run: ReturnType<typeof stageRunner>['run']
)
{
  const scanned = await run('raw-json', () =>
    scanStrictJson(projectJsonText, {
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
      assets,
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
  return { scanned, shaped, media }
}

export async function admitSb3ForEdit(
  bytes: Uint8Array,
  options: EditSb3AdmissionOptions = {}
): Promise<EditSb3Admission>
{
  const { run, completed } = stageRunner(options)
  const limits = resolveEditAdmissionLimits(options.editLimits)
  const archiveLimits = resolveHardBoundedSb3Limits(options.limits)
  const archive = await run('archive', () =>
    admitSb3(bytes, { limits: archiveLimits })
  )
  const { scanned, shaped, media } = await admitContents(
    archive.projectJsonText,
    archive.assets,
    limits,
    run
  )
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

export interface PackedProjectEditAdmission
{
  project: ProjectJson
  limits: EditAdmissionLimits
  jsonMetrics: StrictJsonMetrics
  projectCounts: EditProjectCounts
  media: ProjectMediaAdmission
  completedStages: readonly EditAdmissionStage[]
}

// edit admission of a project packed (packSb3) from exactly this project.json text & these path-normalized assets:
// the archive stage would only read back what the packer just wrote, so it passes as given & the later stages run on
// the parts directly; the caller bounds the archive itself (entry count, sizes) as admitSb3 would
export async function admitPackedProjectForEdit(
  projectJsonText: string,
  assets: readonly Asset[],
  options: Pick<EditSb3AdmissionOptions, 'editLimits' | 'onStage'> = {}
): Promise<PackedProjectEditAdmission>
{
  const { run, completed } = stageRunner(options)
  const limits = resolveEditAdmissionLimits(options.editLimits)
  await run('archive', () => undefined)
  const { scanned, shaped, media } = await admitContents(
    projectJsonText,
    assets,
    limits,
    run
  )
  return {
    project: shaped.project,
    limits,
    jsonMetrics: scanned.metrics,
    projectCounts: shaped.counts,
    media,
    completedStages: [...completed],
  }
}
