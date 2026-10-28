import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Genera favicon, íconos del manifiesto y apple-touch-icon a partir del logo en cada build.
export default defineConfig({
  headLinkOptions: {
    preset: '2023',
  },
  preset: minimal2023Preset,
  images: ['public/logo.svg'],
});
