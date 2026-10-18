export async function submitInquiry(endpoint, inquiry, { fetcher = fetch, baseUrl = location.href, timeoutMs = 15000 } = {}) {
  const target = new URL(endpoint, baseUrl);
  if (target.origin !== new URL(baseUrl).origin) throw new Error('Inquiry receipt must use this website.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(target.href, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inquiry), signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(response.status === 429 ? 'Too many inquiries. Please try later or download your copy.' : 'Receipt could not be confirmed. Retry or download your copy.');
    const receipt = await response.json();
    const expected = `IQ-${inquiry.requestId.replaceAll('-', '').toUpperCase()}`;
    if (receipt.status !== 'saved' || receipt.reference !== expected || !Number.isFinite(Date.parse(receipt.receivedAt))) {
      throw new Error('Receipt could not be confirmed. Retry or download your copy.');
    }
    return receipt;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Receipt timed out. Retry with the same details; duplicate requests are not saved twice.');
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('Receipt could not be confirmed. Retry or download your copy.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
