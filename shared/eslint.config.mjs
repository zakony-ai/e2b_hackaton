import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import importX from 'eslint-plugin-import-x';

export default tseslint.config(
  // Ignore build artifacts and config files
  {
    ignores: ['dist/**', 'node_modules/**', '*.config.mjs', '*.config.js'],
  },

  // Base JavaScript rules
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Shared package configuration - platform agnostic!
  {
    plugins: {
      'import-x': importX,
    },
    languageOptions: {
      // No environment globals - must be platform agnostic
      globals: {},
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

      // Prevent Node.js-specific imports
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'fs', message: 'fs is Node.js-only. Shared code must be platform-agnostic.' },
          { name: 'path', message: 'path is Node.js-only. Shared code must be platform-agnostic.' },
          { name: 'os', message: 'os is Node.js-only. Shared code must be platform-agnostic.' },
          { name: 'crypto', message: 'crypto is Node.js-only. Use Web Crypto API instead.' },
          { name: 'http', message: 'http is Node.js-only. Use fetch API instead.' },
          { name: 'https', message: 'https is Node.js-only. Use fetch API instead.' },
          { name: 'child_process', message: 'child_process is Node.js-only.' },
          { name: 'worker_threads', message: 'worker_threads is Node.js-only.' },
          { name: 'stream', message: 'stream is Node.js-only.' },
          { name: 'buffer', message: 'buffer is Node.js-only.' },
        ],
        patterns: [{
          group: ['node:*'],
          message: 'Node.js core modules are not allowed in shared code.',
        }],
      }],

      // Prevent browser-specific globals
      'no-restricted-globals': ['error',
        { name: 'window', message: 'window is browser-only. Shared code must be platform-agnostic.' },
        { name: 'document', message: 'document is browser-only. Shared code must be platform-agnostic.' },
        { name: 'navigator', message: 'navigator is browser-only. Shared code must be platform-agnostic.' },
        { name: 'localStorage', message: 'localStorage is browser-only. Shared code must be platform-agnostic.' },
        { name: 'sessionStorage', message: 'sessionStorage is browser-only. Shared code must be platform-agnostic.' },
      ],

      // Import validation
      'import-x/no-nodejs-modules': 'error',
    },
  }
);
