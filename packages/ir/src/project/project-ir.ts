// packages/ir/src/project/project-ir.ts
// the Scratch IR: a typed, editable view over a faithfully-carried project.json + assets
// import .sb3 -> edit -> export .sb3 w/o dropping any field (carry, never reconstruct)

import {
  normalizeAssetsByPath,
  packSb3,
  unpackSb3,
  type Asset,
  type ProjectJson,
  type SpriteTarget,
  type Target,
  type UnpackOptions,
} from '@scratch-agent/sb3'

import { TargetIR } from './target-ir.js'
import {
  collectEditUidCollisionUniverse,
  Uids,
  type UidSnapshot,
} from '../core/uid.js'

// * the project IR — source of truth is `json` (the parsed project.json, mutated in place)
export class ProjectIR
{
  readonly uids: Uids

  private constructor(
    readonly json: ProjectJson,
    readonly assets: Asset[] = [],
    uids?: Uids
  )
  {
    this.uids = uids ?? new Uids(collectEditUidCollisionUniverse(json))
  }

  static fromProjectJson(json: ProjectJson, assets: Asset[] = []): ProjectIR
  {
    return new ProjectIR(json, assets)
  }

  static fromProjectJsonWithUidSnapshot(
    json: ProjectJson,
    assets: Asset[],
    snapshot: UidSnapshot
  ): ProjectIR
  {
    const allocator = Uids.fromSnapshot(snapshot)
    for (const id of collectEditUidCollisionUniverse(json))
    {
      if (!allocator.has(id))
        throw new Error(`current project ID is absent from UID snapshot: ${id}`)
    }
    return new ProjectIR(json, assets, allocator)
  }

  static async fromSb3(
    bytes: Uint8Array,
    options: UnpackOptions = {}
  ): Promise<ProjectIR>
  {
    const { projectJsonText, assets } = await unpackSb3(bytes, options)
    return new ProjectIR(JSON.parse(projectJsonText) as ProjectJson, assets)
  }

  // ! returns the live source-of-truth object, not a clone; mutating it mutates the IR
  toProjectJson(): ProjectJson
  {
    return this.json
  }

  toProjectJsonText(): string
  {
    return JSON.stringify(this.json)
  }

  toSb3(): Promise<Uint8Array>
  {
    return packSb3(this.toProjectJsonText(), this.assets)
  }

  private wrap(target: Target): TargetIR
  {
    return new TargetIR(target, this.uids, (asset) => this.addAsset(asset))
  }

  get targets(): TargetIR[]
  {
    return this.json.targets.map((target) => this.wrap(target))
  }

  get stage(): TargetIR | undefined
  {
    const target = this.json.targets.find((t) => t.isStage)
    return target ? this.wrap(target) : undefined
  }

  sprites(): TargetIR[]
  {
    return this.json.targets
      .filter((t) => !t.isStage)
      .map((target) => this.wrap(target))
  }

  target(name: string): TargetIR | undefined
  {
    const target = this.json.targets.find((t) => t.name === name)
    return target ? this.wrap(target) : undefined
  }

  addAsset(asset: Asset): void
  {
    const current = this.assets.find((entry) => entry.path === asset.path)
    if (current)
    {
      normalizeAssetsByPath([current, asset])
      return
    }
    this.assets.push(asset)
  }

  // append a new sprite (minimal valid target) & return its editing view
  addSprite(name: string, init: Partial<SpriteTarget> = {}): TargetIR
  {
    const sprite: SpriteTarget = {
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [],
      sounds: [],
      volume: 100,
      layerOrder: this.json.targets.length,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: 'all around',
      ...init,
      // forced last so init can't break the sprite invariant (e.g. isStage:true)
      isStage: false,
      name,
    }
    this.json.targets.push(sprite)
    return this.wrap(sprite)
  }
}
