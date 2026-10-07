import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      pwaAssets: {
        config: true,
        overrideManifestIcons: true,
      },
      manifest: {
        name: 'Garita',
        short_name: 'Garita',
        description: 'Control de rondas para empresas de seguridad privada',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        theme_color: '#171717',
        background_color: '#ffffff',
      },
    }),
  ],
  resolve: {
    // Resuelve el alias "@/*" definido en tsconfig.app.json.
    tsconfigPaths: true,
  },
});
