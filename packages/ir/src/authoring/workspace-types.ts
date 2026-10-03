// packages/ir/src/authoring/workspace-types.ts
// describe logical workspace sources & immutable whole-project build evidence

import type {
  AudioDecoderIdentityV1,
  AudioNormalizationSettingsV1,
  DerivedSoundAssetIdentity,
  PngFrameEditsV2,
  PngPivotV2,
  PngRectangleV2,
  PngSheetSlicingV2,
  PngTransformV2,
} from '@scratch-agent/sb3'
import type {
  ProcedureSignatureV1,
  SemanticSpecialInputV1,
} from '../edit/contracts.generated.js'
import type { ProjectIR } from '../project/project-ir.js'
import type { ProjectDelta } from '../project/project-delta.js'
import type {
  AnimationClipV2,
  ResolvedAnimationClipV2,
} from './animation-clips.js'

export type WorkspaceScalarV2 = string | number | boolean
export interface WorkspaceRuntimeTargetV2
{
  readonly schemaVersion: 1
  readonly runtime: 'scratch-official' | 'turbowarp'
  readonly scheduler: 'deterministic' | 'natural'
  readonly tickRate: 30 | 60
}
export interface WorkspaceSourceReferenceV2
{
  readonly path: string
  readonly expectedSha256?: string
}
export type WorkspaceAssetV2 =
  | {
      readonly id: string
      readonly kind: 'costume'
      readonly source: WorkspaceSourceReferenceV2
      readonly slice?: PngRectangleV2
      readonly pivot?: PngPivotV2
      readonly transforms?: readonly PngTransformV2[]
    }
  | {
      readonly id: string
      readonly kind: 'costumeSheet'
      readonly source: WorkspaceSourceReferenceV2
      readonly slicing: PngSheetSlicingV2
      readonly frames: readonly (PngFrameEditsV2 & { readonly id: string })[]
    }
  | {
      readonly id: string
      readonly kind: 'sound'
      readonly source: WorkspaceSourceReferenceV2
      readonly format: 'wav' | 'mp3'
      readonly sampleRate?: number
      readonly channels?: 1 | 2
    }
export type WorkspaceDeclarationV2 =
  | {
      readonly id: string
      readonly kind: 'variable'
      readonly name: string
      readonly initialValue?: WorkspaceScalarV2
      readonly existing?: { readonly expectedSemanticFingerprintSha256: string }
    }
  | {
      readonly id: string
      readonly kind: 'list'
      readonly name: string
      readonly initialItems?: readonly WorkspaceScalarV2[]
      readonly existing?: { readonly expectedSemanticFingerprintSha256: string }
    }
  | {
      readonly id: string
      readonly kind: 'broadcast'
      readonly name: string
      readonly existing?: { readonly expectedSemanticFingerprintSha256: string }
    }
export interface WorkspaceTargetV2
{
  readonly id: string
  readonly kind: 'stage' | 'sprite'
  readonly name: string
  readonly existing?: { readonly expectedSemanticFingerprintSha256: string }
  readonly logicMode?: 'append' | 'replace'
  readonly declarations?: readonly WorkspaceDeclarationV2[]
  readonly costumes?: readonly {
    readonly assetId: string
    readonly name: string
    readonly pivot?: PngPivotV2
  }[]
  readonly sounds?: readonly {
    readonly assetId: string
    readonly name: string
  }[]
  readonly procedures?: readonly {
    readonly id: string
    readonly path: string
  }[]
  readonly scripts?: readonly { readonly id: string; readonly path: string }[]
  readonly properties?: Readonly<Record<string, WorkspaceScalarV2>>
  readonly currentCostume?: string
}
export interface WorkspaceLogicalReferenceV2
{
  readonly entityKind: 'target' | 'declaration' | 'media'
  readonly id: string
}
export type WorkspaceFieldValueV2 =
  | {
      readonly valueKind: 'entity'
      readonly value: WorkspaceLogicalReferenceV2
    }
  | {
      readonly valueKind: 'text' | 'number' | 'boolean' | 'enum'
      readonly value: WorkspaceScalarV2
    }
export type WorkspaceInputValueV2 =
  | { readonly valueKind: 'literal'; readonly value: WorkspaceScalarV2 }
  | {
      readonly valueKind: 'entity'
      readonly value: WorkspaceLogicalReferenceV2
    }
  | { readonly valueKind: 'special'; readonly value: SemanticSpecialInputV1 }
  | { readonly valueKind: 'block'; readonly value: WorkspaceBlockV2 }
  | {
      readonly valueKind: 'statementSequence'
      readonly value: WorkspaceSequenceV2
    }
  | { readonly valueKind: 'empty' }
export type WorkspaceBlockV2 =
  | {
      readonly nodeKind: 'ordinary'
      readonly opcode: string
      readonly localAlias?: string
      readonly fields: readonly {
        readonly name: string
        readonly value: WorkspaceFieldValueV2
      }[]
      readonly inputs: readonly {
        readonly name: string
        readonly value: WorkspaceInputValueV2
      }[]
    }
  | {
      readonly nodeKind: 'procedureCall'
      readonly procedureId: string
      readonly localAlias?: string
      readonly arguments: readonly {
        readonly parameterId: string
        readonly value: WorkspaceInputValueV2
      }[]
    }
  | {
      readonly nodeKind: 'parameterReporter'
      readonly parameterId: string
      readonly localAlias?: string
    }
