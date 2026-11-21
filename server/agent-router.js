'use strict';
const crypto=require('crypto'),fs=require('fs'),path=require('path');
const Core=require('../agent-core.js'),legacyTdee=require('./legacy-tdee.js'),FOODS=require('./foods.json');
const sessions=new Map(),MAX_BODY=512*1024;
function send(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
function originAllowed(req){const host=req.headers.host||'';if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&host!==process.env.AGENT_PUBLIC_HOST)return false;const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===host;}catch{return false;}}
function read(req){return new Promise((resolve,reject)=>{let size=0,s='';req.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){reject(new Core.AgentError('BODY_TOO_LARGE','Agent 请求体过大'));return;}s+=chunk;});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'));}catch{reject(new Core.AgentError('JSON','请求格式无效'));}});req.on('error',reject);});}
async function modelLoop(args,controller){return require('./deepseek-model.cjs').modelLoop(args,controller);}

async function route(req,res,url){
 if(!url.pathname.startsWith('/api/agents'))return false;
 if(!originAllowed(req)){send(res,403,{success:false,error_code:'ORIGIN',message:'只允许同源访问；部署时需设置AGENT_PUBLIC_HOST'});return true;}
 const now=Date.now();for(const [id,s]of sessions)if(now-s.at>3600000){for(const engine of s.engines.values())engine.adapter.abort?.();sessions.delete(id);}
 try{
  if(req.method==='GET'&&url.pathname==='/api/agents/session'){
   if(sessions.size>100)throw new Core.AgentError('RATE_LIMIT','会话过多');const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{at:now,engines:new Map(),minute:now,count:0});send(res,200,{success:true,token,model_configured:!!process.env.DEEPSEEK_API_KEY,version:Core.VERSION});return true;
  }
  const token=String(req.headers.authorization||'').replace(/^Bearer /,''),session=sessions.get(token);if(!session){send(res,401,{success:false,error_code:'SESSION',message:'会话已过期，请重试'});return true;}session.at=now;
  const match=url.pathname.match(/^\/api\/agents\/tasks\/([^/]+)(?:\/(confirm|cancel))?$/);
  if(match){const engine=session.engines.get(match[1]),task=engine?.tasks.get(match[1]);if(!task){send(res,404,{success:false,error_code:'NOT_FOUND'});return true;}
   if(req.method==='GET'&&!match[2]){send(res,200,{success:true,task});return true;}
   if(req.method==='POST'&&match[2]){const body=await read(req);const result=match[2]==='cancel'?engine.cancel(task.id):await engine.confirm(task.id,body.confirmed===true,body.plan_id);send(res,200,{success:true,task:result});return true;}
  }
  if(req.method==='POST'&&url.pathname==='/api/agents/tasks'){
   if(now-session.minute>60000){session.minute=now;session.count=0;}if(++session.count>12)throw new Core.AgentError('RATE_LIMIT','每分钟最多12个Agent任务');if(session.engines.size>=30)throw new Core.AgentError('TASK_LIMIT','会话任务已达上限，请刷新会话');
   const body=await read(req);if(body.authorized!==true)throw new Core.AgentError('CONSENT','缺少本次后端数据授权');if(body.input?.use_model&&body.model_consent!==true)throw new Core.AgentError('CONSENT','缺少本次模型数据授权');
   const controller=new AbortController();const engine=new Core.Orchestrator(body.context,{foods:FOODS,calculateTdee:c=>c.profile?legacyTdee(c.profile,c):{ok:false,reason:'缺少身体基准'},timeoutMs:150000,abort:()=>controller.abort(),model:args=>modelLoop(args,controller),onUpdate:task=>{if(!session.engines.has(task.id))session.engines.set(task.id,engine);}});
   // Creation returns immediately. Polling exposes only actual task/tool states.
   const pending=engine.run(body.kind,body.input||{});const task=[...engine.tasks.values()][0];session.engines.set(task.id,engine);pending.catch(()=>{});send(res,202,{success:true,task});return true;
  }
  send(res,404,{success:false,error_code:'NOT_FOUND'});return true;
 }catch(e){send(res,e.code==='BODY_TOO_LARGE'?413:400,{success:false,error_code:e.code||'FAILED',message:e.message,warnings:[],source:'Agent router',timestamp:new Date().toISOString()});return true;}
}
module.exports={route,modelLoop,_sessions:sessions,originAllowed};
