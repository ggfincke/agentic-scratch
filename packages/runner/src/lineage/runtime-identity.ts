// packages/runner/src/lineage/runtime-identity.ts
// portable identities for Multimodal execution runtimes & their loaded artifacts

export const RUNTIME_DESCRIPTOR_SCHEMA_VERSION = 1 as const

export type RuntimeKind =
  | 'scratch-vm-node'
  | 'scratch-official-browser'
  | 'turbowarp-browser'
  | 'headless-gl-experiment'

export interface RuntimeComponentV1
{
  name: string
  version: string
  sha256: string | null
  byteLength: number | null
}

export interface RuntimeFileIdentityV1
{
  path: string
  sha256: string
  byteLength: number
}

export interface RuntimeDescriptorV1
{
  schemaVersion: typeof RUNTIME_DESCRIPTOR_SCHEMA_VERSION
  id: string
  kind: RuntimeKind
  configurationSha256: string
  renderer: 'none' | 'scratch-render' | 'turbowarp-renderer' | 'headless-gl'
  compiler: 'enabled' | 'disabled' | 'not-applicable'
  network: 'denied' | 'allowlisted'
  components: RuntimeComponentV1[]
  browser: { name: string; version: string } | null
  bundle: RuntimeFileIdentityV1 | null
  workers: RuntimeFileIdentityV1[]
  environment: {
    node: string
    platform: string
    arch: string
  }
}
