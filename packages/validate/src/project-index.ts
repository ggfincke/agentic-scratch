// packages/validate/src/project-index.ts
// compatibility adapter for the IR-owned semantic reference index

export {
  buildProjectReferenceIndex as buildIndex,
  isProjectReferenceBlock as isBlock,
  parseMutationArray,
  ProjectReferenceIndex as ProjectIndex,
} from '@scratch-agent/ir'
export type { ProjectReferenceTargetIndex as TargetIndex } from '@scratch-agent/ir'
