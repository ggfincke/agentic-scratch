// eslint-rules/no-jsdoc-blocks.js
// prohibits block comments; use single-line comments only

import { getSourceCode } from './ruleContext.js'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow block comments in favor of single-line comments',
      category: 'Stylistic Issues',
    },
    fixable: null,
    schema: [],
    messages: {
      noJsDoc:
        'Block comments are not allowed. Use single-line comments (//) instead.',
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
          if (comment.type === 'Block')
          {
            context.report({
              loc: comment.loc,
              messageId: 'noJsDoc',
            })
          }
        }
      },
    }
  },
}

export default rule
