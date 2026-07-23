// eslint-rules/file-header.test.js
// unit tests for the file-header rule (path, description, shebang, coverage)

import { createRuleTester } from './rule-tester.js'

import rule from './file-header.js'

const ruleTester = createRuleTester()

// the rule derives the repo-relative path via relative(cwd, filename); npm test
// runs node --test from the repo root, so build filenames off process.cwd()
const CWD = process.cwd()
const OPTS = [{ prefixes: ['packages/', 'scripts/'] }]
const REL = 'packages/runner/src/sample.ts'
const FILE = `${CWD}/${REL}`

ruleTester.run('file-header', rule, {
  valid: [
    {
      filename: FILE,
      options: OPTS,
      code: `// ${REL}\n// does a thing\nconst x = 1\n`,
    },
    {
      filename: `${CWD}/eslint-rules/x.ts`,
      options: OPTS,
      code: 'const x = 1\n',
    },
    {
      filename: `${CWD}/scripts/run.ts`,
      options: OPTS,
      code: '#!/usr/bin/env node\n// scripts/run.ts\n// runs the thing\nconst x = 1\n',
    },
  ],
  invalid: [
    {
      filename: FILE,
      options: OPTS,
      code: 'const x = 1\n',
      output: `// ${REL}\n// \n\nconst x = 1\n`,
      errors: [{ messageId: 'missingHeader' }],
    },
    {
      filename: FILE,
      options: OPTS,
      code: `// wrong/path.ts\n// desc\nconst x = 1\n`,
      output: `// ${REL}\n// desc\nconst x = 1\n`,
      errors: [{ messageId: 'invalidPath' }],
    },
    {
      filename: FILE,
      options: OPTS,
      code: `// ${REL}\nconst x = 1\n`,
      errors: [{ messageId: 'missingDescription' }],
    },
  ],
})
