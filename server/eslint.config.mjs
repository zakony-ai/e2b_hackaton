import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Ignore build artifacts and config files
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.mjs', '*.config.js', 'build.mjs'],
  },

  // Base JavaScript rules
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Server-specific configuration
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Forbid 'any' types
      '@typescript-eslint/no-explicit-any': 'error',

      // Unused vars with underscore exception
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],

      // Allow console in server code
      'no-console': 'off',
    },
  }
);
