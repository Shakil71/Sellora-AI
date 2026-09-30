import * as path from 'path';
import * as dotenv from 'dotenv';

// Load the real .env for Redis and secrets, then point Prisma at the test database.
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), quiet: true } as dotenv.DotenvConfigOptions);
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';
process.env.AUTH_RATE_LIMIT_MAX = '1000';
const testUrl = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL?.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
if (!testUrl) throw new Error('Set DATABASE_URL_TEST for integration tests');
process.env.DATABASE_URL = testUrl;
