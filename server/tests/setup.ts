import { unlinkSync, existsSync } from 'node:fs';

const TEST_DB = './test-leetsquad.db';
if (existsSync(TEST_DB)) unlinkSync(TEST_DB);

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-please-ignore';
process.env.DB_PATH = TEST_DB;
process.env.ALLOWED_ORIGINS = '*';
process.env.NONCE_TTL_SECONDS = '600';
