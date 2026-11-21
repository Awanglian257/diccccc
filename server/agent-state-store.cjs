'use strict';
// Single-process durable snapshots. Never stores bearer tokens or executes restored tasks.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
class StateStore{
 constructor(file){this.file=path.resolve(file);this.lock=this.file+'.lock';this.locked=false;this.last={version:1,sessions:[]};}
 open(){if(this.locked)return this.last;fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
  try{this.lockFd=fs.openSync(this.lock,'wx',0o600);}catch(e){if(e.code!=='EEXIST')throw e;const pid=Number(fs.readFileSync(this.lock,'utf8'));if(!Number.isInteger(pid)||pid<1)throw Error('Invalid state lock; manual inspection required');let alive=true;try{process.kill(pid,0);}catch(x){if(x.code==='ESRCH')alive=false;else throw x;}if(alive)throw Error('Agent state directory is already owned by another process');fs.unlinkSync(this.lock);this.lockFd=fs.openSync(this.lock,'wx',0o600);}
  fs.writeFileSync(this.lockFd,String(process.pid));fs.fsyncSync(this.lockFd);this.locked=true;this.exit=()=>this.close();process.once('exit',this.exit);
  try{if(fs.existsSync(this.file)){if(fs.statSync(this.file).size>64*1024*1024)throw Error('Agent state file exceeds limit');const d=JSON.parse(fs.readFileSync(this.file,'utf8'));if(d.version!==1||!Array.isArray(d.sessions)||d.sessions.some(s=>!/^[a-f0-9]{64}$/.test(s.key)||!Number.isFinite(s.at)||!Array.isArray(s.engines)))throw Error('Invalid Agent state file');this.last=d;}return this.last;}catch(e){this.close();throw e;}
 }
 write(data){this.open();const bytes=JSON.stringify(data);if(Buffer.byteLength(bytes)>64*1024*1024)throw Error('Agent state exceeds storage limit');const tmp=this.file+'.'+process.pid+'.'+crypto.randomBytes(6).toString('hex')+'.tmp';let fd;
  try{fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(tmp,this.file);if(process.platform!=='win32'){const dir=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}this.last=JSON.parse(bytes);}finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 }
 close(){if(!this.locked)return;this.locked=false;process.removeListener('exit',this.exit);fs.closeSync(this.lockFd);try{if(fs.readFileSync(this.lock,'utf8')===String(process.pid))fs.unlinkSync(this.lock);}catch{}}
}
module.exports={StateStore};
