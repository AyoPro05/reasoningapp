import { describe, expect, it } from 'vitest';
import { readConfig } from '../../packages/config/src/index.js';

// Removing the corresponding validation must admit each bad input and fail its test.
const valid = {
  NODE_ENV: 'test',
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://reasoningapp:test-only@127.0.0.1:5433/reasoningapp_test',
  REDIS_URL: 'redis://127.0.0.1:6380/1',
  AUTH_URL: 'http://localhost:3001',
  AUTH_SECRET: 'a-local-test-secret-with-at-least-32-characters',
  WEB_ORIGIN: 'http://localhost:3000',
  MOBILE_ORIGIN: 'reasoningapp://',
};
const production = {
  ...valid, NODE_ENV: 'production', APP_ENV: 'production',
  AUTH_URL: 'https://api.reasoning.example', WEB_ORIGIN: 'https://reasoning.example',
};

describe('readConfig', () => {
  it('returns typed safe defaults for static learning', () => {
    expect(readConfig(valid)).toMatchObject({
      environment: 'test', databaseUrl: valid.DATABASE_URL, redisUrl: valid.REDIS_URL,
      authUrl: valid.AUTH_URL, webOrigin: valid.WEB_ORIGIN,
      trustedOrigins: ['http://localhost:3000', 'reasoningapp://'],
      aiAssistanceEnabled: false, developmentFixturesEnabled: false,
      skipEmailVerification: false, seedVerifiedUsers: false, allowUnreviewedContent: false,
      liveBillingEnabled: false, mailProvider: 'fake',
    });
  });

  it.each(['DATABASE_URL', 'REDIS_URL', 'AUTH_URL', 'AUTH_SECRET', 'WEB_ORIGIN'])(
    'rejects missing required %s', (key) => {
      const env: Record<string, string> = { ...valid };
      delete env[key];
      expect(() => readConfig(env)).toThrow(key);
    },
  );
  it.each(['', 'short', '                                ', 'replace-with-at-least-32-random-characters'])(
    'rejects an empty, weak or placeholder auth secret: %j', (AUTH_SECRET) => {
      expect(() => readConfig({ ...valid, AUTH_SECRET })).toThrow('AUTH_SECRET');
    },
  );

  it.each(['DEVELOPMENT_FIXTURES_ENABLED', 'SKIP_EMAIL_VERIFICATION', 'SEED_VERIFIED_USERS', 'ALLOW_UNREVIEWED_CONTENT'])(
    'rejects production %s', (flag) => {
      expect(() => readConfig({ ...production, [flag]: 'true' })).toThrow(flag);
    },
  );
  it.each(['development', 'test'])(
    'rejects a production NODE_ENV disguised by APP_ENV=%s', (APP_ENV) => {
      expect(() => readConfig({ ...production, APP_ENV, DEVELOPMENT_FIXTURES_ENABLED: 'true' })).toThrow('APP_ENV');
    },
  );
  it('rejects production APP_ENV with development NODE_ENV', () => {
    expect(() => readConfig({ ...production, NODE_ENV: 'development' })).toThrow('APP_ENV');
  });
  it('accepts a safe production config while keeping external services disabled', () => {
    expect(readConfig(production)).toMatchObject({ environment: 'production', aiAssistanceEnabled: false, liveBillingEnabled: false, mailProvider: 'fake' });
  });
  it('requires an explicit environment before allowing development bypasses', () => {
    const { NODE_ENV: _, APP_ENV: __, ...env } = valid;
    expect(() => readConfig({ ...env, DEVELOPMENT_FIXTURES_ENABLED: 'true' })).toThrow('NODE_ENV');
  });
  it('allows explicit development-only flags without making them production eligible', () => {
    expect(readConfig({ ...valid, NODE_ENV: 'development', APP_ENV: 'development', DEVELOPMENT_FIXTURES_ENABLED: 'true', SKIP_EMAIL_VERIFICATION: 'true', SEED_VERIFIED_USERS: 'true', ALLOW_UNREVIEWED_CONTENT: 'true' })).toMatchObject({ developmentFixturesEnabled: true, skipEmailVerification: true, seedVerifiedUsers: true, allowUnreviewedContent: true });
  });
  it('parses literal false as false instead of truthy text', () => {
    expect(readConfig({ ...valid, DEVELOPMENT_FIXTURES_ENABLED: 'false', AI_ASSISTANCE_ENABLED: 'false' })).toMatchObject({ developmentFixturesEnabled: false, aiAssistanceEnabled: false });
  });
  it.each(['yes', '1', 'TRUE', 'False', '', ' true '])('rejects ambiguous boolean %j', (value) => {
    expect(() => readConfig({ ...valid, DEVELOPMENT_FIXTURES_ENABLED: value })).toThrow('DEVELOPMENT_FIXTURES_ENABLED');
  });
  it.each(['development', 'test', 'production'])('rejects AI activation in %s', (environment) => {
    expect(() => readConfig({ ...production, NODE_ENV: environment, APP_ENV: environment, AI_ASSISTANCE_ENABLED: 'true' })).toThrow('AI_ASSISTANCE_ENABLED');
  });
  it('rejects live billing', () => {
    expect(() => readConfig({ ...valid, LIVE_BILLING_ENABLED: 'true' })).toThrow('LIVE_BILLING_ENABLED');
  });
  it.each(['smtp', 'resend', 'ses'])('rejects a real mail provider %s', (MAIL_PROVIDER) => {
    expect(() => readConfig({ ...valid, MAIL_PROVIDER })).toThrow('MAIL_PROVIDER');
  });
  it('allows Mailpit only through an explicit loopback sink', () => {
    expect(readConfig({ ...valid, NODE_ENV: 'development', APP_ENV: 'development', MAIL_PROVIDER: 'mailpit', SMTP_URL: 'smtp://127.0.0.1:1025' })).toMatchObject({ mailProvider: 'mailpit', smtpUrl: 'smtp://127.0.0.1:1025' });
  });
  it('requires fake email in tests even if the sink is local', () => {
    expect(() => readConfig({ ...valid, MAIL_PROVIDER: 'mailpit', SMTP_URL: 'smtp://localhost:1025' })).toThrow('MAIL_PROVIDER');
  });
  it.each(['smtp://smtp.example.com:587', 'smtp://127.0.0.1.evil.example:1025', 'smtp://user:pass@localhost:1025'])('rejects a non-sink SMTP target %s', (SMTP_URL) => {
    expect(() => readConfig({ ...valid, MAIL_PROVIDER: 'mailpit', SMTP_URL })).toThrow('SMTP_URL');
  });
  it('rejects Mailpit without a sink URL', () => {
    expect(() => readConfig({ ...valid, MAIL_PROVIDER: 'mailpit' })).toThrow('SMTP_URL');
  });
  it('rejects Mailpit in production', () => {
    expect(() => readConfig({ ...production, MAIL_PROVIDER: 'mailpit', SMTP_URL: 'smtp://localhost:1025' })).toThrow('MAIL_PROVIDER');
  });
  it.each([
    ['DATABASE_URL', 'https://db.example/data'], ['DATABASE_URL', 'postgresql://localhost'],
    ['REDIS_URL', 'https://redis.example'], ['AUTH_URL', 'not-a-url'],
    ['AUTH_URL', 'https://user:pass@api.example'], ['WEB_ORIGIN', 'https://web.example/path'],
    ['WEB_ORIGIN', '*'], ['WEB_ORIGIN', 'null'], ['WEB_ORIGIN', 'https://*.example'],
    ['MOBILE_ORIGIN', 'https://evil.example'], ['MOBILE_ORIGIN', 'reasoningapp://*'],
    ['NODE_ENV', 'staging'], ['APP_ENV', 'preview'],
  ])('rejects invalid %s=%s', (key, value) => {
    expect(() => readConfig({ ...valid, [key]: value })).toThrow(key);
  });
  it.each([
    '*', 'null', 'http://localhost:3000.evil.example', 'https://evil.example',
    'http://localhost:3000/path', 'http://user@localhost:3000', 'reasoningapp://*',
    'http://localhost:3000,https://evil.example',
  ])('rejects unexpected trusted origin %s', (TRUSTED_ORIGINS) => {
    expect(() => readConfig({ ...valid, TRUSTED_ORIGINS })).toThrow('TRUSTED_ORIGINS');
  });
  it('accepts only the configured exact browser and native origins', () => {
    expect(readConfig({ ...valid, TRUSTED_ORIGINS: 'http://localhost:3000,reasoningapp://' }).trustedOrigins).toEqual(['http://localhost:3000', 'reasoningapp://']);
  });
  it.each(['AUTH_URL', 'WEB_ORIGIN'])('requires HTTPS in production for %s', (key) => {
    expect(() => readConfig({ ...production, [key]: 'http://reasoning.example' })).toThrow(key);
  });
  it('never exposes credentials in validation errors', () => {
    const secret = 'super-sensitive-invalid-database-password';
    expect(() => readConfig({ ...valid, DATABASE_URL: `https://user:${secret}@db.example/data` })).toThrow('DATABASE_URL');
    try { readConfig({ ...valid, DATABASE_URL: `https://user:${secret}@db.example/data` }); }
    catch (error) { expect(String(error)).not.toContain(secret); }
  });
});
