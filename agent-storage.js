(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HealthAgentStorage=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const JOURNAL='hm_agent_commit_journal_v1';
function create(storage){
 function journal(){const value=storage.getItem(JOURNAL);if(value===null)return null;const j=JSON.parse(value);if(j.version!==1||!['prepared','committed'].includes(j.state)||!Array.isArray(j.changes)||j.changes.some(c=>typeof c.key!=='string'||c.key===JOURNAL||![c.before,c.after].every(v=>v===null||typeof v==='string')))throw Error('存储恢复信息损坏，请保留数据并联系支持');return j;}
 function write(key,value){if(value===null)storage.removeItem(key);else storage.setItem(key,value);if(storage.getItem(key)!==value)throw Error('本机存储写入校验失败');}
 function read(key){const j=journal(),c=j?.changes.find(c=>c.key===key);return c?c[j.state==='committed'?'after':'before']:storage.getItem(key);}
 function recover(){const j=journal();if(!j)return;for(const c of j.changes)write(c.key,c[j.state==='committed'?'after':'before']);storage.removeItem(JOURNAL);if(storage.getItem(JOURNAL)!==null)throw Error('无法完成本机存储恢复');}
 function transaction(updates,options={}){
  recover();const changes=Object.entries(updates).map(([key,after])=>{if(key===JOURNAL||typeof after!=='string')throw Error('存储更新格式无效');return {key,before:storage.getItem(key),after};});
  const j={version:1,state:'prepared',changes};let prepared=false,committed=false;
  try{options.guard?.();write(JOURNAL,JSON.stringify(j));prepared=true;for(const c of changes){options.guard?.();write(c.key,c.after);}options.guard?.();j.state='committed';write(JOURNAL,JSON.stringify(j));committed=true;
  }catch(error){if(prepared&&!committed){try{for(const c of changes)if(storage.getItem(c.key)!==c.before)write(c.key,c.before);storage.removeItem(JOURNAL);}catch{/* Keep journal: readers see old values; recover before next write. */}}throw error;}
  try{storage.removeItem(JOURNAL);}catch{/* Commit point persisted; next startup rolls forward. */}return true;
 }
 return {read,recover,transaction};
}
return {JOURNAL,create};
});
