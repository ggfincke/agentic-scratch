// eslint-rules/comment-style-guide.js
// enforces `&` instead of "and" & `w/` instead of "with" in comments

import { getSourceCode, wrapCommentText } from './ruleContext.js'

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Enforce comment style abbreviations (& for and, w/ for with)',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [],
    messages: {
      useAmpersand: 'Use "&" instead of "and" in comments',
      useWith: 'Use "w/" instead of "with" in comments',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)

    // skip whole comments holding a url; abbreviating its tokens would corrupt it
    const URL_RE = /[a-z][\w+.-]*:\/\//i

    // lookarounds skip word-internal & slash-path matches (e.g. "command", "/and/")
    const stylePatterns = [
      {
        pattern: /(?<![\w/])and(?![\w/])/gi,
        messageId: 'useAmpersand',
        replacement: '&',
      },
      {
        pattern: /(?<![\w/])with(?![\w/])/gi,
        messageId: 'useWith',
        replacement: 'w/',
      },
    ]

    // apply every abbreviation so a single fix pass fully normalizes the comment
    const applyAll = (text) =>
    {
      let out = text
      for (const { pattern, replacement } of stylePatterns)
      {
        pattern.lastIndex = 0
        out = out.replace(pattern, replacement)
      }
      return out
    }

    return {
      Program()
      {
        const comments = sourceCode.getAllComments()

        for (const comment of comments)
        {
          const text = comment.value
          if (URL_RE.test(text)) continue

          for (const { pattern, messageId } of stylePatterns)
          {
            pattern.lastIndex = 0
            if (!pattern.test(text)) continue

            context.report({
              loc: comment.loc,
              messageId,
              fix(fixer)
              {
                return fixer.replaceText(
                  comment,
                  wrapCommentText(comment, applyAll(text))
                )
              },
            })
          }
        }
      },
    }
  },
}

export default rule