export interface WorkspaceSequenceV2
{
  readonly blocks: readonly WorkspaceBlockV2[]
}
export type WorkspaceScriptRootV2 =
  | {
      readonly rootKind: 'eventScript'
      readonly hat: WorkspaceBlockV2
      readonly body?: WorkspaceSequenceV2
    }
  | {
      readonly rootKind: 'statementSequence'
      readonly value: WorkspaceSequenceV2
    }
  | { readonly rootKind: 'expression'; readonly value: WorkspaceBlockV2 }
export interface WorkspaceScriptFileV2
{
  readonly schemaVersion: 2
  readonly kind: 'script'
  readonly root: WorkspaceScriptRootV2
  readonly workspace?: { readonly x: number; readonly y: number }
}
export interface WorkspaceProcedureFileV2
{
  readonly schemaVersion: 2
  readonly kind: 'procedure'
  readonly signature: ProcedureSignatureV1
  readonly body?: WorkspaceSequenceV2
  readonly workspace?: { readonly x: number; readonly y: number }
}
export interface ScratchWorkspaceManifestV2
{
  readonly schemaVersion: 2
  readonly baseline:
    | { readonly kind: 'greenfield' }
    | {
        readonly kind: 'selectedProject'
        readonly path: string
        readonly expectedArtifactSha256: string
      }
  readonly targets: readonly WorkspaceTargetV2[]
  readonly assets?: readonly WorkspaceAssetV2[]
  readonly clips?: readonly (AnimationClipV2 & { readonly targetId: string })[]
  readonly assetManifestPaths?: readonly string[]
  readonly clipManifestPaths?: readonly string[]
  readonly runtimeTargets?: readonly WorkspaceRuntimeTargetV2[]
  readonly scenarios?: readonly {
    readonly id: string
    readonly scenario: unknown
  }[]
  readonly assertions?: readonly {
    readonly scenarioId: string
    readonly assertion: unknown
  }[]
  readonly output?: { readonly path: string }
}
export interface WorkspaceSourceFileV2
{
  readonly path: string
  readonly bytes: Uint8Array
  readonly parsedJSON?: unknown
}
export type WorkspacePreparedAssetV2 = {
  readonly logicalAssetId: string
  readonly bytes: Uint8Array
  readonly sourceSha256: string
  readonly transformSha256: string
  readonly outputSha256: string
} & (
  | {
      readonly kind: 'costume'
      readonly metadata: {
        readonly width: number
        readonly height: number
        readonly pivot: Readonly<PngPivotV2>
        readonly md5ext: string
        readonly bitmapResolution: 1
        readonly dataFormat: 'png'
      }
    }
  | {
      readonly kind: 'sound'
      readonly metadata: {
        readonly identity: DerivedSoundAssetIdentity
        readonly settings: AudioNormalizationSettingsV1
        readonly decoder: AudioDecoderIdentityV1
      }
    }
)
export interface WorkspaceCompilationInputV2
{
  readonly manifest: ScratchWorkspaceManifestV2
  readonly files: readonly WorkspaceSourceFileV2[]
  readonly baselineBytes: Uint8Array
  readonly preparedAssets: readonly WorkspacePreparedAssetV2[]
  readonly compilerIdentitySha256?: string
  readonly preprocessingCosts?: {
    readonly pixelVisits: number
    readonly peakDecodedBytes: number
  }
  readonly limits?: Partial<WorkspaceBuildLimitsV2>
}
export interface WorkspaceBuildLimitsV2
{
  readonly maximumTargets: number
  readonly maximumBlocks: number
  readonly maximumScripts: number
  readonly maximumDeclarations: number
  readonly maximumCostumes: number
  readonly maximumCostumesPerTarget: number
  readonly maximumAssetBytes: number
  readonly maximumSb3Bytes: number
  readonly maximumProjectJsonBytes: number
  readonly maximumDecodedCostumeBytes: number
  readonly maximumSourceBytes: number
}
export interface WorkspaceBuildPlanV2
{
  readonly schemaVersion: 2
  readonly kind: 'scratch-workspace-build'
  readonly manifestSha256: string
  readonly baselineArtifactSha256: string
  readonly sourceSetSha256: string
  readonly standardAuthoritySha256: string
  readonly compilerIdentitySha256: string
  readonly candidateSha256: string
  readonly planSha256: string
  readonly sourceFiles: readonly {
    readonly path: string
    readonly sha256: string
    readonly byteLength: number
  }[]
  readonly preparedAssets: readonly {
    readonly logicalAssetId: string
    readonly kind: 'costume' | 'sound'
    readonly sourceSha256: string
    readonly transformSha256: string
    readonly outputSha256: string
  }[]
  readonly resolvedReferences: readonly {
    readonly entityKind: string
    readonly logicalId: string
    readonly targetIndex: number
    readonly serializedIdentity: string
    readonly displayName: string
  }[]
  readonly operationOrder: readonly {
    readonly kind: string
    readonly logicalId: string
    readonly targetIndex: number
  }[]
  readonly clips: readonly ResolvedAnimationClipV2[]
  readonly runtimeTargets: readonly WorkspaceRuntimeTargetV2[]
  readonly scenarios: readonly {
    readonly id: string
    readonly scenario: unknown
  }[]
  readonly assertions: readonly {
    readonly scenarioId: string
    readonly assertion: unknown
  }[]
  readonly costs: Readonly<Record<string, number>>
  readonly limits: Readonly<WorkspaceBuildLimitsV2>
  readonly diffSha256: string
}
export interface WorkspaceCompilationResultV2
{
  readonly manifest: ScratchWorkspaceManifestV2
  readonly plan: WorkspaceBuildPlanV2
  readonly candidate: ProjectIR
  readonly candidateBytes: Uint8Array
  readonly diff: ProjectDelta
}
