// eslint-rules/comment-block-length.js
// enforces max 3 consecutive single-line `//` comments per CLAUDE.md cap

import { getSourceCode } from './ruleContext.js'

const MAX_CONSECUTIVE = 3

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Cap consecutive // comment lines at 3 per CLAUDE.md',
      category: 'Stylistic Issues',
    },
    fixable: null,
    schema: [],
    messages: {
      tooMany:
        'More than {{max}} consecutive `//` comment lines ({{count}}). Condense, relocate rationale to dev-docs/, or break into logical paragraphs.',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)

    return {
      Program()
      {
        const comments = sourceCode.getAllComments()
        const lineComments = comments.filter((c) => c.type === 'Line')

        let runStartIndex = 0

        for (let i = 0; i <= lineComments.length; i++)
        {
          const prev = lineComments[i - 1]
          const curr = lineComments[i]
          const continues =
            prev && curr && curr.loc.start.line === prev.loc.end.line + 1

          if (continues) continue

          const runLength = i - runStartIndex
          if (runLength > MAX_CONSECUTIVE)
          {
            const runStart = lineComments[runStartIndex]
            const runEnd = lineComments[i - 1]
            context.report({
              loc: {
                start: runStart.loc.start,
                end: runEnd.loc.end,
              },
              messageId: 'tooMany',
              data: { max: String(MAX_CONSECUTIVE), count: String(runLength) },
            })
          }
          runStartIndex = i
        }
      },
    }
  },
}

export default rule
