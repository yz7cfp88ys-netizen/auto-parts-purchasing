import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { createApp } from './app.js';
import { mailWorker } from './mail.js';
if (process.env.NODE_ENV !== 'production') {
  try { loadEnvFile(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const config = readConfig(), pool = createPool(config);
try {
  await migrate(pool);
  const worker = mailWorker(pool, config);
  const app = createApp(pool, config, fileURLToPath(new URL('../../dist/public/', import.meta.url)), worker);
  const server = app.listen(config.port, config.host, () => {
    console.log(`automotosourcing listening on ${config.host}:${config.port}; database connected; SMTP ${worker.configured ? 'configured (delivery must be verified)' : config.mailEnabled ? 'not configured' : 'disabled; inquiry notifications remain queued'}`);
    worker.start();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    const deadline = setTimeout(() => process.exit(1), 30000); deadline.unref();
    server.close(async () => { await worker.stop(); await pool.end(); clearTimeout(deadline); process.exit(0); });
  });
} catch (error) {
  console.error('STARTUP_FAILED', error.code || error.message); await pool.end(); process.exitCode = 1;
}
