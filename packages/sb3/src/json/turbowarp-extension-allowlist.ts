// packages/sb3/src/json/turbowarp-extension-allowlist.ts
// pin the TurboWarp gallery extensions an opted-in project may reference

export interface TurboWarpExtensionAllowlistEntryV1
{
  readonly id: string
  readonly url: string
  readonly scriptSha256: string
}

// * the script shas pin the vendored bytes; re-vendoring re-pins them here
export const TURBOWARP_EXTENSION_ALLOWLIST_V1: readonly TurboWarpExtensionAllowlistEntryV1[] =
  Object.freeze(
    [
      {
        id: 'Gamepad',
        url: 'https://extensions.turbowarp.org/gamepad.js',
        scriptSha256:
          '595b411c4237defb65662ea131be4e10d52129223fdcbf70b5f637b1a20c3c58',
      },
      {
        id: 'localstorage',
        url: 'https://extensions.turbowarp.org/local-storage.js',
        scriptSha256:
          '5f1e4d25728b8c2d10886a5d0c4553bfe2d8c7f6818df019a1c0a9493ea8d78c',
      },
    ].map((entry) => Object.freeze(entry))
  )
