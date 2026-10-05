import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'dist-electron/', 'release/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // IPC payloads and third-party JSON are validated with zod at the boundary.
      '@typescript-eslint/no-explicit-any': 'off',
      // Best-effort cleanup (closing handles, optional saves) deliberately ignores failures.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
