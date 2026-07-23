// eslint-rules/comment-style-guide.test.js
// unit tests for the comment-style-guide rule (abbreviations & url/word safety)

import { createRuleTester } from './rule-tester.js'

import rule from './comment-style-guide.js'

const ruleTester = createRuleTester()

ruleTester.run('comment-style-guide', rule, {
  valid: [
    { code: '// uses & not the spelled word\nconst x = 1\n' },
    { code: '// path /and/with stays untouched\nconst x = 1\n' },
    { code: '// command bandwidth within scope\nconst x = 1\n' },
    { code: '// see https://example.com/foo-and-bar?with=1\nconst x = 1\n' },
  ],
  invalid: [
    {
      code: '// load and run\nconst x = 1\n',
      output: '// load & run\nconst x = 1\n',
      errors: [{ messageId: 'useAmpersand' }],
    },
    {
      code: '// done with care\nconst x = 1\n',
      output: '// done w/ care\nconst x = 1\n',
      errors: [{ messageId: 'useWith' }],
    },
    {
      code: '// and with\nconst x = 1\n',
      output: '// & w/\nconst x = 1\n',
      errors: [{ messageId: 'useAmpersand' }, { messageId: 'useWith' }],
    },
  ],
})
