import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { z } from 'zod';

/**
 * Loads the project-root `.env` (single source of configuration for the API,
 * worker and web app) and validates it. Values already present in the process
 * environment win, so production process managers can inject variables.
 */
function loadDotenv() {
  const candidates = [
    process.env.ENV_FILE,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(__dirname, '../../../../.env'),
    path.resolve(__dirname, '../../../.env'),
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      dotenv.config({ path: file, quiet: true } as dotenv.DotenvConfigOptions);
      return file;
    }
  }
  return undefined;
}

export const ENV_FILE_PATH = loadDotenv();

const bool = (def: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === true || v === 'true' || v === '1'));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('Sellora AI'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  API_URL: z.string().url().default('http://localhost:4000'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  COOKIE_SECURE: bool(false),
  COOKIE_DOMAIN: optionalString,
  TRUST_PROXY: bool(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  INSTALLER_TOKEN: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  AI_DEFAULT_MODEL: z.string().default('gpt-4o-mini'),
  AI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AI_PRICE_INPUT_PER_1M: z.coerce.number().nonnegative().default(0.15),
  AI_PRICE_OUTPUT_PER_1M: z.coerce.number().nonnegative().default(0.6),

  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
  WHATSAPP_GRAPH_API_VERSION: z.string().default('v21.0'),
  WHATSAPP_GRAPH_BASE_URL: z.string().url().default('https://graph.facebook.com'),

  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  MAIL_FROM: z.string().default('Sellora AI <no-reply@example.com>'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage/uploads'),
  STORAGE_ENDPOINT: optionalString,
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_BUCKET: optionalString,
  STORAGE_PUBLIC_URL: optionalString,
  STORAGE_FORCE_PATH_STYLE: bool(true),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\nSee docs/ENVIRONMENT.md`);
  }
  if (parsed.data.STORAGE_DRIVER === 's3' && !parsed.data.STORAGE_BUCKET) {
    throw new Error('STORAGE_BUCKET is required when STORAGE_DRIVER=s3');
  }
  cached = parsed.data;
  return cached;
}

/** Reset cache (tests only). */
export function resetEnvCache() {
  cached = undefined;
}

export const env = new Proxy({} as Env, {
  get(_t, key: string) {
    return loadEnv()[key as keyof Env];
  },
});

export const isProduction = () => loadEnv().NODE_ENV === 'production';
