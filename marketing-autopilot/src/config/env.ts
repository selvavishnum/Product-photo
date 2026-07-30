import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment is validated once, at boot, and the process refuses to start if
 * anything required is missing or malformed.
 *
 * The alternative -- reading process.env at the call site -- means a missing
 * key surfaces as a 500 on a user's first ad generation, in production, hours
 * after deploy. Failing at boot turns that into a failed deploy instead.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  LLM_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // 32 raw bytes, base64-encoded: AES-256 needs exactly that.
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, {
      message: 'TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded',
    }),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_API_VERSION: z.string().default('v21.0'),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),

  MAX_DAILY_BUDGET_INR: z.coerce.number().int().positive().default(5000),

  // Object storage for generated banners. S3-compatible: leave S3_ENDPOINT
  // unset for AWS, set it for Cloudflare R2 / MinIO / B2.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** Public CDN origin in front of the bucket, e.g. https://cdn.example.com */
  CDN_BASE_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

// Checked here rather than at the first LLM call, for the same reason: a
// deploy with LLM_PROVIDER=gemini and no key should not look healthy.
if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
  throw new Error('LLM_PROVIDER=gemini requires GEMINI_API_KEY');
}
if (env.LLM_PROVIDER === 'openai' && !env.OPENAI_API_KEY) {
  throw new Error('LLM_PROVIDER=openai requires OPENAI_API_KEY');
}

export const isProd = env.NODE_ENV === 'production';
