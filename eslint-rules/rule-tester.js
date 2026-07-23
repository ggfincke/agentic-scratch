// eslint-rules/rule-tester.js
// creates the shared node test adapter for eslint rules

import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'

RuleTester.describe = describe
RuleTester.it = it

export function createRuleTester()
{
  return new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  })
}
