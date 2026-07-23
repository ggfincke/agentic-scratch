// eslint.config.js
// ESLint flat config: JS recommended, TypeScript, & ggfincke comment-style rules
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettierConfig from 'eslint-config-prettier'
import localRules from './eslint-rules/index.js'

const commentStyleRules = {
  'ggfincke/no-jsdoc-blocks': 'error',
  'ggfincke/comment-style-guide': 'warn',
  'ggfincke/comment-block-length': 'error',
  'ggfincke/no-unicode-arrow': 'error',
  'no-inline-comments': 'error',
}

export default defineConfig([
  globalIgnores(['**/dist', 'runs', '.tmp', 'fixtures/**', 'dev-docs/**']),
  {
    files: ['packages/**/*.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      prettierConfig,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      ggfincke: localRules,
    },
    rules: {
      ...commentStyleRules,
      'ggfincke/file-header': [
        'error',
        { prefixes: ['packages/', 'scripts/', 'tests/'] },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // browser-runner page code executes in the browser, not node
    files: ['packages/runner/src/browser/**/*.ts'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['scripts/**/*.{mjs,js}'],
    extends: [js.configs.recommended, prettierConfig],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    plugins: {
      ggfincke: localRules,
    },
    rules: {
      ...commentStyleRules,
      'ggfincke/file-header': ['error', { prefixes: ['scripts/'] }],
    },
  },
])
