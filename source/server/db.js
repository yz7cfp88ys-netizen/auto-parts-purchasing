import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';

export function createPool(config) {
  const pool = mysql.createPool(config.db);
  // mysql2's timezone option controls conversion, not the server session clock.
  // Defaults, leases and expiry comparisons must all use the same UTC session.
  pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));
  return pool;
}
export async function migrate(pool) {
  const connection = await pool.getConnection();
  try {
    const [[lock]] = await connection.query("SELECT GET_LOCK('ams_schema_v1', 30) AS acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Database migration lock unavailable.');
    const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
    for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await connection.query(statement);
    await connection.execute('INSERT IGNORE INTO ams_schema_versions (version) VALUES (1)');
  } finally {
    await connection.query("SELECT RELEASE_LOCK('ams_schema_v1')").catch(() => {});
    connection.release();
  }
}
export async function transaction(pool, fn) {
  const connection = await pool.getConnection();
  try { await connection.beginTransaction(); const result = await fn(connection); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}
