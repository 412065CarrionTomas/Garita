import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { baseConfig } from './base.js';

/** Configuración para servicios Node.js (API con NestJS). */
export const nodeConfig = defineConfig(
  baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        // Evita que consistent-type-imports rompa la inyección de dependencias de NestJS.
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    },
    rules: {
      // NestJS define módulos como clases vacías decoradas con @Module.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
    },
  },
);

export default nodeConfig;
