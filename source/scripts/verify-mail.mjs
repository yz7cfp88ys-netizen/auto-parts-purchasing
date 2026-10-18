import { loadEnvFile } from 'node:process';
import { readConfig } from '../server/config.js';
import { mailWorker } from '../server/mail.js';
try{loadEnvFile();}catch(error){if(error.code!=='ENOENT')throw error;}
const worker=mailWorker(null,readConfig());
try{await worker.verify();console.log('SMTP connection and authentication verified. No message was sent. Inbox delivery still requires a real inquiry test.');}
catch(error){console.error('SMTP verification failed:',error.code||'NOT_CONFIGURED');process.exitCode=1;}
finally{await worker.stop();}
