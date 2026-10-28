import { reactConfig } from '@garita/eslint-config/react';
import { defineConfig } from 'eslint/config';

export default defineConfig(reactConfig, {
  // Componentes generados por shadcn/ui: exportan variantes junto al componente.
  files: ['src/components/ui/**/*.tsx'],
  rules: {
    'react-refresh/only-export-components': 'off',
  },
});
