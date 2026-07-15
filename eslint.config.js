import js from '@eslint/js'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    files: ['scripts/**'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // .claude/ holds editor-agent skill assets, not app code.
    ignores: ['dist/', 'node_modules/', 'docs/', '.claude/'],
  },
)
