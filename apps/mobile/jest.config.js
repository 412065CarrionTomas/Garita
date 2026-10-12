// https://docs.expo.dev/develop/unit-testing/
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testTimeout: 15000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: { '^expo-router$': '<rootDir>/src/test/expo-router.tsx' },
  // Con pnpm, los paquetes viven bajo node_modules/.pnpm y también deben transformarse.
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
};
