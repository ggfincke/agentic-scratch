// eslint-rules/file-header.js
// validates repo-relative file headers with a non-empty description line

import { isAbsolute, relative } from 'node:path'

import { getCwd, getFilename, getSourceCode } from './ruleContext.js'

const DEFAULT_PREFIXES = ['packages/', 'scripts/']

const normalizePath = (value) => value.replace(/\\/g, '/')

const resolveRelativePath = (filename, cwd, prefixes) =>
{
  const repoRelative = normalizePath(
    isAbsolute(filename) ? relative(cwd, filename) : filename
  )
  const isCovered = prefixes.some((prefix) => repoRelative.startsWith(prefix))
  if (!isCovered)
  {
    return null
  }
  return repoRelative
}

const rule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce file header comments with path and description',
      category: 'Stylistic Issues',
    },
    fixable: 'code',
    schema: [
      {
        type: 'object',
        properties: {
          prefixes: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingHeader: 'File is missing a header comment with the file path',
      invalidPath:
        'File header path does not match actual file path. Expected: {{ expected }}',
      missingDescription: 'File header is missing a description on line 2',
    },
  },

  create(context)
  {
    const sourceCode = getSourceCode(context)
    const filename = getFilename(context)
    const cwd = getCwd(context)
    const prefixes = context.options[0]?.prefixes ?? DEFAULT_PREFIXES

    return {
      Program(node)
      {
        const comments = sourceCode.getAllComments()
        const firstComment = comments[0]
        // getAllComments() normalizes #! to type 'Shebang'; accept 'Hashbang' too for safety
        const hasShebang =
          firstComment?.type === 'Shebang' || firstComment?.type === 'Hashbang'
        const headerIndex = hasShebang ? 1 : 0
        const headerLine = hasShebang ? 2 : 1
        const descriptionLine = headerLine + 1
        const headerComment = comments[headerIndex]

        const relativePath = resolveRelativePath(filename, cwd, prefixes)
        if (relativePath === null)
        {
          return
        }

        // check if first comment exists & is on line 1
        if (
          !headerComment ||
          headerComment.loc.start.line !== headerLine ||
          headerComment.type !== 'Line'
        )
        {
          context.report({
            node,
            messageId: 'missingHeader',
            fix(fixer)
            {
              if (hasShebang && firstComment)
              {
                return fixer.insertTextAfter(
                  firstComment,
                  `\n// ${relativePath}\n// `
                )
              }
              return fixer.insertTextBefore(node, `// ${relativePath}\n// \n\n`)
            },
          })
          return
        }

        // validate the path in the header
        const headerPath = headerComment.value.trim()
        if (headerPath !== relativePath)
        {
          context.report({
            node: headerComment,
            messageId: 'invalidPath',
            data: { expected: relativePath },
            fix(fixer)
            {
              return fixer.replaceText(headerComment, `// ${relativePath}`)
            },
          })
        }

        // check for description on the line after the path header
        const secondComment = comments[headerIndex + 1]
        if (
          !secondComment ||
          secondComment.loc.start.line !== descriptionLine ||
          secondComment.type !== 'Line' ||
          secondComment.value.trim() === ''
        )
        {
          context.report({
            loc: { line: descriptionLine, column: 0 },
            messageId: 'missingDescription',
          })
        }
      },
    }
  },
}

export default rule
