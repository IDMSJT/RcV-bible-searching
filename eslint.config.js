import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // U+3000 is the space Chinese typesetting uses — it separates an outline
      // marker from its heading and a label from its value. It belongs in the
      // text, so comments and templates are exempt; the rule stays on
      // everywhere else, where one really would be a typo for a plain space.
      'no-irregular-whitespace': ['error', { skipComments: true, skipTemplates: true }],
    },
  },
])
