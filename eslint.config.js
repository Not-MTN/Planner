import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/**
 * The `eslint-disable-next-line` comments scattered through src/ used to be
 * inert — this repo had no linter at all, so nothing was checking the very
 * dependency arrays those comments excused.
 *
 * This config runs the rules the code was already written against:
 * `react-hooks/exhaustive-deps`, `react-hooks/rules-of-hooks`, `no-var` and
 * `jsx-a11y/media-has-caption` — plus the core correctness rules.
 *
 * Deliberately NOT enabled: the React-Compiler rule set that ships in
 * eslint-plugin-react-hooks v6 (`set-state-in-effect`, `refs`, `purity`,
 * `preserve-manual-memoization`). This app predates the compiler and is not
 * compiled with it; those rules report ~60 findings that are, for now, the
 * architecture rather than bugs. Revisit when the compiler is adopted.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // The native and desktop projects each carry a copy of the built web app
      // (android/…/assets/public, ios/App/App/public, desktop/dist) plus their
      // own toolchain output. Nothing in them is hand-written source.
      'android/**',
      'ios/**',
      'desktop/dist/**',
      'desktop/release/**',
    ],
  },

  // ── Plain browser scripts (service worker, pre-paint theme) ───────────────
  {
    files: ['public/**/*.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  // ── Application, server and test code ────────────────────────────────────
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      // TypeScript already resolves identifiers; `no-undef` only produces
      // false positives on globals declared by libraries.
      'no-undef': 'off',
      'no-var': 'error',
      'prefer-const': 'error',

      ...reactHooks.configs['recommended-latest'].rules,
      'react-hooks/exhaustive-deps': 'warn',

      // The one jsx-a11y rule the codebase already accounts for in
      // src/components/Attachments.tsx; the rest of the preset is not adopted.
      'jsx-a11y/media-has-caption': 'error',

      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── Tests poke at internals on purpose ───────────────────────────────────
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // ── Build scripts and the desktop shell (Node, not bundled) ───────────────
  // Kept last: the TypeScript presets above apply to every file, and would
  // otherwise forbid `require()` in the very files Node loads as CommonJS.
  {
    files: ['scripts/**/*.mjs', 'desktop/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { ...js.configs.recommended.rules },
  },
  {
    files: ['desktop/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-empty': ['error', { allowEmptyCatch: true }],
      // CommonJS has exactly one way to import.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
