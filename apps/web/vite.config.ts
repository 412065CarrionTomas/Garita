import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';

function fcmServiceWorker(config: Record<string, string>): Plugin {
  return {
    name: 'garita-fcm-service-worker',
    generateBundle() {
      if (!config.VITE_FIREBASE_MESSAGING_SENDER_ID || !config.VITE_FIREBASE_VAPID_KEY) return;
      this.emitFile({
        type: 'asset',
        fileName: 'firebase-messaging-sw.js',
        source: `importScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-app-compat.js');\nimportScripts('https://www.gstatic.com/firebasejs/12.10.0/firebase-messaging-compat.js');\nfirebase.initializeApp(${JSON.stringify({ apiKey: config.VITE_FIREBASE_API_KEY, authDomain: config.VITE_FIREBASE_AUTH_DOMAIN, projectId: config.VITE_FIREBASE_PROJECT_ID, appId: config.VITE_FIREBASE_APP_ID, messagingSenderId: config.VITE_FIREBASE_MESSAGING_SENDER_ID })});\nfirebase.messaging();`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const config = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      react(),
      tailwindcss(),
      fcmServiceWorker(config),
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
          scope: '/',
          orientation: 'portrait-primary',
          theme_color: '#1B2540',
          background_color: '#F4F6F8',
        },
      }),
    ],
    resolve: {
      // Resuelve el alias "@/*" definido en tsconfig.app.json.
      tsconfigPaths: true,
    },
  };
});
