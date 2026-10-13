/* global jest */
process.env.EXPO_PUBLIC_API_URL = 'http://api.test/api/v1';
process.env.EXPO_PUBLIC_FIREBASE_API_KEY = 'test-key';
process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN = 'garita.test';
process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID = 'garita-test';
process.env.EXPO_PUBLIC_FIREBASE_APP_ID = 'test-app';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
jest.mock('firebase/auth', () => ({
  getReactNativePersistence: jest.fn(),
  initializeAuth: jest.fn(),
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));

// Enable React 19's act() checks in the test environment.
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
  value: true,
  writable: true,
  configurable: true,
});
