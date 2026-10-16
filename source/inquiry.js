export function validateInquiry(data) {
  if (!data.name?.trim() || !data.company?.trim() || !data.country?.trim() || !data.business || !data.orderType) throw new Error('Please complete your contact and business details.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email || '')) throw new Error('Please enter a valid business email.');
  if (!Array.isArray(data.parts) || !data.parts.length || data.parts.length > 30) throw new Error('Include between 1 and 30 parts.');
  for (const part of data.parts) {
    if (!part.description?.trim()) throw new Error('Add a description for each part.');
    if (!Number.isSafeInteger(part.quantity) || part.quantity < 1 || part.quantity > 1000000) throw new Error('Part quantities must be whole numbers from 1 to 1,000,000.');
  }
  return data;
}

export function formatInquiry(data) {
  validateInquiry(data);
  const line = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return [
    'PARTSBRIDGE — PURCHASING INQUIRY',
    'Inquiry only. Not an order or a confirmed quotation.',
    '',
    `Name: ${line(data.name)}`, `Business email: ${line(data.email)}`,
    `Company: ${line(data.company)}`, `Business type: ${line(data.business)}`,
    `Destination country: ${line(data.country)}`, `Order type: ${line(data.orderType)}`,
    '', 'PARTS REQUIRED',
    ...data.parts.map((part, index) => `${index + 1}. ${line(part.description)} | Quantity: ${part.quantity}`),
    '', `Support requested: ${data.services?.length ? data.services.map(line).join(', ') : 'To be discussed'}`,
    '', 'ADDITIONAL REQUIREMENTS', data.notes?.trim() || 'None provided.',
    '', 'Please confirm product identity, fitment, availability, MOQ, pricing, lead time,',
    'inspection scope, shipping terms and payment terms before an order is placed.',
  ].join('\n');
}
