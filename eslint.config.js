import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/dist-app/**', '**/node_modules/**', 'server/data/**', 'desktop/app/**', 'desktop/release/**', 'desktop/resources/**', 'mobile/ios/**', 'mobile/build/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  // No `any` in shared / network code.
  {
    files: ['shared/**/*.ts', 'server/**/*.ts', 'client/src/net/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
);
