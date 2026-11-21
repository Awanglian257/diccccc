'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path');
const Core=require('../agent-core.js'),legacyTdee=require('./legacy-tdee.js'),FOODS=require('./foods.json');
const sessions=new Map(),MAX_BODY=512*1024;
const {StateStore}=require('./agent-state-store.cjs');
let store=null,restored=new Map(),storageError=null;
const sessionHash=token=>crypto.createHash('sha256').update(token).digest('hex');
function exportEngine(engine){return {context:Core.clone(engine.context),tasks:[...engine.tasks.values()].map(Core.clone),drafts:[...engine.drafts.values()].map(Core.clone)};}
function snapshot(){const rows=new Map(restored);for(const [token,session]of sessions)rows.set(sessionHash(token),session);return {version:1,sessions:[...rows].map(([key,s])=>({key,at:s.at,minute:s.minute,count:s.count,engines:[...new Set(s.engines.values())].map(exportEngine)}))};}
function flush(){try{store.write(snapshot());storageError=null;}catch(e){storageError=e;throw new Core.AgentError('PERSISTENCE','后端状态无法持久化；未确认成功，请保留原提交标识后重试');}}
function makeEngine(context,session){const controller=new AbortController();let engine;engine=new Core.Orchestrator(context,{calculateTdee:c=>c.profile?legacyTdee(c.profile,c):{ok:false,reason:'缺少身体基准'},timeoutMs:150000,abort:()=>controller.abort(),model:args=>modelLoop(args,controller),onUpdate:task=>{session.engines.set(task.id,engine);if(task.status!=='running')flush();}});return engine;}
function restoreEngine(row,session){if(!row||!Array.isArray(row.tasks)||!Array.isArray(row.drafts))throw Error('Invalid saved engine');const engine=makeEngine(row.context,session);for(const t of row.tasks){Core.schemaCheck(t,Core.taskSchema);if(['pending','running'].includes(t.status)){t.status='failed';t.requires_confirmation=false;t.error={code:'PROCESS_INTERRUPTED',message:'后端进程中断，任务未自动重跑，请核对后重新处理'};t.updated_at=new Date().toISOString();}if(t.persistence_status==='committing'){t.persistence_status='pending';t.error={code:'COMMIT_INTERRUPTED',message:'提交结果尚未持久化，请使用原标识查询后重试'};}if(t.persistence_status==='persisted'&&(!t.confirmation?.id||!t.confirmed_action||t.status!=='completed'))throw Error('Inconsistent committed task');engine.tasks.set(t.id,t);session.engines.set(t.id,engine);}for(const draft of row.drafts){Core.schemaCheck(draft,Core.resultSchemas.planning);engine.drafts.set(draft.plan_id,draft);}return engine;}
function ensureStore(){if(store)return;const candidate=new StateStore(process.env.AGENT_STATE_FILE||path.join(__dirname,'data','agent-state.json'));try{const saved=candidate.open(),loaded=new Map();for(const row of saved.sessions){const session={at:row.at,minute:row.minute,count:row.count,engines:new Map()};for(const engine of row.engines)restoreEngine(engine,session);loaded.set(row.key,session);}store=candidate;restored=loaded;flush();}catch(e){candidate.close();store=null;throw new Core.AgentError('PERSISTENCE','后端恢复失败，原状态文件已保留，请检查存储或损坏数据');}}
function resetEngine(engine,before){engine.context=before.context;for(const row of before.tasks){const old=engine.tasks.get(row.id);if(old){for(const k of Object.keys(old))delete old[k];Object.assign(old,row);}else engine.tasks.set(row.id,row);}engine.drafts=new Map(before.drafts.map(d=>[d.plan_id,d]));}
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function originAllowed(req){const host=req.headers.host||'';if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&host!==process.env.AGENT_PUBLIC_HOST)return false;const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===host;}catch{return false;}}
function read(req){return new Promise((resolve,reject)=>{let size=0,s='';req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(new Core.AgentError('BODY_TOO_LARGE','Agent 请求体过大'));return;}s+=chunk;});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(new Core.AgentError('JSON','请求格式无效'));}});req.on('error',reject);});}
async function modelLoop(args,controller){return require('./deepseek-model.cjs').modelLoop(args,controller);}

