// eslint-rules/comment-block-length.test.js
// unit tests for the comment-block-length rule

import { createRuleTester } from './rule-tester.js'

import rule from './comment-block-length.js'

const ruleTester = createRuleTester()

ruleTester.run('comment-block-length', rule, {
  valid: [
    { code: '// a\n// b\n// c\nconst x = 1\n' },
    { code: '// a\n// b\nconst x = 1\n// d\n// e\n// f\n' },
  ],
  invalid: [
    {
      code: '// a\n// b\n// c\n// d\nconst x = 1\n',
      errors: [{ messageId: 'tooMany', data: { max: '3', count: '4' } }],
    },
  ],
})
