import { loadEnvFile } from 'node:process';
import { randomBytes } from 'node:crypto';
import { readConfig } from '../server/config.js';
import { hashPassword } from '../server/auth.js';
import { createPool, migrate } from '../server/db.js';
import { createApp } from '../server/app.js';
import { mailWorker } from '../server/mail.js';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
try{loadEnvFile('data/node-local.env');}catch(error){if(error.code!=='ENOENT')throw error;}
export async function fixture(){
  const database=process.env.TEST_DB_NAME;
  if(!database||!/^ams_test(?:_[a-z0-9]+)?$/.test(database))throw new Error('TEST_DB_NAME must name a dedicated ams_test database. Tests never use the business database.');
  const password=randomBytes(24).toString('base64url');
  const config=readConfig({...process.env,NODE_ENV:'test',DB_NAME:database,PORT:'0',APP_URL:'http://127.0.0.1:3000',ADMIN_EMAIL:'admin@example.test',ADMIN_PASSWORD_HASH:await hashPassword(password),TRUST_PROXY_HOPS:'0',SMTP_HOST:'',SMTP_USER:'',SMTP_PASSWORD:'',MAIL_FROM:'',INQUIRY_NOTIFY_TO:''});
  let pool=createPool(config);await migrate(pool);
  let server,base,worker;
  async function start(){
    worker=mailWorker(pool,config);server=createApp(pool,config,fileURLToPath(new URL('../../dist/public/',import.meta.url)),worker).listen(0,'127.0.0.1');await once(server,'listening');
    base=`http://127.0.0.1:${server.address().port}`;config.origin=base;return base;
  }
  async function restart(){await new Promise(resolve=>server.close(resolve));await worker.stop();await pool.end();pool=createPool(config);return start();}
  await start();
  return {get pool(){return pool;},config,password,get base(){return base;},start,restart,async close(){await new Promise(resolve=>server.close(resolve));await worker.stop();await pool.end();}};
}
