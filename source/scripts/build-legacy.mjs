import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const hostinger=process.argv.includes('--hostinger');
const source=path.join(root,'source');const dist=path.join(root,hostinger?'data/hostinger-release/public_html':'dist');
await mkdir(path.join(dist,'assets'),{recursive:true});
for(const file of ['index.html','styles.css','app.js','inquiry.js','delivery.js','cart.js','orders-client.js','orders.css','admin.html','admin.js','search.js','search.css','search-admin.js'])await copyFile(path.join(source,file),path.join(dist,file));
for(const file of await readdir(path.join(source,'assets')))await copyFile(path.join(source,'assets',file),path.join(dist,'assets',file));
const settings=JSON.parse(await readFile(path.join(root,'config','site.json'),'utf8'));
settings.inquiryEndpoint=hostinger?'./api/inquiries.php':'';
settings.orderEndpoint=hostinger?'./api/orders.php':'';
settings.partsEndpoint=hostinger?'./api/parts.php':'';
settings.sourcingEndpoint=hostinger?'./api/sourcing.php':'';
if(hostinger){
  await mkdir(path.join(dist,'api'),{recursive:true});
  for(const file of ['inquiries.php','orders.php','paypal.php','parts.php','parts-core.php','parts-schema.sql','sourcing.php'])await copyFile(path.join(source,'api',file),path.join(dist,'api',file));
  await copyFile(path.join(root,'config/catalog.json'),path.join(dist,'api/catalog.json'));
  await writeFile(path.join(dist,'.htaccess'),'Options -Indexes\nSetEnvIf Authorization "(.+)" HTTP_AUTHORIZATION=$1\n<FilesMatch "\\.(sqlite|log|ini)$">\nRequire all denied\n</FilesMatch>\n');
  await writeFile(path.join(dist,'.user.ini'),'upload_max_filesize=5M\npost_max_size=16M\nmax_file_uploads=3\n');
  await writeFile(path.join(dist,'api','.htaccess'),'<FilesMatch "^(parts-core\\.php|parts-schema\\.sql)$">\nRequire all denied\n</FilesMatch>\n');
}
await writeFile(path.join(dist,'site.json'),JSON.stringify(settings,null,2)+'\n');
await writeFile(path.join(dist,'.nojekyll'),'');
await writeFile(path.join(dist,'robots.txt'),'User-agent: *\nAllow: /\n'+(settings.siteUrl?`Sitemap: ${settings.siteUrl.replace(/\/$/,'')}/sitemap.xml\n`:''));
if(settings.siteUrl){const url=new URL(settings.siteUrl);if(!['http:','https:'].includes(url.protocol))throw new Error('siteUrl must use http or https');const escaped=url.href.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));await writeFile(path.join(dist,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escaped}</loc></url></urlset>`);}
console.log(hostinger?'Built PHP/HTML Hostinger release in data/hostinger-release/public_html/; orders require PHP 8.1+, pdo_sqlite, private storage; PayPal requires cURL and private merchant settings.':'Built static website in dist/ (online ordering and receipt disabled).');
