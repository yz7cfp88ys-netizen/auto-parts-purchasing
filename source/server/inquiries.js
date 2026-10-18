import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { transaction } from './db.js';
import { sha256 } from './auth.js';
import { inquirySchema, inquiryUpdateSchema, fail, pageQuery } from './validation.js';

export async function saveInquiry(pool, input) {
  const data = inquirySchema.parse(input), payloadHash = sha256(JSON.stringify(data));
  try {
    return await transaction(pool, async db => {
      const id = randomUUID(), reference = `IQ-${data.requestId.replaceAll('-', '').toUpperCase()}`;
      await db.execute(`INSERT INTO ams_inquiries (id, reference, request_id, payload_hash, contact_name, email, company, country, phone, business, order_type, notes, services, admin_notes, locale)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`, [id, reference, data.requestId, payloadHash, data.name, data.email, data.company, data.country, data.phone, data.business, data.orderType, data.notes, JSON.stringify(data.services), data.locale]);
      for (const [position, part] of data.parts.entries()) {
        let sku = '', description = part.description;
        if (part.productId) {
          const [[product]] = await db.execute('SELECT sku, name FROM ams_products WHERE id=? AND active=1 FOR UPDATE', [part.productId]);
          if (!product) fail(409, 'A selected product is no longer available. Remove it or request it as a custom part.');
          sku = product.sku; description = product.name;
        }
        await db.execute(`INSERT INTO ams_inquiry_items (id, inquiry_id, position, product_id, sku_snapshot, description, specifications, quantity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), id, position, part.productId || null, sku, description, part.specifications, part.quantity]);
      }
      await db.execute("INSERT INTO ams_inquiry_events (id, inquiry_id, actor, status, notes) VALUES (?, ?, 'customer', 'new', 'Inquiry submitted with consent')", [randomUUID(), id]);
      await db.execute('INSERT INTO ams_outbox (id, inquiry_id) VALUES (?, ?)', [randomUUID(), id]);
      return { status: 'saved', reference, receivedAt: new Date().toISOString(), notification: 'queued' };
    });
  } catch (error) {
    if (error.code !== 'ER_DUP_ENTRY') throw error;
    const [[existing]] = await pool.execute('SELECT reference, payload_hash, created_at FROM ams_inquiries WHERE request_id = ?', [data.requestId]);
    if (!existing) throw error;
    if (existing.payload_hash !== payloadHash) fail(409, 'This request ID was used for different details. Start a new submission.');
    return { status: 'saved', reference: existing.reference, receivedAt: existing.created_at.replace(' ', 'T') + 'Z', duplicate: true };
  }
}
export async function inquiryDetail(pool, id) {
  const [[inquiry]] = await pool.execute(`SELECT i.*, o.status AS notification_status, o.attempts AS notification_attempts,
    o.last_error AS notification_error, o.sent_at AS notification_sent_at FROM ams_inquiries i LEFT JOIN ams_outbox o ON o.inquiry_id=i.id WHERE i.id=?`, [id]);
  if (!inquiry) fail(404, 'Inquiry not found.');
  const [items] = await pool.execute('SELECT * FROM ams_inquiry_items WHERE inquiry_id=? ORDER BY position', [id]);
  const [events] = await pool.execute('SELECT actor, status, notes, created_at FROM ams_inquiry_events WHERE inquiry_id=? ORDER BY created_at, id', [id]);
  // Request hashes are internal and never needed in the management interface.
  delete inquiry.payload_hash; delete inquiry.request_id;
  return { ...inquiry, services: JSON.parse(inquiry.services), items, events };
}
export function inquiryRoutes(router, pool) {
  router.get('/inquiries', async (req, res) => {
    const { q, page, status } = pageQuery(req.query), values = [], clauses = ['1=1'];
    if (q) { clauses.push('(LOCATE(?, i.reference)>0 OR LOCATE(?, i.company)>0 OR LOCATE(?, i.email)>0 OR LOCATE(?, i.contact_name)>0)'); values.push(q, q, q, q); }
    if (status) { clauses.push('i.status=?'); values.push(status); }
    const where = clauses.join(' AND ');
    const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM ams_inquiries i WHERE ${where}`, values);
    const [inquiries] = await pool.execute(`SELECT i.id, i.reference, i.contact_name, i.email, i.company, i.country, i.status, i.created_at, o.status AS notification_status
      FROM ams_inquiries i JOIN ams_outbox o ON o.inquiry_id=i.id WHERE ${where} ORDER BY i.created_at DESC, i.id LIMIT 24 OFFSET ${(page - 1) * 24}`, values);
    res.json({ inquiries, total, page });
  });
  router.get('/inquiries/:id', async (req, res) => res.json(await inquiryDetail(pool, z.uuid().parse(req.params.id))));
  router.patch('/inquiries/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id), d = inquiryUpdateSchema.parse(req.body);
    await transaction(pool, async db => {
      const [result] = await db.execute('UPDATE ams_inquiries SET status=?, admin_notes=?, version=version+1 WHERE id=? AND version=?', [d.status, d.adminNotes, id, d.version]);
      if (!result.affectedRows) fail(409, 'Inquiry changed. Reload before saving.');
      await db.execute('INSERT INTO ams_inquiry_events (id, inquiry_id, actor, status, notes) VALUES (?, ?, ?, ?, ?)', [randomUUID(), id, req.session.admin_email, d.status, d.adminNotes]);
    });
    res.json({ success: true });
  });
  router.post('/inquiries/:id/retry-notification', async (req, res) => {
    const [result] = await pool.execute("UPDATE ams_outbox SET status='pending', attempts=0, next_attempt_at=UTC_TIMESTAMP(3), last_error='', lease_token=NULL WHERE inquiry_id=? AND status IN ('pending','failed')", [z.uuid().parse(req.params.id)]);
    if (!result.affectedRows) fail(409, 'Notification is already sent or being processed.');
    res.json({ success: true });
  });
}
