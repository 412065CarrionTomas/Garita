/** Reemplaza a src/config/env.ts en los tests (ver jest.config.js). */
export const env = {
  VITE_API_URL: 'http://api.test/api/v1',
  VITE_FIREBASE_API_KEY: 'test-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'garita.test',
  VITE_FIREBASE_PROJECT_ID: 'garita-test',
  VITE_FIREBASE_APP_ID: 'test-app',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '',
  VITE_FIREBASE_VAPID_KEY: '',
  VITE_GOOGLE_MAPS_API_KEY: '',
  VITE_MAP_STYLE_URL: 'https://tiles.openfreemap.org/styles/positron',
  VITE_GEOCODER_URL: 'https://photon.komoot.io/api/',
};
