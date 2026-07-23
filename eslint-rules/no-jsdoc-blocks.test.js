// eslint-rules/no-jsdoc-blocks.test.js
// unit tests for the no-jsdoc-blocks rule

import { createRuleTester } from './rule-tester.js'

import rule from './no-jsdoc-blocks.js'

const ruleTester = createRuleTester()

ruleTester.run('no-jsdoc-blocks', rule, {
  valid: [{ code: '// a line comment\nconst x = 1\n' }],
  invalid: [
    {
      code: '/* a plain block */\nconst x = 1\n',
      errors: [{ messageId: 'noJsDoc' }],
    },
  ],
})
