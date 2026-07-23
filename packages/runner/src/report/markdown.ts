// packages/runner/src/report/markdown.ts
// tiny Markdown rendering helpers for inert project-controlled text

function longestBacktickRun(text: string): number
{
  let longest = 0
  let current = 0
  for (const ch of text)
  {
    if (ch === '`')
    {
      current++
      if (current > longest) longest = current
    }
    else
    {
      current = 0
    }
  }
  return longest
}

export function mdCode(value: unknown): string
{
  const text = String(value)
  const ticks = '`'.repeat(Math.max(longestBacktickRun(text) + 1, 1))
  const needsPadding =
    text.startsWith('`') ||
    text.endsWith('`') ||
    text.startsWith(' ') ||
    text.endsWith(' ')
  const body = needsPadding ? ` ${text} ` : text
  return `${ticks}${body}${ticks}`
}
