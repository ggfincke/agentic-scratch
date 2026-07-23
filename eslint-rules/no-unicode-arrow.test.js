// eslint-rules/no-unicode-arrow.test.js
// unit tests for the no-unicode-arrow rule

import { createRuleTester } from './rule-tester.js'

import rule from './no-unicode-arrow.js'

const ruleTester = createRuleTester()

ruleTester.run('no-unicode-arrow', rule, {
  valid: [{ code: '// maps a -> b\nconst x = 1\n' }],
  invalid: [
    {
      code: '// maps a → b\nconst x = 1\n',
      output: '// maps a -> b\nconst x = 1\n',
      errors: [{ messageId: 'noUnicodeArrow' }],
    },
  ],
})
