'use strict';// Dedicated child-process fixture: never loads server/.env or calls a real model.
process.env.DEEPSEEK_API_KEY='';process.env.RUN_REAL_AGENT_TESTS='0';
const {createServer}=require('../server/server'),router=require('../server/agent-router');
const server=createServer();server.listen(0,'127.0.0.1',()=>process.send?.({port:server.address().port,pid:process.pid}));
process.on('message',message=>{if(message.type==='hold'){const engine=router._sessions.get(message.token)?.engines.get(message.id);if(engine)engine.adapter.yieldControl=()=>new Promise(()=>{});process.send?.({held:true});}});
