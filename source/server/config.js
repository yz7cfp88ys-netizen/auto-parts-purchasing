import { z } from 'zod';

export function readConfig(env = process.env) {
  if (env.MAIL_ENABLED !== undefined && !['true', 'false'].includes(env.MAIL_ENABLED)) throw new Error('MAIL_ENABLED must be true or false.');
  const production = env.NODE_ENV === 'production';
  const port = Number(env.PORT || 3000);
  const origin = new URL(env.APP_URL || `http://127.0.0.1:${port}`).origin;
  const config = {
    production, port, origin, host: env.HOST || '0.0.0.0',
    trustProxy: env.TRUST_PROXY_HOPS === undefined ? false : Number(env.TRUST_PROXY_HOPS),
    adminEmail: env.ADMIN_EMAIL || '', passwordHash: env.ADMIN_PASSWORD_HASH || '',
    db: { host: env.DB_HOST || '127.0.0.1', port: Number(env.DB_PORT || 3306),
      user: env.DB_USER || '', password: env.DB_PASSWORD || '', database: env.DB_NAME || '',
      connectionLimit: 5, charset: 'utf8mb4', timezone: 'Z', dateStrings: true,
      ...(env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: true, ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA } : {}) } } : {}) },
    smtp: { host: env.SMTP_HOST || '', port: Number(env.SMTP_PORT || 465),
      secure: env.SMTP_SECURE !== 'false', requireTLS: production || env.SMTP_REQUIRE_TLS !== 'false',
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD || '' } } : {}),
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 },
    mailEnabled: env.MAIL_ENABLED === 'true',
    // Canonical names take precedence; keep earlier deployments compatible.
    mailFrom: env.SMTP_FROM_EMAIL || env.MAIL_FROM || '',
    mailTo: env.INQUIRY_NOTIFICATION_EMAIL || env.INQUIRY_NOTIFY_TO || env.ADMIN_EMAIL || '',
  };
  if (!config.db.user || !config.db.database) throw new Error('DB_USER and DB_NAME are required.');
  if (!z.email().safeParse(config.adminEmail).success || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(config.passwordHash)) {
    throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH (run npm run admin:hash).');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT.');
  if (config.trustProxy !== false && (!Number.isInteger(config.trustProxy) || config.trustProxy < 0 || config.trustProxy > 5)) throw new Error('Invalid TRUST_PROXY_HOPS.');
  if (production && (!env.APP_URL || !origin.startsWith('https://') || !config.db.password)) throw new Error('Production requires HTTPS APP_URL and DB_PASSWORD.');
  if (config.mailEnabled && (!Number.isInteger(config.smtp.port) || config.smtp.port < 1 || config.smtp.port > 65535)) throw new Error('Invalid SMTP_PORT.');
  if (production && config.mailEnabled && (!config.smtp.host || !config.smtp.auth?.user || !config.smtp.auth?.pass ||
    !z.email().safeParse(config.mailFrom).success || !z.email().safeParse(config.mailTo).success)) {
    throw new Error('MAIL_ENABLED=true requires complete SMTP credentials and SMTP_FROM_EMAIL in production. INQUIRY_NOTIFICATION_EMAIL defaults to ADMIN_EMAIL.');
  }
  return config;
}
