import '@testing-library/jest-dom';

globalThis.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

jest.mock('@/lib/firebase', () => ({ auth: { currentUser: null } }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signOut: jest.fn(),
}));
