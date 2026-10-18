import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.argv.includes('--hostinger')) {
  await import('./build-legacy.mjs');
} else {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const source = path.join(root, 'source'), output = path.join(root, 'dist/public');
  await mkdir(path.join(output, 'assets'), { recursive: true });
  const files = ['styles.css', 'app.js', 'inquiry.js', 'delivery.js', 'orders.css', 'search.css', 'procurement.js', 'management.js', 'management.css'];
  for (const file of files) await copyFile(path.join(source, file), path.join(output, file));
  for (const file of await readdir(path.join(source, 'assets'))) await copyFile(path.join(source, 'assets', file), path.join(output, 'assets', file));
  await copyFile(path.join(source, 'management.html'), path.join(output, 'admin.html'));
  let html = await readFile(path.join(source, 'index.html'), 'utf8');
  html = html.replace('<script type="module" src="./cart.js"></script>', '<script type="module" src="./procurement.js"></script>')
    .replace('<script type="module" src="./search.js"></script>', '<link rel="stylesheet" href="./management.css">')
    .replace(/<section id="find-parts"[\s\S]*?<\/section>/, `<section id="find-parts" class="parts-finder section-shell" aria-labelledby="finder-heading">
      <div class="section-heading"><div><h2 id="finder-heading">Your next part starts here.</h2><p>Browse our catalogue or add any part you need to your purchasing brief.</p></div><a class="text-link" href="#inquiry">Request a part</a></div>
      <div class="form-row"><label>Category<select id="catalog-category"><option value="">All categories</option></select></label><label>Vehicle type<select id="catalog-vehicle"><option value="">Cars & motorcycles</option><option value="auto">Automotive</option><option value="moto">Motorcycle</option></select></label></div>
      <p id="catalog-status" role="status" aria-live="polite">Loading products…</p><div id="product-results" class="procurement-products"></div><div id="product-pagination" class="finder-actions"></div>
      </section>`)
    .replace('href="#source-part"', 'href="#inquiry"')
    .replace('Find Parts by Vehicle</a>', 'Browse products</a>')
    .replace('Search by number directly, or narrow your search by vehicle.', 'Search product names, references and specifications. Compatibility is confirmed in your quotation.')
    .replace('<section id="shop" class="shop-section section-shell" aria-label="Mixed-parts shopping cart"></section>', '<section id="shop" class="section-shell"><p>Build one purchasing brief with catalogue products and custom parts. <a class="text-link" href="#inquiry">View your procurement list</a></p></section>')
    .replace('<button class="button form-submit"', '<label class="inquiry-consent"><input type="checkbox" name="consent" required> I agree that PARTSBRIDGE may store my contact details and parts list to respond to this inquiry.</label><button class="button form-submit"');
  await writeFile(path.join(output, 'index.html'), html);
  const site = JSON.parse(await readFile(path.join(root, 'config/site.json'), 'utf8'));
  await writeFile(path.join(output, 'site.json'), JSON.stringify({ ...site, siteUrl: 'https://automotosourcing.com', inquiryEndpoint: '/api/inquiries', productsEndpoint: '/api/products' }, null, 2));
  await writeFile(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: https://automotosourcing.com/sitemap.xml\n');
  await writeFile(path.join(output, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://automotosourcing.com/</loc></url></urlset>');
  console.log('Built Node.js public assets: dist/public. Runtime: node server.js. No database or secrets are bundled.');
}
