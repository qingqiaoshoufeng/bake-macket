import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import prettier from 'eslint-config-prettier/flat';

/**
 * ESLint configuration for `@bake-mall/h5-store`.
 *
 * The root `pnpm lint` script intentionally does **not** recurse into
 * `apps/h5-store`; this file ships the storefront's own lint surface so the
 * workspace root command stays focused on its top-level `*.mjs`/scripts
 * contracts. Run via `pnpm --filter @bake-mall/h5-store lint`.
 *
 * `eslint-config-prettier` is appended last so stylistic rules (attribute
 * line breaks, self-closing HTML) defer to Prettier.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      globals: { ...globals.browser },
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'vue/multi-word-component-names': 'off',
    },
  },
  prettier,
);
