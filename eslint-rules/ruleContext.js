// eslint-rules/ruleContext.js
// context compatibility & comment fixer helpers for local ESLint rules

export const getSourceCode = (context) =>
  context.sourceCode ?? context.getSourceCode()

export const getFilename = (context) =>
  context.filename ?? context.getFilename()

export const getCwd = (context) => context.cwd ?? process.cwd()

export const wrapCommentText = (comment, text) =>
  comment.type === 'Line' ? `//${text}` : `/*${text}*/`
