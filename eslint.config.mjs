// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'docs/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The codebase mirrors Instagram's snake_case fields and runs with
      // noImplicitAny: false — keep both idioms legal.
      '@typescript-eslint/no-explicit-any': 'off',
      // `import X = require('Y')` is load-bearing for packages without ESM
      // interop (json-bigint, snakecase-keys) while esModuleInterop is false.
      '@typescript-eslint/no-require-imports': 'off',
      // Response typing idiom: `interface FooResponse extends BarResponse {}`
      // and standalone placeholders like `interface XsharingNonces {}`
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'always' }],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variableLike',
          format: ['camelCase', 'snake_case', 'UPPER_CASE', 'PascalCase'],
          leadingUnderscore: 'allow',
        },
      ],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
  prettier,
);
