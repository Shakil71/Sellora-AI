// Deterministic, non-secret values for unit tests.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'unit-test-jwt-secret-unit-test-jwt-secret-0001';
process.env.JWT_REFRESH_SECRET = 'unit-test-refresh-secret-unit-test-refresh-0001';
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
process.env.ENV_FILE = '__none__';
