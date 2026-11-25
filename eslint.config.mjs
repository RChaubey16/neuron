// Shared ESLint config for the Node packages (api, worker, core).
// apps/web has its own config that adds the Next.js rules on top of this one.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export const baseConfig = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/*.config.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    // No `consistent-type-imports`: NestJS reads constructor parameter types at
    // runtime (emitDecoratorMetadata), so turning those into `import type` breaks
    // dependency injection.
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);

export default baseConfig;
