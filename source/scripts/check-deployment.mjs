import {readFile,access,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(await readFile(path.join(root,'config/hostinger.json'),'utf8'));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
if(manifest.nodeVersion!=='22'||manifest.framework!=='express'||manifest.outputDirectory!=='.'||pkg.scripts.start!=='node server.js')throw new Error('Hostinger runtime settings mismatch');
for(const file of ['server.js','source/server/index.js','source/server/schema.sql','package-lock.json','dist/public/index.html','dist/public/admin.html','.env.example'])await access(path.join(root,file));
for(const directory of ['source/server','source/tests'])for(const file of await readdir(path.join(root,directory))){if(!/\.(js|mjs)$/.test(file))continue;const result=spawnSync(process.execPath,['--check',path.join(root,directory,file)],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
const html=await readFile(path.join(root,'dist/public/index.html'),'utf8');
for(const match of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g))await access(path.join(root,'dist/public',match[1]));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);if(new Set(ids).size!==ids.length)throw new Error('Duplicate IDs in Node build');
for(const match of html.matchAll(/href="#([^"]+)"/g))if(!ids.includes(match[1]))throw new Error('Broken Node build anchor: '+match[1]);
if(/api\/.*\.php|src="\.\/cart.js"|src="\.\/search.js"/.test(html))throw new Error('Legacy PHP scripts leaked into Node build');
for(const file of await readdir(path.join(root,'dist/public')))if(/\.(php|sql|sqlite|env)$/.test(file))throw new Error('Private or legacy file in public directory');
const site=JSON.parse(await readFile(path.join(root,'dist/public/site.json'),'utf8'));if(site.inquiryEndpoint!=='/api/inquiries')throw new Error('Live inquiry endpoint missing');
console.log('Deployment structure, Node 22 manifest, JS syntax, built assets, anchors and private/public boundary passed. Hostinger account, DNS, DB and SMTP still require production verification.');
