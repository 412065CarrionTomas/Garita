import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Garita',
  slug: 'garita',
  owner: 'garita.com',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'garita',
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: 'com.garita.app',
    supportsTablet: false,
  },
  android: {
    package: 'com.garita.app',
    adaptiveIcon: {
      backgroundColor: '#171717',
      foregroundImage: './assets/images/android-icon-foreground.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
  },
  plugins: [
    'expo-router',
    [
      'react-native-nfc-manager',
      {
        nfcPermission: 'Garita usa NFC para asociar etiquetas a los puntos de control.',
        includeNdefEntitlement: false,
      },
    ],
    './plugins/withNfcFeature',
    'expo-audio',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#171717',
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    ...config.extra,
    eas: {
      projectId: '9fa675ec-1e76-4328-a7f2-9c3821cd25d8',
    },
  },
});
