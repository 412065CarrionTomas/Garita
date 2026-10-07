import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import turbo from 'eslint-plugin-turbo';
import tseslint from 'typescript-eslint';

/**
 * Configuración base para todos los paquetes TypeScript del monorepo.
 * Usa reglas con información de tipos, por lo que cada paquete debe tener su tsconfig.
 */
export const baseConfig = defineConfig(
  globalIgnores(['dist/', 'build/', 'coverage/', '.turbo/', '**/generated/']),
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [js.configs.recommended],
  },
  {
    plugins: { turbo },
    rules: {
      'turbo/no-undeclared-env-vars': 'error',
    },
  },
  prettier,
);

export default baseConfig;
