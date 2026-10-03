// packages/ir/src/edit/standard-authoring/sources.ts
// pin independent palette & serialization source identities for reconciliation

import { deepFreeze } from '../support/immutable.js'

export const STANDARD_AUTHORING_PINNED_SOURCES_V2 = deepFreeze([
  {
    path: 'node_modules/scratch-blocks/src/blocks/motion.ts',
    sha256: '7c34edad57c5a81cdf2b4de10a3e3f816bf9dd0326318cbd5a1cfa37b8010198',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/looks.ts',
    sha256: 'e34ee4ab336b2472cb3c8675ed13e056a41c18bca3e26e7409f9c5e2adb2bd2b',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/sound.ts',
    sha256: 'ce255597a0021bf47a35f98b3eeb954d3681bf9ff3fb662f20dd63f0ae0df125',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/event.ts',
    sha256: '7e6670a658aca14be9e9b5c1540c0cf6d9ab375bbb36df5168f333e8686c2316',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/control.ts',
    sha256: 'a0153c4782c339e7069f684b6b2e3bbd29e8995816df6b6cf256462749c77e16',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/sensing.ts',
    sha256: 'ad9a1c2bce0f1447e00249372d96f193183884db20ef7370aad8ea295b500b8f',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/operators.ts',
    sha256: '9466f3a5eddcd0a793f56b801ebfc3fa54a5adea6eceff32a638220f0efd0122',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/data.ts',
    sha256: '2b8ca9f5563482f835d30992eb9c371b64bead60f332e379f70263ce56b608ad',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/extensions/scratch3_pen/index.js',
    sha256: 'b6956da0900e46196ebf61f141995dfb438f76f25387834130e7977aecbad23a',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/extensions/scratch3_music/index.js',
    sha256: '4a74fb7ca5464f4b30e2dc75c829303b710a979027f022f8ee184695df24fbb0',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/extensions/scratch3_video_sensing/index.js',
    sha256: 'a22097a06780de0961c116ad3d0f04b9c0eeda114498c0a0389fa618ea308737',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/serialization/sb2_specmap.js',
    sha256: '09cbbe7b120607fe1c699c1ebb94c1d998b6a9679ba22e07fd692d61a4e64842',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/serialization/sb3.js',
    sha256: '0ada59a402a257eab3a773605bb95797054699d25bf2862c725ff5e329fe7178',
  },
  {
    path: 'node_modules/scratch-blocks/package.json',
    sha256: '9f37c5fe26949bd6c0de0a43fd7c1fbeb825e9f47749c2798cb948c06872afd3',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/package.json',
    sha256: '0c91ac3f3d08d99b262ed6cdd850e560c14bc8206b30027510379bd64499d40f',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/math.ts',
    sha256: '6554b1834fbf284416915fd4a172cc20b449c26309b6497a34a1c04f61836cd2',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/text.ts',
    sha256: 'ffec22c249b7276a3b3f23793f881e2db158e447d51d1a2fa007ce1a39716fd9',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/colour.ts',
    sha256: '8157dc405100ac73598a33e6f5b6d2b2530761e507f0276d288d62a1e32df403',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/note.ts',
    sha256: 'b3537b709a8e45ca36fc646b62e7d738c648f5606fe47f781be6af6bac6866a6',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/matrix.ts',
    sha256: 'b206f2f57c23c997445a7cf43e5a4b4b23a76a1632829067cc4137b992805da5',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/procedures.ts',
    sha256: '8cc7224686dcd8deaec027d645a05649b5dde3978cea93101ef1dd06f1b1b9a2',
  },
  {
    path: 'node_modules/scratch-blocks/src/blocks/vertical_extensions.ts',
    sha256: '1da38b103b2e0dee720e8c7bd5c1ea91c7ff34eefef53b78361b6932331ff35c',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/blocks/scratch3_sound.js',
    sha256: '8f73f7f1055e3888f5d02c59fe27169116726e13654dd29052e3919fd4830b86',
  },
  {
    path: 'node_modules/@scratch/scratch-vm/src/engine/runtime.js',
    sha256: 'fc30983d1213ba4c0053086464045f26e2cc0abb7957361d3e6054179aae2d78',
  },
] as const)

export const STANDARD_AUTHORING_PINNED_PACKAGES_V2 = deepFreeze([
  {
    package: 'scratch-blocks',
    version: '2.1.19',
  },
  {
    package: '@scratch/scratch-vm',
    version: '15.1.0',
  },
] as const)
