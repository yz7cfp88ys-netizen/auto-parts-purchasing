import { mkdir, readdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=path.join(root,'source');const dist=path.join(root,'dist');
await mkdir(path.join(dist,'assets'),{recursive:true});
for(const file of ['index.html','styles.css','app.js','inquiry.js'])await copyFile(path.join(source,file),path.join(dist,file));
for(const file of await readdir(path.join(source,'assets')))await copyFile(path.join(source,'assets',file),path.join(dist,'assets',file));
const settings=JSON.parse(await readFile(path.join(root,'config','site.json'),'utf8'));
await writeFile(path.join(dist,'site.json'),JSON.stringify(settings,null,2)+'\n');
await writeFile(path.join(dist,'.nojekyll'),'');
await writeFile(path.join(dist,'robots.txt'),'User-agent: *\nAllow: /\n'+(settings.siteUrl?`Sitemap: ${settings.siteUrl.replace(/\/$/,'')}/sitemap.xml\n`:''));
if(settings.siteUrl){const url=new URL(settings.siteUrl);if(!['http:','https:'].includes(url.protocol))throw new Error('siteUrl must use http or https');const escaped=url.href.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[char]));await writeFile(path.join(dist,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escaped}</loc></url></urlset>`);}
console.log('Built static website in dist/ (no dependencies required).');
