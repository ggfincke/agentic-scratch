// eslint-rules/no-unicode-arrow.js
// bans the Unicode right arrow (U+2192) in comments; use ASCII -> per CLAUDE.md

import { getSourceCode, wrapCommentText } from './ruleContext.js'

const UNICODE_ARROW = '→'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow Unicode arrow → in comments; use ASCII -> instead',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [],
    messages: {
      noUnicodeArrow: 'Use ASCII `->` instead of Unicode `→` in comments.',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)

    return {
      Program()
      {
        const comments = sourceCode.getAllComments()

        for (const comment of comments)
        {
          if (!comment.value.includes(UNICODE_ARROW)) continue

          context.report({
            loc: comment.loc,
            messageId: 'noUnicodeArrow',
            fix(fixer)
            {
              const replaced = comment.value.split(UNICODE_ARROW).join('->')
              return fixer.replaceText(
                comment,
                wrapCommentText(comment, replaced)
              )
            },
          })
        }
      },
    }
  },
}

export default rule
