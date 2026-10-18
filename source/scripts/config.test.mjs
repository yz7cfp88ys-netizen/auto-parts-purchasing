import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../server/config.js';
import { hashPassword, verifyPassword } from '../server/auth.js';
import { mailWorker } from '../server/mail.js';
const hash = await hashPassword(randomBytes(24).toString('base64url'));
const base = () => ({ NODE_ENV: 'production', APP_URL: 'https://automotosourcing.com', DB_USER: 'test_user', DB_NAME: 'ams_test', DB_PASSWORD: 'test-only-password', ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD_HASH: hash });
test('administrator identity always comes from validated environment variables', () => {
  assert.equal(readConfig(base()).adminEmail, 'admin@example.test');
  for (const changes of [{ ADMIN_EMAIL: '' }, { ADMIN_EMAIL: 'invalid' }, { ADMIN_PASSWORD_HASH: '' }]) assert.throws(() => readConfig({ ...base(), ...changes }), /ADMIN_EMAIL/);
});
test('notification recipient defaults to administrator and supports explicit canonical override', () => {
  assert.equal(readConfig(base()).mailTo, 'admin@example.test');
  assert.equal(readConfig({ ...base(), INQUIRY_NOTIFICATION_EMAIL: '' }).mailTo, 'admin@example.test');
  assert.equal(readConfig({ ...base(), INQUIRY_NOTIFICATION_EMAIL: 'quotes@example.test' }).mailTo, 'quotes@example.test');
  const c = readConfig({ ...base(), INQUIRY_NOTIFICATION_EMAIL: 'new@example.test', INQUIRY_NOTIFY_TO: 'old@example.test', SMTP_FROM_EMAIL: 'sender@example.test', MAIL_FROM: 'old-sender@example.test' });
  assert.equal(c.mailTo, 'new@example.test'); assert.equal(c.mailFrom, 'sender@example.test');
});
test('legacy variable names remain supported for existing deployments', () => {
  const c = readConfig({ ...base(), INQUIRY_NOTIFY_TO: 'legacy@example.test', MAIL_FROM: 'legacy-sender@example.test' });
  assert.equal(c.mailTo, 'legacy@example.test'); assert.equal(c.mailFrom, 'legacy-sender@example.test');
});
test('production may start with notifications disabled but still requires real admin and database configuration', async () => {
  const c = readConfig({ ...base(), MAIL_ENABLED: 'false' }); assert.equal(c.mailEnabled, false);
  const worker = mailWorker({ getConnection() { throw new Error('Disabled worker must not lease queued notifications'); } }, c);
  assert.equal(worker.configured, false); assert.deepEqual(await worker.runOnce(), { configured: false });
  await assert.rejects(worker.verify(), /disabled/); await worker.stop();
  assert.throws(() => readConfig({ ...base(), DB_PASSWORD: '' }), /DB_PASSWORD/);
  assert.throws(() => readConfig({ ...base(), MAIL_ENABLED: 'yes' }), /MAIL_ENABLED/);
});
test('enabling production mail validates SMTP credentials, sender, recipient, port and TLS', () => {
  const env = { ...base(), MAIL_ENABLED: 'true', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587', SMTP_SECURE: 'false', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only-smtp-password', SMTP_FROM_EMAIL: 'sender@example.test' };
  const c = readConfig(env); assert.equal(c.mailTo, env.ADMIN_EMAIL); assert.equal(c.smtp.requireTLS, true); assert.equal(c.smtp.secure, false);
  for (const changes of [{ SMTP_PASSWORD: '' }, { SMTP_FROM_EMAIL: '' }, { INQUIRY_NOTIFICATION_EMAIL: 'invalid' }, { SMTP_PORT: '0' }]) assert.throws(() => readConfig({ ...env, ...changes }));
  assert.throws(() => readConfig({ ...base(), MAIL_ENABLED: 'true' }), /SMTP/);
});
test('scrypt verifies the actual administrator password and rejects wrong or short passwords', async () => {
  const password = randomBytes(24).toString('base64url'), encoded = await hashPassword(password);
  assert.notEqual(encoded, password); assert.equal(await verifyPassword(password, encoded), true); assert.equal(await verifyPassword('incorrect password', encoded), false);
  await assert.rejects(hashPassword('short'), /14/);
});
