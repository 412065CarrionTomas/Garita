import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import turbo from 'eslint-plugin-turbo';
import globals from 'globals';

import { baseConfig } from './base.js';

/** Configuración para aplicaciones React con Vite (panel web). */
export const reactConfig = defineConfig(baseConfig, {
  files: ['**/*.{ts,tsx}'],
  extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  plugins: { turbo },
  languageOptions: {
    globals: globals.browser,
  },
  rules: {
    // Las variables de entorno de Vite se incrustan en el build: deben declararse en turbo.json.
    'turbo/no-undeclared-env-vars': 'error',
  },
});

export default reactConfig;
