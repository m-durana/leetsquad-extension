import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function requiredSecret(name: string, minLength: number): string {
  const v = required(name);
  if (v.length < minLength) {
    throw new Error(`${name} must be at least ${minLength} characters (got ${v.length})`);
  }
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? './leetsquad.db',
  // Number of proxy hops in front of the app, so Express picks the real client
  // IP for rate limiting. Production is Cloudflare -> nginx = 2. Override per env.
  trustProxy: Number(process.env.TRUST_PROXY ?? 2),
  jwtSecret: requiredSecret('JWT_SECRET', 32),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
  nonceTtlSeconds: Number(process.env.NONCE_TTL_SECONDS ?? 600),
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};
