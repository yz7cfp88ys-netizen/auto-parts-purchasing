import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { categorySchema, productSchema, fail, pageQuery } from './validation.js';

export async function listProducts(pool, query, admin = false) {
  const { q, page, category, vehicleType } = pageQuery(query), values = [], clauses = admin ? ['1=1'] : ['p.active = 1'];
  if (q) { clauses.push('(LOCATE(?, p.name) > 0 OR LOCATE(?, p.sku) > 0 OR LOCATE(?, p.description) > 0 OR LOCATE(?, p.specifications) > 0)'); values.push(q, q, q, q); }
  if (category) { clauses.push('p.category_id = ?'); values.push(category); }
  if (vehicleType) { clauses.push("(p.vehicle_type = ? OR p.vehicle_type = 'both')"); values.push(vehicleType); }
  const where = clauses.join(' AND ');
  const [[{ total }]] = await pool.execute(`SELECT COUNT(*) AS total FROM ams_products p WHERE ${where}`, values);
  const [products] = await pool.execute(`SELECT p.id, p.sku, p.name, p.category_id AS categoryId, c.name AS category,
    p.vehicle_type AS vehicleType, p.description, p.specifications, p.image_url AS imageUrl, p.active, p.version
    FROM ams_products p JOIN ams_categories c ON c.id = p.category_id WHERE ${where} ORDER BY p.created_at DESC, p.id LIMIT 24 OFFSET ${(page - 1) * 24}`, values);
  return { products: products.map(p => ({ ...p, active: Boolean(p.active) })), total, page };
}
export function catalogRoutes(router, pool) {
  router.get('/products', async (req, res) => res.json(await listProducts(pool, req.query, true)));
  router.post('/categories', async (req, res) => {
    const data = categorySchema.parse(req.body), id = randomUUID();
    await pool.execute('INSERT INTO ams_categories (id, name) VALUES (?, ?)', [id, data.name]);
    res.status(201).json({ id, ...data });
  });
  router.put('/categories/:id', async (req, res) => {
    const data = categorySchema.parse(req.body);
    const [result] = await pool.execute('UPDATE ams_categories SET name = ? WHERE id = ?', [data.name, z.uuid().parse(req.params.id)]);
    if (!result.affectedRows) fail(404, 'Category not found.'); res.json({ success: true });
  });
  router.delete('/categories/:id', async (req, res) => {
    const [result] = await pool.execute('DELETE FROM ams_categories WHERE id = ?', [z.uuid().parse(req.params.id)]);
    if (!result.affectedRows) fail(404, 'Category not found.'); res.json({ success: true });
  });
  router.post('/products', async (req, res) => {
    const d = productSchema.parse(req.body), id = randomUUID();
    await pool.execute(`INSERT INTO ams_products (id, sku, name, category_id, vehicle_type, description, specifications, image_url, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, d.sku, d.name, d.categoryId, d.vehicleType, d.description, d.specifications, d.imageUrl, d.active]);
    res.status(201).json({ id, ...d, version: 1 });
  });
  router.put('/products/:id', async (req, res) => {
    const d = productSchema.parse(req.body); if (!d.version) fail(400, 'Product version is required.');
    const [result] = await pool.execute(`UPDATE ams_products SET sku=?, name=?, category_id=?, vehicle_type=?, description=?, specifications=?, image_url=?, active=?, version=version+1
      WHERE id=? AND version=?`, [d.sku, d.name, d.categoryId, d.vehicleType, d.description, d.specifications, d.imageUrl, d.active, z.uuid().parse(req.params.id), d.version]);
    if (!result.affectedRows) fail(409, 'Product changed or was removed. Reload before editing.'); res.json({ success: true });
  });
  router.delete('/products/:id', async (req, res) => {
    // Retire products rather than destroy references needed by old inquiries.
    const [result] = await pool.execute('UPDATE ams_products SET active=0, version=version+1 WHERE id=?', [z.uuid().parse(req.params.id)]);
    if (!result.affectedRows) fail(404, 'Product not found.'); res.json({ success: true });
  });
}
