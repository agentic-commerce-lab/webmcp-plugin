import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: [
            'dist/',
            'node_modules/',
            '.tools/',
            'playwright-report/',
            'test-results/',
            'src/Resources/app/storefront/dist/',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            // Empty catch blocks are intentional in the best-effort storefront
            // UI-sync paths; a leading comment documents each one.
            'no-empty': ['error', { allowEmptyCatch: true }],
            // The Store API / cart boundary is deliberately untyped for now.
            // Typed domain models (WP7) will let us re-enable these as errors.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'error',
                // caughtErrors 'none': unused catch bindings are tolerated; the
                // error-handling overhaul is tracked separately (roadmap A5).
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
        },
    },
    prettier,
);
