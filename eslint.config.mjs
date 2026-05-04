// @ts-check
// eslint.config.mjs — ESLint 10 flat config (replaces .eslintrc.js)
//
// Why .mjs: this project's package.json has no "type":"module", so .js files are
// loaded as CJS. Using .mjs lets us keep export default and import.meta.dirname
// (ESLint's dynamic import() respects the file extension regardless of package type).
import tseslint from 'typescript-eslint';
import preferArrowFunctions from 'eslint-plugin-prefer-arrow-functions';
import jsdoc from 'eslint-plugin-jsdoc';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Ignore patterns (replaces .eslintignore)
  {
    // .cjs fixtures live under src/__tests__/fixtures/ and are loaded by
    // sub-process tests against the compiled lib. They aren't TypeScript and
    // aren't covered by tsconfig, so the type-checked linter chokes on them.
    ignores: ['lib/**', 'coverage/**', 'node_modules/**', 'src/**/fixtures/**'],
  },

  // Base recommended configs
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Project-wide config for source files
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // projectService replaces the old tsconfig.eslint.json approach.
        // allowDefaultProject lets test files (excluded from tsconfig.json) still
        // be processed by type-aware rules using a default compiler context.
        projectService: {
          // allowDefaultProject is needed because tsconfig.json excludes __tests__/
          // (to keep the build clean). The glob must not contain '**' — performance
          // guard enforced by typescript-eslint. Tests live directly in src/__tests/,
          // not nested deeper, so a shallow pattern is exact and fast.
          allowDefaultProject: ['src/__tests__/*.ts'],
          // The default cap is 8; we now have more test files than that. Raise
          // the limit to accommodate the full suite without disabling the guard.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'prefer-arrow-functions': preferArrowFunctions,
      jsdoc: jsdoc,
    },
    rules: {
      // typescript-eslint rules carried forward from .eslintrc.js
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/dot-notation': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/naming-convention': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-shadow': ['error', { hoist: 'all' }],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'error',
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { path: 'always', types: 'prefer-import', lib: 'always' },
      ],
      '@typescript-eslint/unified-signatures': 'error',

      // ban-types was split in typescript-eslint v8. The type-banning behaviour
      // (Object, Function, Boolean, etc.) is now handled by no-restricted-types.
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            Object: { message: 'Avoid using `Object`. Did you mean `object`?' },
            Function: {
              message: 'Avoid `Function`. Prefer a specific function type, like `() => void`.',
            },
            Boolean: { message: 'Avoid `Boolean`. Did you mean `boolean`?' },
            Number: { message: 'Avoid `Number`. Did you mean `number`?' },
            String: { message: 'Avoid `String`. Did you mean `string`?' },
            Symbol: { message: 'Avoid `Symbol`. Did you mean `symbol`?' },
          },
        },
      ],

      // Core ESLint rules carried forward
      'constructor-super': 'error',
      'dot-notation': 'error',
      eqeqeq: ['error', 'smart'],
      'guard-for-in': 'error',
      'id-denylist': [
        'error',
        'any',
        'Number',
        'number',
        'String',
        'string',
        'Boolean',
        'boolean',
        'Undefined',
        'undefined',
      ],
      'id-match': 'error',
      'max-classes-per-file': ['error', 1],
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-cond-assign': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-empty-function': 'error',
      'no-eval': 'error',
      'no-new-wrappers': 'error',
      'no-throw-literal': 'error',
      'no-undef-init': 'error',
      'no-underscore-dangle': 'error',
      'no-unsafe-finally': 'error',
      'no-unused-expressions': 'error',
      'no-unused-labels': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-const': 'error',
      radix: 'error',
      'spaced-comment': ['error', 'always', { markers: ['/'] }],
      'use-isnan': 'error',

      // Replaces dead eslint-plugin-prefer-arrow (last published 2021).
      // Rule name changed from prefer-arrow/prefer-arrow-functions to this.
      'prefer-arrow-functions/prefer-arrow-functions': 'error',

      // jsdoc rules carried forward. jsdoc/newline-after-description was
      // deprecated in eslint-plugin-jsdoc v50+; dropped (tag-lines is its
      // more granular replacement, but not needed for this codebase's JSDoc).
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-indentation': 'error',
    },
  },

  // Test files: relax type-checked rules for test ergonomics.
  // This block replaces the per-file /* eslint-disable */ headers that were
  // previously at the top of each test file.
  {
    files: ['src/**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      // Test fixtures use HTTP status codes ('200'), MIME types ('*/*', 'text/html'),
      // and JSON Schema keys ('$ref') as object keys — these cannot be camelCase.
      '@typescript-eslint/naming-convention': 'off',
      'no-console': 'off',
    },
  },

  // Prettier compat — must be last to disable stylistic rules that conflict
  // with Prettier's formatting decisions.
  prettierConfig,
);
