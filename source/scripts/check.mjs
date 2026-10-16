import {readFile,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const html=await readFile(path.join(root,'source','index.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
if(new Set(ids).size!==ids.length)throw new Error('Duplicate HTML IDs');
for(const match of html.matchAll(/href="#([^"]+)"/g))if(!ids.includes(match[1]))throw new Error(`Broken anchor: ${match[1]}`);
for(const match of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g))await access(path.join(root,'source',match[1]));
for(const file of ['app.js','inquiry.js','scripts/build.mjs','scripts/serve.mjs']){const result=spawnSync(process.execPath,['--check',path.join(root,'source',file)],{encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
JSON.parse(await readFile(path.join(root,'config','site.json'),'utf8'));
console.log(`Checked JavaScript syntax, configuration, ${ids.length} unique IDs, local assets and navigation targets.`);
