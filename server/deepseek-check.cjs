'use strict';
const fs=require('fs'),path=require('path');
const HELP={400:'请求参数或模型名称不被支持，请核对模型与接口地址。',401:'密钥无效、已撤销或填写错误。',402:'账户余额不足，请检查DeepSeek开放平台的API余额。',403:'账户或区域权限受限，请检查平台权限。',404:'接口地址或模型名称不存在。',429:'请求过于频繁或额度受限，请稍后重试。',500:'DeepSeek服务内部错误，请稍后重试。',503:'DeepSeek服务繁忙，请稍后重试。'};
async function checkDeepSeek(config,fetchImpl=fetch){
 const report={checked_at:new Date().toISOString(),provider:'DeepSeek',model:config.model||'deepseek-flash',status:'not_run',steps:[],contains_health_data:false};
 if(!String(config.key||'').trim()||/^(your_|填入|请填|sk-xxx)/i.test(config.key)){report.reason='尚未填写真实DEEPSEEK_API_KEY；没有发送网络请求。';return report;}
 const base=String(config.base||'https://api.deepseek.com').replace(/\/+$/,'');
 let parsed;try{parsed=new URL(base);}catch{report.reason='API地址格式无效；没有发送网络请求。';return report;}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.search||parsed.hash){report.reason='API地址必须是无账号、无查询参数的HTTPS地址；没有发送网络请求。';return report;}
 report.status='running';const headers={Authorization:'Bearer '+String(config.key).trim(),'Content-Type':'application/json'};
 const request=async(endpoint,body)=>{
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),config.timeout||30000);
  try{const r=await fetchImpl(base+endpoint,{method:body?'POST':'GET',headers,signal:ctrl.signal,redirect:'error',...(body?{body:JSON.stringify(body)}:{})});if(!r.ok){const error=new Error(HELP[r.status]||'上游请求失败，请检查网络与服务状态。');error.code='HTTP_'+r.status;throw error;}let data;try{data=await r.json();}catch{const e=new Error('接口返回的不是有效JSON。');e.code='FORMAT';throw e;}return data;}finally{clearTimeout(timer);}
 };
 const step=async(name,fn)=>{const start=Date.now();try{const data=await fn();report.steps.push({name,success:true,elapsed_ms:Date.now()-start,...data});return data;}catch(e){report.steps.push({name,success:false,elapsed_ms:Date.now()-start,error_code:e.code||(e.name==='AbortError'?'TIMEOUT':'NETWORK'),message:e.name==='AbortError'?'请求超时，请检查网络或稍后重试。':e.code?e.message:'网络请求未完成；没有记录密钥或原始响应。'});throw e;}};
 try{
  await step('密钥鉴权与模型列表',async()=>{const data=await request('/models');if(!Array.isArray(data.data))throw Object.assign(new Error('模型列表格式无效。'),{code:'FORMAT'});const ids=data.data.map(m=>m.id).filter(x=>typeof x==='string');return {selected_model_listed:ids.includes(report.model),available_models:ids,note:ids.includes(report.model)?'所选模型在可用列表中':'所选名称可能是别名，接下来用实际请求验证'};});
  await step('普通JSON生成',async()=>{const data=await request('/chat/completions',{model:report.model,messages:[{role:'system',content:'Return JSON only.'},{role:'user',content:'Connectivity test only. Return {"ok":true}.'}],thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:64,stream:false});const content=data.choices?.[0]?.message?.content;let obj;try{obj=JSON.parse(content);}catch{throw Object.assign(new Error('模型没有返回要求的JSON，连接已响应但格式验收未通过。'),{code:'JSON_OUTPUT'});}if(obj.ok!==true)throw Object.assign(new Error('模型返回了非预期结果。'),{code:'JSON_OUTPUT'});return {usage:data.usage||null};});
  await step('Agent原生工具调用与回传',async()=>{
   const messages=[{role:'user',content:'Connection test: call health_connection_probe with token "ping", then respond with JSON {"ok":true}. Do not skip the tool.'}],tools=[{type:'function',function:{name:'health_connection_probe',description:'Local synthetic connectivity probe; no health data.',parameters:{type:'object',properties:{token:{type:'string',enum:['ping']}},required:['token'],additionalProperties:false}}}];
   const data=await request('/chat/completions',{model:report.model,messages,tools,tool_choice:{type:'function',function:{name:'health_connection_probe'}},thinking:{type:'disabled'},max_tokens:128,stream:false}),msg=data.choices?.[0]?.message,call=msg?.tool_calls?.[0];
   if(msg?.tool_calls?.length!==1||call?.function?.name!=='health_connection_probe')throw Object.assign(new Error('模型未按要求调用测试工具。'),{code:'TOOL_CALL'});
   let args;try{args=JSON.parse(call.function.arguments);}catch{throw Object.assign(new Error('工具参数不是有效JSON。'),{code:'TOOL_ARGS'});}
   if(args.token!=='ping'||Object.keys(args).length!==1)throw Object.assign(new Error('工具参数校验失败。'),{code:'TOOL_ARGS'});
   messages.push({role:'assistant',content:msg.content||null,tool_calls:msg.tool_calls},{role:'tool',tool_call_id:call.id,content:'{"success":true,"data":"pong"}'});
   const final=await request('/chat/completions',{model:report.model,messages,tools,tool_choice:'none',thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:64,stream:false});let output;try{output=JSON.parse(final.choices?.[0]?.message?.content);}catch{throw Object.assign(new Error('工具回传后没有得到有效JSON。'),{code:'TOOL_ROUNDTRIP'});}if(output.ok!==true)throw Object.assign(new Error('工具回传后的结果不符合要求。'),{code:'TOOL_ROUNDTRIP'});
   return {tool:'health_connection_probe',tool_executed:true,usage_first:data.usage||null,usage_final:final.usage||null};
  });report.status='passed';report.reason='鉴权、普通JSON生成、原生工具调用与回传均通过；不代表所有健康任务或七日计划已验收。';
 }catch{report.status=report.steps.some(s=>s.success)?'partial':'failed';report.reason='未全部通过，请按失败步骤排查；不会将本地回退当成API测试成功。';}
 return report;
}
async function main(){const env=path.join(__dirname,'.env');if(fs.existsSync(env)){if(typeof process.loadEnvFile!=='function'){console.error('请安装Node.js 20.19或更新版本。');process.exitCode=1;return;}process.loadEnvFile(env);}
 const report=await checkDeepSeek({key:process.env.DEEPSEEK_API_KEY,model:process.env.DEEPSEEK_MODEL,base:process.env.DEEPSEEK_BASE_URL});
 console.log('DeepSeek模型：'+report.model);for(const s of report.steps)console.log((s.success?'通过':'失败')+' | '+s.name+(s.message?' | '+s.message:''));console.log(report.reason);
 fs.writeFileSync(path.join(__dirname,'deepseek-connection-report.json'),JSON.stringify(report,null,2));console.log('报告：server/deepseek-connection-report.json（不包含密钥）');if(report.status!=='passed')process.exitCode=1;
}
if(require.main===module)main().catch(()=>{console.error('连接测试未完成，请检查本地配置和文件权限。');process.exitCode=1;});
module.exports={checkDeepSeek};
