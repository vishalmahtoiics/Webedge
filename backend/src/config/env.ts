import { z } from 'zod';

/**
 * Configuration is validated at startup and the process refuses to boot when
 * anything required is missing or weak (blueprint §22). Failing loudly at boot
 * beats discovering in production that sessions were signed with a default.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),

  // Access tokens are short-lived; the refresh token carries the session.
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  ADMIN_JWT_REFRESH_TTL_HOURS: z.coerce.number().int().positive().default(12),

  /// Key used to encrypt provider API credentials at rest. 32 bytes, hex-encoded.
  CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'CREDENTIAL_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  CREDENTIAL_ENCRYPTION_KEY_VERSION: z.string().default('v1'),

  CLIENT_ORIGIN: z.string().url().default('http://localhost:3000'),
  ADMIN_ORIGIN: z.string().url().default('http://localhost:3001'),

  /**
   * How often the renewal sweep runs, in minutes, and whether it runs at all.
   *
   * The frequency is not a correctness parameter — every step of the sweep is
   * idempotent and catches up on whatever it missed, so a sweep that is late
   * bills the same amounts on the same dates. It is a latency parameter: how
   * long after midnight a renewal invoice appears.
   *
   * Zero switches it off, which is what the test suite and the installer want.
   * A deployment that turns it off has subscriptions that never renew, so it is
   * off only by deliberate choice, never by default.
   */
  RENEWAL_SWEEP_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),

  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) return cached;

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${problems}\n\nSee .env.example.`);
  }

  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production: __Host- cookies require Secure.');
  }

  cached = parsed.data;
  return cached;
}

/** Test helper — the cache exists so config is parsed once per process. */
export function resetConfigCache(): void {
  cached = undefined;
}
