// https://docs.expo.dev/develop/unit-testing/
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // shortcut: the first render of each suite warms React Native modules and takes 10-20 s on CI runners; lower it if the jest-expo preset gets faster.
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: { '^expo-router$': '<rootDir>/src/test/expo-router.tsx' },
  // Con pnpm, los paquetes viven bajo node_modules/.pnpm y también deben transformarse.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
