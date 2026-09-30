/**
 * Integration tests boot the real Nest application against a dedicated test
 * database (DATABASE_URL_TEST) and Redis. Run: npm run test:integration
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }] },
  setupFiles: ['<rootDir>/test/setup-integration.ts'],
  testTimeout: 60_000,
};
