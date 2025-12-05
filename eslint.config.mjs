import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
// const eslint = require('@eslint/js')
// const airbnb = require('eslint-config-airbnb-extended')
// const prettierConfig = require('eslint-config-prettier/flat')
// const stylistic = require('@stylistic/eslint-plugin')
// const progress = require('eslint-plugin-file-progress')
// const promisePlugin = require('eslint-plugin-promise')
// const unicorn = require('eslint-plugin-unicorn')
// const tailwind = require('eslint-plugin-tailwindcss')

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
