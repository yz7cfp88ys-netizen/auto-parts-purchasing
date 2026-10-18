import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import { auth } from './auth.js';
import { catalogRoutes, listProducts } from './catalog.js';
import { saveInquiry, inquiryRoutes } from './inquiries.js';
import { fail } from './validation.js';

export function createApp(pool, config, publicDir, worker) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'https:', 'data:'],
    connectSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
    upgradeInsecureRequests: config.production ? [] : null,
  } }, strictTransportSecurity: config.production ? { maxAge: 15552000 } : false }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('origin') !== config.origin || req.get('sec-fetch-site') === 'cross-site') fail(403, 'Request origin is not allowed.');
      if (!req.is('application/json')) fail(415, 'Send application/json.');
    }
    next();
  });
  app.use('/api', express.json({ limit: '128kb' }));
  const limiter = (limit, minutes) => rateLimit({ windowMs: minutes * 60000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: 'Too many requests. Please wait and try again.' } });
  app.use('/api', limiter(300, 1));
  const identity = auth(pool, config);
  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1'); res.json({ status: 'ok', database: 'connected', service: 'automotosourcing' });
  });
  app.get('/api/categories', async (req, res) => {
    const [categories] = await pool.query('SELECT id, name FROM ams_categories ORDER BY name'); res.json({ categories });
  });
  app.get('/api/products', async (req, res) => res.json(await listProducts(pool, req.query)));
  app.post('/api/inquiries', limiter(10, 15), async (req, res) => res.status(201).json(await saveInquiry(pool, req.body)));
  app.post('/api/auth/login', limiter(8, 15), identity.login);
  const admin = express.Router(); admin.use(identity.require);
  admin.get('/session', (req, res) => res.json({ email: req.session.admin_email, csrf: req.session.csrf }));
  admin.post('/logout', identity.logout);
  admin.get('/system', async (req, res) => {
    const [notifications] = await pool.query('SELECT status, COUNT(*) AS count FROM ams_outbox GROUP BY status');
    res.json({ database: 'connected', smtpConfigured: worker.configured, notifications });
  });
  catalogRoutes(admin, pool); inquiryRoutes(admin, pool); app.use('/api/admin', admin);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((req, res, next) => { if (/^\/admin(?:\.html)?$/.test(req.path)) res.set('Cache-Control', 'no-store'); next(); });
  app.get('/admin', (req, res) => res.redirect('/admin.html'));
  app.use(express.static(path.resolve(publicDir), { dotfiles: 'deny', index: 'index.html' }));
  app.use((req, res) => res.status(404).type('text').send('Page not found.'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ').slice(0, 1000) });
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This SKU or category already exists.' });
    if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code)) return res.status(409).json({ error: 'Category is in use or no longer exists. Reload categories before saving.' });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    const status = error.status || 500;
    if (status >= 500) console.error('REQUEST_FAILED', error.code || 'INTERNAL_ERROR');
    res.status(status).json({ error: status < 500 ? error.message : 'Service unavailable. Keep your details and retry.' });
  });
  return app;
}
