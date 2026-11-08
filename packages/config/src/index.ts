import { z } from 'zod';

const BooleanFlag = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const Environment = z.enum(['development', 'test', 'production']);

function parseUrl(value: string): URL | undefined {
  try { return new URL(value); } catch { return undefined; }
}

function isHttpOrigin(value: string): boolean {
  const url = parseUrl(value);
  return Boolean(url && ['http:', 'https:'].includes(url.protocol) &&
    !url.username && !url.password && !url.search && !url.hash &&
    !url.hostname.includes('*') && (url.pathname === '/' || url.pathname === '') &&
    value === url.origin);
}

const EnvironmentSchema = z.object({
  NODE_ENV: Environment,
  APP_ENV: Environment.optional(),
  DATABASE_URL: z.string().refine((value) => {
    const url = parseUrl(value);
    return Boolean(url && ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname && url.pathname.length > 1 && !url.hash);
  }),
  REDIS_URL: z.string().refine((value) => {
    const url = parseUrl(value);
    return Boolean(url && ['redis:', 'rediss:'].includes(url.protocol) && url.hostname && !url.hash);
  }),
  AUTH_URL: z.string().refine(isHttpOrigin),
  AUTH_SECRET: z.string().min(32).refine((value) =>
    value.trim() === value && !/^(replace|change|example|placeholder)/i.test(value)),
  WEB_ORIGIN: z.string().refine(isHttpOrigin),
  MOBILE_ORIGIN: z.literal('reasoningapp://').default('reasoningapp://'),
  TRUSTED_ORIGINS: z.string().optional(),
  DEVELOPMENT_FIXTURES_ENABLED: BooleanFlag,
  SKIP_EMAIL_VERIFICATION: BooleanFlag,
  SEED_VERIFIED_USERS: BooleanFlag,
  ALLOW_UNREVIEWED_CONTENT: BooleanFlag,
  AI_ASSISTANCE_ENABLED: BooleanFlag,
  LIVE_BILLING_ENABLED: BooleanFlag,
  MAIL_PROVIDER: z.enum(['fake', 'mailpit']).default('fake'),
  SMTP_URL: z.string().optional(),
}).superRefine((env, context) => {
  const reject = (key: keyof typeof env) => context.addIssue({ code: 'custom', path: [key], message: 'Unsupported configuration' });
  if (env.APP_ENV !== undefined && env.APP_ENV !== env.NODE_ENV) reject('APP_ENV');
  if (env.AI_ASSISTANCE_ENABLED) reject('AI_ASSISTANCE_ENABLED');
  if (env.LIVE_BILLING_ENABLED) reject('LIVE_BILLING_ENABLED');

  const allowedOrigins = [env.WEB_ORIGIN, env.MOBILE_ORIGIN];
  if (env.TRUSTED_ORIGINS !== undefined) {
    const origins = env.TRUSTED_ORIGINS.split(',');
    if (!origins.includes(env.WEB_ORIGIN) || origins.some((origin) => !allowedOrigins.includes(origin))) reject('TRUSTED_ORIGINS');
  }

  if (env.SMTP_URL !== undefined) {
    const smtp = parseUrl(env.SMTP_URL);
    if (!smtp || smtp.protocol !== 'smtp:' || !['localhost', '127.0.0.1', '[::1]', 'mailpit'].includes(smtp.hostname) ||
      smtp.port !== '1025' || smtp.username || smtp.password || smtp.search || smtp.hash || (smtp.pathname !== '' && smtp.pathname !== '/')) reject('SMTP_URL');
  }
  if (env.MAIL_PROVIDER === 'mailpit' && env.SMTP_URL === undefined) reject('SMTP_URL');
  if (env.NODE_ENV === 'test' && env.MAIL_PROVIDER !== 'fake') reject('MAIL_PROVIDER');

  if (env.NODE_ENV === 'production' || env.APP_ENV === 'production') {
    for (const key of ['DEVELOPMENT_FIXTURES_ENABLED', 'SKIP_EMAIL_VERIFICATION', 'SEED_VERIFIED_USERS', 'ALLOW_UNREVIEWED_CONTENT'] as const) {
      if (env[key]) reject(key);
    }
    if (!env.AUTH_URL.startsWith('https://')) reject('AUTH_URL');
    if (!env.WEB_ORIGIN.startsWith('https://')) reject('WEB_ORIGIN');
    if (env.MAIL_PROVIDER !== 'fake') reject('MAIL_PROVIDER');
    if (env.SMTP_URL !== undefined) reject('SMTP_URL');
  }
});

export const AppConfigSchema = EnvironmentSchema.transform((env) => ({
  environment: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,
  authUrl: env.AUTH_URL,
  authSecret: env.AUTH_SECRET,
  webOrigin: env.WEB_ORIGIN,
  mobileOrigin: env.MOBILE_ORIGIN,
  trustedOrigins: [...new Set(env.TRUSTED_ORIGINS?.split(',') ?? [env.WEB_ORIGIN, env.MOBILE_ORIGIN])],
  developmentFixturesEnabled: env.DEVELOPMENT_FIXTURES_ENABLED,
  skipEmailVerification: env.SKIP_EMAIL_VERIFICATION,
  seedVerifiedUsers: env.SEED_VERIFIED_USERS,
  allowUnreviewedContent: env.ALLOW_UNREVIEWED_CONTENT,
  aiAssistanceEnabled: false as const,
  liveBillingEnabled: false as const,
  mailProvider: env.MAIL_PROVIDER,
  smtpUrl: env.SMTP_URL,
}));

export type AppConfig = z.infer<typeof AppConfigSchema>;

/** Server-only. Pass the actual process environment; never accept config from a request. */
export function readConfig(env: Record<string, string | undefined>): AppConfig {
  const result = AppConfigSchema.safeParse(env);
  if (!result.success) {
    // Never log Zod's raw issues: future validators may embed input credentials.
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid configuration: ${fields.join(', ')}`);
  }
  return result.data;
}
