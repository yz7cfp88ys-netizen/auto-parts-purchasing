import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fail } from './validation.js';
const scrypt = promisify(scryptCallback);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 14 || password.length > 200) throw new Error('Password must be 14–200 characters.');
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [, salt, expected] = hash.split('$');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(Buffer.from(expected, 'hex'), actual);
}
export function auth(pool, config) {
  const credentialHash = sha256(config.passwordHash);
  const cookieName = config.production ? '__Host-ams_session' : 'ams_session';
  const cookieOptions = { httpOnly: true, secure: config.production, sameSite: 'strict', path: '/' };
  return {
    async login(req, res) {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string' || password.length > 200) fail(401, 'Invalid email or password.');
      const valid = await verifyPassword(password, config.passwordHash);
      if (!valid || email.toLowerCase() !== config.adminEmail.toLowerCase()) fail(401, 'Invalid email or password.');
      await pool.execute('DELETE FROM ams_sessions WHERE expires_at < UTC_TIMESTAMP(3)');
      const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
      await pool.execute('INSERT INTO ams_sessions (token_hash, csrf, admin_email, credential_hash, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 8 HOUR))', [sha256(token), csrf, config.adminEmail, credentialHash]);
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: 8 * 3600 * 1000 });
      res.json({ email: config.adminEmail, csrf });
    },
    async require(req, res, next) {
      const cookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='));
      const token = cookie?.slice(cookieName.length + 1);
      if (!token || !/^[a-f0-9]{64}$/.test(token)) fail(401, 'Please sign in.');
      const [[session]] = await pool.execute('SELECT * FROM ams_sessions WHERE token_hash = ? AND credential_hash = ? AND expires_at > UTC_TIMESTAMP(3)', [sha256(token), credentialHash]);
      if (!session) fail(401, 'Your session expired. Please sign in.');
      if (!['GET', 'HEAD'].includes(req.method) && req.get('x-csrf-token') !== session.csrf) fail(403, 'Invalid security token. Reload and sign in again.');
      req.session = session; next();
    },
    async logout(req, res) {
      await pool.execute('DELETE FROM ams_sessions WHERE token_hash = ?', [req.session.token_hash]);
      res.clearCookie(cookieName, cookieOptions); res.json({ success: true });
    },
  };
}
