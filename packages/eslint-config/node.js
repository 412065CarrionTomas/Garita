import { defineConfig } from 'eslint/config';
import globals from 'globals';

import { baseConfig } from './base.js';

/** Configuración para servicios Node.js (API con NestJS). */
export const nodeConfig = defineConfig(baseConfig, {
  languageOptions: {
    globals: {
      ...globals.node,
      ...globals.jest,
    },
  },
  rules: {
    // NestJS define módulos como clases vacías decoradas con @Module.
    '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
  },
});

export default nodeConfig;
