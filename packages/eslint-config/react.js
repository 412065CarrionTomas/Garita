import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

import { baseConfig } from './base.js';

/** Configuración para aplicaciones React con Vite (panel web). */
export const reactConfig = defineConfig(baseConfig, {
  files: ['**/*.{ts,tsx}'],
  extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  languageOptions: {
    globals: globals.browser,
  },
});

export default reactConfig;
