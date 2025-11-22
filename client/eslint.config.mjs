import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  // Global ignores must come first
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "server-bundle/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
  ...nextVitals,
  ...nextTs,
  // Add explicit tsconfigRootDir for monorepo support
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);

export default eslintConfig;
