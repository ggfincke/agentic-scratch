// packages/runner/src/development/viewer-types.ts
// finite retained viewer data & declared collision overlay contracts

import type {
  ProfileNumericSelectorV1,
  ProfileRuntimeFrameV1,
} from './profile-browser-types.js'
import type { RendererGeometryV1 } from '../observation/observation.js'
import type { DevelopmentStatusV1 } from './session.js'
import type { DevelopmentArtifactRefV1, DevelopmentTrace } from './types.js'

export type DevelopmentOverlayValueV1 =
  number | { readonly probe: ProfileNumericSelectorV1 }

export type DevelopmentOverlayV1 = {
  readonly id: string
  readonly label?: string
  readonly purpose: 'declared-collision' | 'debug-region'
  readonly x: DevelopmentOverlayValueV1
  readonly y: DevelopmentOverlayValueV1
} & (
  | {
      readonly kind: 'rectangle'
      readonly width: DevelopmentOverlayValueV1
      readonly height: DevelopmentOverlayValueV1
    }
  | { readonly kind: 'circle'; readonly radius: DevelopmentOverlayValueV1 }
)

export interface DevelopmentCostumeBoundsV1
{
  readonly targetIndex: number
  readonly costumeIndexOneBased: number
  readonly costumeName: string
  readonly width: number
  readonly height: number
  readonly rotationCenterX: number
  readonly rotationCenterY: number
  readonly bitmapResolution: number
}

export interface DevelopmentClipSourceV1
{
  readonly schemaVersion: 1
  readonly kind: 'development-clips-v1'
  readonly sourceSha256: string
  readonly clips: readonly {
    readonly id: string
    readonly name: string
    readonly targetIndex: number
    readonly loop: boolean
    readonly frames: readonly {
      readonly costumeIndexOneBased: number
      readonly durationMs: number
    }[]
  }[]
}

export interface DevelopmentClipPreviewV1
{
  readonly schemaVersion: 1
  readonly kind: 'development-clip-preview-v1'
  readonly sourceSha256: string
  readonly sourceManifestSha256: string
  readonly clips: readonly {
    readonly id: string
    readonly name: string
    readonly targetIndex: number
    readonly loop: boolean
    readonly frames: readonly (DevelopmentCostumeBoundsV1 & {
      readonly durationMs: number
      readonly image: DevelopmentArtifactRefV1
    })[]
  }[]
}

export interface DevelopmentViewerLaneV1
{
  readonly status: DevelopmentStatusV1
  readonly trace: DevelopmentTrace
  readonly costumeBounds: readonly DevelopmentCostumeBoundsV1[]
}

export interface DevelopmentViewerMediaV1
{
  readonly artifact: DevelopmentArtifactRefV1
  readonly dataUrl?: string
  readonly segmentId?: string
  readonly tick?: number
  readonly state?: ProfileRuntimeFrameV1
  readonly geometry?: RendererGeometryV1
}

export interface DevelopmentViewerModelV1
{
  readonly schemaVersion: 1
  readonly kind: 'development-viewer-v1'
  readonly title: string
  readonly primary: DevelopmentViewerLaneV1
  readonly comparison: DevelopmentViewerLaneV1 | null
  readonly overlays: readonly DevelopmentOverlayV1[]
  readonly media: readonly DevelopmentViewerMediaV1[]
  readonly clips: DevelopmentClipPreviewV1 | null
  readonly reproduction: unknown | null
  readonly limitations: readonly string[]
}

export interface DevelopmentViewRequestV1
{
  readonly sessionId: string
  readonly compareSessionId?: string
  readonly overlays?: readonly DevelopmentOverlayV1[]
  readonly clipArtifactKey?: string
  readonly reproductionArtifactKey?: string
  readonly signal?: AbortSignal
}
