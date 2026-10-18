import { hashPassword } from '../server/auth.js';
import readline from 'node:readline';
console.error('Choose a unique administrator password (14–200 characters). It will not be saved.');
let password='';
if(process.stdin.isTTY){
  readline.emitKeypressEvents(process.stdin);process.stdin.setRawMode(true);process.stdin.resume();
  password=await new Promise(resolve=>{
    let value='';process.stdin.on('keypress',(text,key)=>{
      if(key?.ctrl&&key.name==='c')process.exit(130);
      if(key?.name==='return'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.removeAllListeners('keypress');resolve(value);}
      else if(key?.name==='backspace')value=value.slice(0,-1);else if(text&&!key?.ctrl)value+=text;
    });
  });
}else{for await(const chunk of process.stdin)password+=chunk;password=password.replace(/[\r\n]+$/,'');}
console.log(await hashPassword(password));
