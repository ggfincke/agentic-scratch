// packages/model/src/admission.ts
// refuse model roles & post-end clocks the executable checker cannot drive

import { createRunIssue, RunnerIssueError } from '@scratch-agent/runner'

import type { Model } from './types.js'

export interface ExecutableModelsV1
{
  readonly programModels: readonly Model[]
  readonly endModels?: readonly Model[]
  readonly userModels?: readonly Model[]
}

export const MODEL_EVALUATION_UNSUPPORTED_CODE_V1 =
  'model.evaluation.unsupported'

function unsupported(message: string): never
{
  throw new RunnerIssueError(
    createRunIssue({
      code: MODEL_EVALUATION_UNSUPPORTED_CODE_V1,
      kind: 'scenario',
      responsibility: 'unsupported',
      message,
    })
  )
}

export function assertExecutableModelsV1(models: ExecutableModelsV1): void
{
  if ((models.userModels?.length ?? 0) > 0)
  {
    unsupported(
      `model "${models.userModels?.[0]?.id ?? 'unknown'}": executable user models are unsupported`
    )
  }
  for (const [role, entries] of [
    ['program', models.programModels],
    ['end', models.endModels ?? []],
  ] as const)
  {
    for (const model of entries)
    {
      if (model.usage === 'user')
      {
        unsupported(
          `model "${model.id}": executable user models are unsupported`
        )
      }
      const edges = new Set(model.edges)
      for (const node of model.nodes.values())
      {
        for (const edge of node.outgoing) edges.add(edge)
      }
      for (const edge of edges)
      {
        for (const check of [...edge.conditions, ...edge.effects])
        {
          if (check.name !== 'TimeAfterEnd') continue
          if (role === 'program')
          {
            unsupported(
              `model "${model.id}": edge "${edge.id}" uses TimeAfterEnd in a program model`
            )
          }
          const delay = Number(check.args[0] ?? '')
          if (!Number.isFinite(delay) || delay > 0)
          {
            unsupported(
              `model "${model.id}": edge "${edge.id}" requires an unsupported post-end delay; end-model TimeAfterEnd must be finite and nonpositive`
            )
          }
        }
      }
    }
  }
}
