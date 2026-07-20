import js from '@eslint/js'
import ts from 'typescript-eslint'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'

export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  ...svelte.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
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
  // Type-aware linting through svelte-eslint-parser is where flat configs
  // break down (the parser can't feed typed info back through the Svelte
  // block structure) -- the .ts core is where the type-aware value lives,
  // so Svelte files are deliberately scoped out of the typed rule set.
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    ...ts.configs.disableTypeChecked,
  },
  // Scripts/config JS files aren't part of the app's tsconfig project
  // graph (they're plain Node JS or standalone config), so they're
  // deliberately scoped out of type-aware rules too.
  {
    files: ['**/*.mjs', '**/*.mts', '**/*.js', 'eslint.config.js'],
    ...ts.configs.disableTypeChecked,
  },
  {
    // .claude/ holds editor-agent skill assets, not app code.
    ignores: ['dist/', 'node_modules/', 'docs/', '.claude/'],
  },
)