async function route(req,res,url){
 if(!url.pathname.startsWith('/api/agents'))return false;
 if(!originAllowed(req)){send(res,403,{success:false,error_code:'ORIGIN',message:'只允许同源访问；部署时需设置AGENT_PUBLIC_HOST'});return true;}
 const now=Date.now();
 try{ensureStore();if(storageError)flush();}catch(e){send(res,503,{success:false,error_code:'PERSISTENCE',message:e.message});return true;}
 for(const [id,s]of sessions)if(now-s.at>3600000){for(const engine of s.engines.values())engine.adapter.abort?.();sessions.delete(id);}
 try{
  if(req.method==='GET'&&url.pathname==='/api/agents/session'){
   if(sessions.size>100)throw new Core.AgentError('RATE_LIMIT','会话过多');const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{at:now,engines:new Map(),minute:now,count:0});flush();send(res,200,{success:true,token,model_configured:!!process.env.DEEPSEEK_API_KEY,version:Core.VERSION});return true;
  }
  const token=String(req.headers.authorization||'').replace(/^Bearer /,''),session=sessions.get(token)||restored.get(sessionHash(token));if(!session||now-session.at>3600000){send(res,401,{success:false,error_code:'SESSION',message:'会话已过期，请重试'});return true;}sessions.set(token,session);restored.delete(sessionHash(token));session.at=now;flush();
  const match=url.pathname.match(/^\/api\/agents\/tasks\/([^/]+)(?:\/(confirm|cancel|commit|commit-status))?$/);
  if(match){const engine=session.engines.get(match[1]),task=engine?.tasks.get(match[1]);if(!task){send(res,404,{success:false,error_code:'NOT_FOUND'});return true;}
   if(req.method==='GET'&&match[2]==='commit-status'){const result=engine.commitStatus(task.id,url.searchParams.get('confirmation_id'));send(res,200,{success:true,...result});return true;}
   if(req.method==='GET'&&!match[2]){send(res,200,{success:true,task});return true;}
   if(req.method==='POST'&&match[2]&&match[2]!=='commit-status'){const body=await read(req),before=exportEngine(engine);try{const result=match[2]==='cancel'?engine.cancel(task.id):match[2]==='commit'?await engine.acknowledgeCommit(task.id,body):await engine.confirm(task.id,body.confirmed===true,body.plan_id,{deferCommit:body.defer_commit===true,contextRevision:body.context_revision,idempotencyKey:body.idempotency_key});flush();send(res,200,{success:true,task:result});}catch(e){resetEngine(engine,before);try{flush();}catch{}throw e;}return true;}
  }
  if(req.method==='POST'&&url.pathname==='/api/agents/tasks'){
   if(now-session.minute>60000){session.minute=now;session.count=0;}if(++session.count>12)throw new Core.AgentError('RATE_LIMIT','每分钟最多12个Agent任务');if(session.engines.size>=30)throw new Core.AgentError('TASK_LIMIT','会话任务已达上限，请刷新会话');
   const body=await read(req);if(body.authorized!==true)throw new Core.AgentError('CONSENT','缺少本次后端数据授权');if(body.input?.use_model&&body.model_consent!==true)throw new Core.AgentError('CONSENT','缺少本次模型数据授权');
   const normalized=Core.normalizeContext(body.context,FOODS),engine=makeEngine(normalized,session);
   // Creation returns immediately. Polling exposes only actual task/tool states.
   const pending=engine.run(body.kind,body.input||{});const task=[...engine.tasks.values()][0];session.engines.set(task.id,engine);pending.catch(e=>{const t=engine.tasks.get(task.id);if(t){t.status='failed';t.requires_confirmation=false;t.error={code:e.code||'PERSISTENCE',message:'任务执行或状态保存中断，未自动重跑'};}try{flush();}catch{}});flush();send(res,202,{success:true,task});return true;
  }
  send(res,404,{success:false,error_code:'NOT_FOUND'});return true;
 }catch(e){send(res,e.code==='BODY_TOO_LARGE'?413:e.code==='PERSISTENCE'?503:['CONTEXT_CHANGED','DRAFT_EXPIRED','STATE'].includes(e.code)?409:400,{success:false,error_code:e.code||'FAILED',message:e.message,warnings:[],source:'Agent router',timestamp:new Date().toISOString()});return true;}
}
module.exports={route,modelLoop,_sessions:sessions,originAllowed};
