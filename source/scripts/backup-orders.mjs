import {mkdir,cp,copyFile,readdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url));
const directory=path.join(root,'backup','mixed-orders-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));
await mkdir(directory,{recursive:true});
for(const name of ['source','config','docs','README.md','package.json','.gitignore'])await cp(path.join(root,name),path.join(directory,name),{recursive:true});
const privateDir=process.env.ORDER_STORAGE_DIR||path.join(root,'data/orders-private'),privateBackup=path.join(directory,'private');await mkdir(privateBackup);
if(process.env.PARTS_STORAGE_DIR&&path.resolve(process.env.PARTS_STORAGE_DIR)!==path.resolve(privateDir))throw new Error('Parts and orders use separate storage. Back up both directories explicitly; this backup is incomplete.');
const names=await readdir(privateDir);
const php=process.env.PHP_BINARY||path.join(root,'data/runtime/php-8.5.11/php.exe');
const args=process.env.PHP_BINARY?[]:['-d',`extension_dir=${path.join(root,'data/runtime/php-8.5.11/ext')}`,'-d','extension=pdo_sqlite'];
for(const name of names){
  if(name.endsWith('.sqlite')){
    const result=spawnSync(php,[...args,'-r','$db=new PDO("sqlite:".$argv[1]);$db->exec("PRAGMA busy_timeout=10000");$db->exec("VACUUM INTO ".$db->quote($argv[2]));$copy=new PDO("sqlite:".$argv[2]);if($copy->query("PRAGMA integrity_check")->fetchColumn()!=="ok")exit(1);',path.join(privateDir,name),path.join(privateBackup,name)],{encoding:'utf8'});
    if(result.status!==0)throw new Error('Database backup did not verify: '+(result.stderr||result.error?.message));
  }else if(name==='settings.json')await copyFile(path.join(privateDir,name),path.join(privateBackup,name));
}
const hashes={};for(const name of await readdir(privateBackup)){const bytes=await readFile(path.join(privateBackup,name));hashes[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
if(names.includes('parts.sqlite')){
  // Read image references from the consistent DB snapshot. Uploaded files are immutable.
  const listing=spawnSync(php,[...args,'-r','$d=new PDO("sqlite:".$argv[1]);echo json_encode($d->query("SELECT disk_name,sha256 FROM sourcing_files")->fetchAll(PDO::FETCH_ASSOC));',path.join(privateBackup,'parts.sqlite')],{encoding:'utf8'});
  if(listing.status!==0)throw new Error('Cannot enumerate sourcing image references');
  const images=JSON.parse(listing.stdout);if(images.length)await mkdir(path.join(privateBackup,'sourcing-images'));
  for(const image of images){
    if(!/^[a-f0-9]{32}\.bin$/.test(image.disk_name))throw new Error('Invalid stored image filename');
    const relative='sourcing-images/'+image.disk_name;await copyFile(path.join(privateDir,relative),path.join(privateBackup,relative));
    const bytes=await readFile(path.join(privateBackup,relative)),sha256=createHash('sha256').update(bytes).digest('hex');
    if(sha256!==image.sha256)throw new Error('Sourcing image backup did not verify');
    hashes[relative]={bytes:bytes.length,sha256};
  }
}
await writeFile(path.join(directory,'backup-verification.json'),JSON.stringify({createdAt:new Date().toISOString(),sourceProject:root,sqliteIntegrity:'ok',files:hashes},null,2));
console.log('Verified D-drive stage backup: '+directory);
