import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { transaction } from './db.js';
import { inquiryDetail } from './inquiries.js';

export function mailWorker(pool, config) {
  const configured = Boolean(config.mailEnabled && config.smtp.host && config.mailFrom && config.mailTo);
  const transport = configured ? nodemailer.createTransport(config.smtp) : null;
  let timer, running;
  async function deliver() {
    if (!transport) return { configured: false };
    const token = randomUUID();
    const job = await transaction(pool, async db => {
      const [[row]] = await db.query(`SELECT * FROM ams_outbox WHERE attempts < 10 AND
        (status IN ('pending','failed') OR status='sending') AND next_attempt_at <= UTC_TIMESTAMP(3)
        ORDER BY next_attempt_at LIMIT 1 FOR UPDATE`);
      if (!row) return null;
      await db.execute("UPDATE ams_outbox SET status='sending', attempts=attempts+1, lease_token=?, next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 5 MINUTE) WHERE id=?", [token, row.id]);
      return row;
    });
    if (!job) return { idle: true };
    try {
      const d = await inquiryDetail(pool, job.inquiry_id);
      const receipt = await transport.sendMail({
        from: config.mailFrom, to: config.mailTo, replyTo: d.email,
        subject: `New purchasing inquiry ${d.reference}`,
        messageId: `<${job.id}@${new URL(config.origin).hostname}>`,
        text: `${d.reference}\n${d.contact_name} | ${d.company}\n${d.email} | ${d.country}\n\n${d.items.map((v, i) => `${i + 1}. ${v.description} | ${v.sku_snapshot || 'Custom part'} | Qty ${v.quantity}\n${v.specifications}`).join('\n\n')}\n\n${d.notes}\n\nManage securely: ${config.origin}/admin.html`,
      });
      if (!receipt.accepted?.length) throw Object.assign(new Error('SMTP recipient rejected'), { code: 'SMTP_REJECTED' });
      await pool.execute("UPDATE ams_outbox SET status='sent', sent_at=UTC_TIMESTAMP(3), last_error='', lease_token=NULL WHERE id=? AND lease_token=?", [job.id, token]);
      return { sent: true };
    } catch (error) {
      // Save an error code, never SMTP credentials or customer content.
      const code = String(error.code || 'MAIL_ERROR').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
      const delay = Math.min(3600, 30 * 2 ** job.attempts);
      await pool.execute(`UPDATE ams_outbox SET status='failed', last_error=?, next_attempt_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ${delay} SECOND), lease_token=NULL WHERE id=? AND lease_token=?`, [code, job.id, token]);
      return { sent: false, error: code };
    }
  }
  return {
    configured,
    async runOnce() { if (running) return running; running = deliver(); try { return await running; } finally { running = null; } },
    start() {
      const tick = () => this.runOnce().catch(() => console.error('MAIL_WORKER_DATABASE_ERROR'));
      timer = setInterval(tick, 15000); timer.unref(); tick();
    },
    async stop() { clearInterval(timer); if (running) await running.catch(() => {}); transport?.close(); },
    async verify() { if (!transport) throw new Error('Email notifications are disabled or SMTP is not configured.'); return transport.verify(); },
  };
}
