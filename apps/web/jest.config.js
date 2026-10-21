/** @type {import('jest').Config} */
export default {
  testEnvironment: 'jsdom',
  // Las pantallas con varios pasos de userEvent superan los 5 s por defecto cuando el CI está cargado.
  testTimeout: 30000,
  roots: ['<rootDir>/src'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': [
      '@swc/jest',
      {
        jsc: {
          parser: { syntax: 'typescript', tsx: true },
          transform: { react: { runtime: 'automatic' } },
        },
      },
    ],
  },
  moduleNameMapper: {
    '^react-router$': '<rootDir>/src/test/react-router.tsx',
    // import.meta.env solo existe en Vite: en los tests se usa una configuración fija.
    '^@/config/env$': '<rootDir>/src/test/env.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.css$': '<rootDir>/src/test/style.ts',
  },
};
