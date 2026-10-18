import { z } from 'zod';
const text = (max, min = 0) => z.string().trim().min(min).max(max).refine(v => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v), 'Invalid control characters');
export const categorySchema = z.object({ name: text(120, 1) }).strict();
export const productSchema = z.object({
  sku: text(80, 1).regex(/^[a-zA-Z0-9._/-]+$/), name: text(200, 1), categoryId: z.uuid(),
  vehicleType: z.enum(['auto', 'moto', 'both']), description: text(5000).default(''),
  specifications: text(3000).default(''), imageUrl: z.union([z.literal(''), z.url().max(2000).refine(v => v.startsWith('https://'), 'Use an HTTPS image URL')]).default(''),
  active: z.boolean().default(true), version: z.number().int().positive().optional(),
}).strict();
export const inquirySchema = z.object({
  requestId: z.uuid(), name: text(100, 1), email: z.email().max(200).transform(v => v.toLowerCase()),
  company: text(160, 1), country: text(100, 1), phone: text(80).default(''),
  business: text(100, 1), orderType: text(100, 1), notes: text(3000).default(''),
  services: z.array(text(100, 1)).max(10).default([]), consent: z.literal(true),
  website: z.literal('').default(''), locale: z.enum(['en']).default('en'),
  parts: z.array(z.object({
    productId: z.uuid().optional(), description: text(300, 1),
    specifications: text(3000).default(''), quantity: z.number().int().min(1).max(1000000),
  }).strict()).min(1).max(30),
}).strict();
export const statuses = ['new', 'reviewing', 'quoted', 'closed', 'spam'];
export const inquiryUpdateSchema = z.object({ status: z.enum(statuses), adminNotes: text(5000), version: z.number().int().positive() }).strict();
export function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
export function pageQuery(query) {
  return z.object({ q: text(150).default(''), page: z.coerce.number().int().min(1).max(10000).default(1),
    category: z.union([z.uuid(), z.literal('')]).default(''), vehicleType: z.enum(['', 'auto', 'moto', 'both']).default(''),
    status: z.enum(['', ...statuses]).default(''),
  }).strict().parse(query);
}
