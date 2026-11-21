/* Incremental adapter: all existing health/storage/UI functions remain in place. */
var AGENT_APP={engine:null,current:null,remote:null,tasks:[],snapshot:null,slot:null,host:'agentResult',lastPlan:null,backend:null,abort:null,history:[]};
var AGENT_MEM='hm_agent_memories_v1',AGENT_PLANS='hm_agent_plans_v1',AGENT_HISTORY='hm_agent_tasks_v1',AGENT_RECEIPTS='hm_agent_commit_receipts_v1',AGENT_PENDING='hm_agent_pending_confirm_v1';
function agentStorage(){return HealthAgentStorage.create(window.localStorage);}
function agentPersist(updates,guard){return agentStorage().transaction(updates,{guard:guard});}
function agentJson(key,fallback){try{var x=JSON.parse(lsGet(key)||'null');return x===null?fallback:x;}catch(e){return fallback;}}
function agentMemories(){var a=agentJson(AGENT_MEM,[]);return Array.isArray(a)?a.filter(function(m){return m&&typeof m.id==='string'&&typeof m.value==='string'&&m.confirmed===true;}).slice(-100):[];}
function agentPlans(){var a=agentJson(AGENT_PLANS,[]);return Array.isArray(a)?a.filter(function(p){return p&&p.plan_id&&p.days;}).slice(-20):[];}
function agentFingerprint(){return JSON.stringify({饮食记录:lsGet('hm_diary'),体重记录:lsGet('hm_weight'),目标与阶段:lsGet('hm_profile'),消耗校准:lsGet('hm_tdee_cal'),饮食偏好:lsGet(AGENT_MEM),日期:todayStr(),阶段:agentContext('planning').stage});}
function agentContext(kind){
 var profile=loadProfile(),stage=currentStage(),ctx={today:todayStr(),foods:FOODS,diary:[],weights:[],preferences:[],profile:null,stage:null,plan:null};
 if(['planning','simulation','weekly','metabolism','semantic'].includes(kind)){
  ctx.profile=profile?{age:profile.inp.age,special:profile.inp.special,bmr:profile.bmr,tdee:profile.tdee}:null;
  ctx.stage=stage?{kcal:stage.kcal,protein:stage.m.p,fat:stage.m.f,carb:stage.m.c,tdee:effectiveTDEE(profile).tdee,bmr:profile.bmr,safety_status:stage.safety?stage.safety.status:'restricted',restricted:!!profile.restricted}:null;
 }
 if(['weekly','metabolism','behavior'].includes(kind)){
  for(var i=27;i>=0;i--){var date=isoDaysAgo(i);actualEntries(date).forEach(function(e){ctx.diary.push({date:date,meal:e.meal,name:e.name,kcal:entryKcalKnown(e)?e.kcal:null,p:e.p,f:e.f,c:e.c,aiPlan:false,planId:e.planId||'',unknownKcal:e.unknownKcal||0});});}
  var weights=loadWeights();ctx.weights=Object.keys(weights).sort().filter(function(d){return d>=isoDaysAgo(27)&&d<=todayStr();}).map(function(d){return {date:d,value:weights[d]};});
 }
 if(['planning','simulation','weekly','behavior','memory'].includes(kind))ctx.preferences=agentMemories();
 if(['weekly','behavior'].includes(kind))ctx.plan=agentPlans().filter(function(p){return p.confirmed_at;}).slice(-1)[0]||null;
 return ctx;
}
function agentNormalizeError(e){return e&&e.message?e.message:String(e);}
function agentStoreTask(t){
 var task=JSON.parse(JSON.stringify(t));delete task.started_ms;
 var index=AGENT_APP.tasks.findIndex(function(x){return x.id===task.id;});if(index<0)AGENT_APP.tasks.unshift(task);else AGENT_APP.tasks[index]=task;
 AGENT_APP.tasks=AGENT_APP.tasks.slice(0,30);
 lsSet(AGENT_HISTORY,JSON.stringify(AGENT_APP.tasks.map(function(x){return {id:x.id,kind:x.kind,status:x.status,created_at:x.created_at,updated_at:x.updated_at,input_summary:x.input_summary,mode:x.mode,error:x.error||null,steps:x.steps,calls:x.calls,model_usage:x.model_usage||null,validation:x.result?.validation||null};})));
}
var AGENT_STATUS={pending:'等待执行',running:'正在执行',needs_input:'需要补充信息',needs_confirmation:'等待你的确认',completed:'已完成',failed:'失败',cancelled:'已取消'};
function agentKindLabel(kind){return ({nutrition:'记一餐',semantic:'找食物',planning:'一周饮食',simulation:'吃法对比',metabolism:'每日消耗',weekly:'本周总结',behavior:'坚持情况',memory:'保存喜好',preference:'饮食喜好',constraint:'忌口与限制',rejected:'不喜欢的原因',replacement:'换餐原因'})[kind]||'饮食帮助';}
function agentStepLabel(tool){var labels={parse_meal_description:'理解餐食描述',search_foods:'查找食物',calculate_meal_nutrition:'计算这一餐的营养',validate_agent_result:'核对结果',read_user_profile:'查看身体资料',read_diary:'查看饮食记录',read_weight_history:'查看体重记录',get_preferences:'查看饮食喜好',calculate_tdee:'估算每日消耗',calculate_plan_nutrition:'计算餐单营养',generate_weekly_report:'整理本周变化'};return labels[tool]||'整理与核对资料';}
function agentProgress(t){
 AGENT_APP.current=t;agentStoreTask(t);
 var box=$('#agentTaskStatus');if(box){var steps=t.steps||[];box.innerHTML='<div class="agent-job-head"><b>'+escHtml(({submitting:'提交中',succeeded:'提交成功',failed:'提交失败',awaiting_result:'等待结果确认'}[t.submission_state])||AGENT_STATUS[t.status]||t.status)+'</b><small>已完成 '+steps.filter(function(s){return s.status==='completed';}).length+' 项处理</small></div><ol class="agent-step-list">'+steps.slice(-5).map(function(s){return '<li><span class="step-state '+escHtml(s.status)+'"></span><span>'+escHtml(agentStepLabel(s.tool))+'</span><small>'+escHtml(s.status==='completed'?'已完成':s.status==='failed'?'未完成':'处理中')+'</small></li>';}).join('')+'</ol>'+(t.fallback?'<p class="agent-warning">'+(t.fallback.code==='LOCAL_SELECTED'?'本次使用本地处理。':'在线 AI 暂未完成，已改用本地处理。')+'</p>':'')+'<details class="agent-technical"><summary>查看详细过程</summary><p>'+escHtml(t.id)+' · '+escHtml(t.mode)+'</p><ol>'+steps.map(function(s){return '<li>'+escHtml(s.agent+' / '+s.tool+' / '+s.status)+'<br>'+escHtml(s.error_code||s.summary||s.input_summary||'')+'</li>';}).join('')+'</ol>'+(t.fallback?'<p>'+escHtml(t.fallback.message)+' ('+escHtml(t.fallback.code)+')</p>':'')+'</details>';}
 var cancel=$('#agentCancel');if(cancel)cancel.disabled=!['pending','running','needs_input','needs_confirmation'].includes(t.status);
 var compact=$('#quickAgentStatus');if(compact&&AGENT_APP.host==='quickAgentOutput')compact.textContent=(AGENT_STATUS[t.status]||t.status)+' · '+t.calls+' 步处理';
 agentRenderHistory();
}
function agentFormatTotals(n){return n?'约 '+fmt(n.kcal)+' 千卡 · 蛋白质 '+fmt1(n.protein)+'g · 脂肪 '+fmt1(n.fat)+'g · 碳水 '+fmt1(n.carb)+'g':'暂无营养汇总';}
function agentPlanHtml(plan){
 var names=function(items){return items.map(function(it){var f=FOODS.find(function(f){return f.id===it.food_id;});return (f?f.n:it.food_id)+' '+fmt1(it.grams)+'g';}).join('、');};
 return '<div class="agent-plan"><p class="agent-evidence">'+escHtml(plan.validation.valid?'营养、预算与忌口已核对':'还需要调整')+' · 待确认餐单</p><p>'+escHtml(plan.explanation)+'</p>'+plan.days.map(function(day,i){return '<details class="agent-plan-day"'+(i===0?' open':'')+'><summary>'+escHtml(day.date)+' <span>'+fmt(day.nutrition_totals.kcal)+' 千卡</span></summary>'+day.meals.map(function(m){return '<div class="agent-plan-meal"><b>'+escHtml({breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'加餐'}[m.slot])+'</b><span>'+escHtml(names(m.items))+'</span><small>'+escHtml(agentFormatTotals(m.nutrition_totals))+' · '+(m.cost===null?'价格未知':m.cost+' 元（用户报价）')+' · '+(m.prep_minutes===null?'时间未知':m.prep_minutes+' 分钟（用户估计）')+'</small><button type="button" class="btn btn-ghost btn-sm" data-agent-replace="'+i+'" data-agent-slot="'+m.slot+'">替换这一餐</button></div>';}).join('')+'</details>';}).join('')+'<details class="formula-drawer"><summary>假设、误差与核对依据</summary><ul>'+plan.assumptions.concat(plan.uncertainties,plan.validation.warnings||[]).map(function(x){return '<li>'+escHtml(x)+'</li>';}).join('')+'</ul><p>工具核对：'+escHtml(plan.validation.checks.join('、'))+'</p></details></div>';
}
function agentMetaHtml(result){var data=result.estimate,est=data.estimate;return '<div class="agent-evidence-card"><h3>代谢趋势与数据质量</h3><p>'+escHtml(est.ok?'候选 TDEE 约 '+fmt(est.tdee)+' 千卡/天（尚未应用）':est.reason||'数据不足')+'</p>'+(data.interval?'<p>敏感性范围：'+fmt(data.interval.low)+'—'+fmt(data.interval.high)+' 千卡/天</p><small>'+escHtml(data.interval.label)+'</small>':'')+'<ul>'+result.evidence.map(function(e){return '<li><b>'+escHtml(e.id)+'</b>：'+escHtml(Array.isArray(e.value)?e.value.join('、'):String(e.value))+' · '+escHtml(e.source)+'</li>';}).join('')+'</ul><ul>'+result.uncertainties.map(function(x){return '<li>'+escHtml(x)+'</li>';}).join('')+'</ul></div>';}
function agentBehaviorHtml(result){return '<div class="agent-evidence-card"><h3>执行反馈</h3><p>有记录餐次 '+(result.comparison.matched||0)+' · 未知执行餐次 '+(result.comparison.unrecorded||0)+'</p><ul>'+result.recommendations.concat(result.comparison.notes||[]).map(function(x){return '<li>'+escHtml(x)+'</li>';}).join('')+'</ul><p>仅使用 '+result.memory.length+' 条用户已确认记忆；未推断敏感属性。</p></div>';}
function agentRenderResult(t){
 var host=$('#'+AGENT_APP.host)||$('#agentResult'),result=t.result,h='';
 if(t.error)h+='<div class="agent-warning">'+escHtml(t.error.code+'：'+t.error.message)+'</div>';
 if(t.kind==='nutrition'&&result){
  h+='<p>请核对食物、烹饪状态与克重。碗/个/份只是暂估，炒菜油和酱料需要单独补录。</p><div class="agent-food-edit">'+result.items.map(function(item,i){return '<div class="agent-food-row"><label>数据库条目<select data-agent-food="'+i+'"><option value="">请选择匹配食物</option>'+FOODS.map(function(f){return '<option value="'+escHtml(f.id)+'"'+(item.food_id===f.id?' selected':'')+'>'+escHtml(f.n)+' · '+escHtml(f.state)+'</option>';}).join('')+'</select></label><label>可食克重<input data-agent-grams="'+i+'" type="number" min="1" max="1000" value="'+(item.grams||'')+'"></label><small>'+escHtml(item.source)+' · '+escHtml(item.assumption)+' · '+escHtml(item.confidence)+'</small></div>';}).join('')+'</div><p>'+escHtml(agentFormatTotals(result.nutrition_totals.totals))+'</p>'+(result.questions.length?'<ul>'+result.questions.map(function(q){return '<li>'+escHtml(q)+'</li>';}).join('')+'</ul>':'')+'<button type="button" class="btn btn-ghost" data-agent-edit>重新计算</button>';
 }else if(t.kind==='metabolism'&&result)h+=agentMetaHtml(result);
 else if(t.kind==='behavior'&&result)h+=agentBehaviorHtml(result);
 else if(t.kind==='semantic'&&result){h+='<p>'+escHtml(result.note)+'</p>'+(result.combinations.length?'<div class="agent-evidence-card"><h3>按你确认可获得的食物组合</h3>'+result.combinations.map(function(m){return '<p>'+escHtml(m.items.map(function(i){return FOODS.find(function(f){return f.id===i.food_id;}).n+' '+i.grams+'g';}).join('、'))+'<br><small>'+escHtml(agentFormatTotals(m.nutrition_totals))+'</small></p>';}).join('')+'</div>':'')+'<div class="agent-semantic-grid">'+result.candidates.map(function(f){return '<article><b>'+escHtml(f.n)+'</b><small>每100g约 '+f.k+' 千卡 · 蛋白质 '+f.p+'g</small><small>'+escHtml(f.src)+'</small></article>';}).join('')+'</div>';}
 else if(t.kind==='memory'&&result)h+='<p>待确认记忆：'+escHtml(result.value)+'</p><small>来源：'+escHtml(result.source)+' · '+escHtml(result.at)+'</small>';
 else if(t.kind==='weekly'&&result){h+=agentMetaHtml(result.metabolism)+agentBehaviorHtml(result.behavior);if(result.planning){AGENT_APP.lastPlan=result.planning;h+=agentPlanHtml(result.planning);}else h+='<p>'+escHtml(result.note)+'</p>';}
 else if(t.kind==='simulation'&&result){AGENT_APP.lastPlan=t.confirmed_action?.plan||result.alternative;h+='<p class="agent-warning">假设模拟，不会自动改变实际记录或 TDEE。</p><p>修改餐次：'+result.differences.changed_meals+' / 21。'+escHtml(result.differences.note)+'</p><div class="agent-compare"><details><summary>方案 A · 当前约束</summary><button type="button" class="btn btn-ghost" data-agent-choice="baseline">选择方案 A</button>'+agentPlanHtml(result.baseline)+'</details><details open><summary>方案 B · 假设调整</summary><button type="button" class="btn btn-ghost" data-agent-choice="alternative">选择方案 B</button>'+agentPlanHtml(result.alternative)+'</details></div>';}
 else if(result?.plan_id){AGENT_APP.lastPlan=result;h+=agentPlanHtml(result);}
 if(t.differences)h+='<details class="formula-drawer"><summary>与旧方案比较：'+t.differences.changed_meals+' 餐发生变化</summary><ul>'+t.differences.details.map(function(d){return '<li>'+escHtml(d.date+' '+d.slot)+'：'+escHtml(d.before.map(function(i){return i.food_id+' '+i.grams+'g';}).join('、'))+' → '+escHtml(d.after.map(function(i){return i.food_id+' '+i.grams+'g';}).join('、'))+'</li>';}).join('')+'</ul></details>';
 if(t.result?.plan_id||t.result?.planning)h+='<button type="button" class="btn btn-ghost" data-agent-replan>按当前约束重新规划，并比较差异</button>';
 if(t.status==='needs_confirmation')h+='<div class="btn-row agent-confirm"><button type="button" class="btn btn-primary" data-agent-confirm>'+ (t.kind==='nutrition'?'确认后记入实际饮食':t.kind==='memory'?'确认保存这条记忆':t.kind==='simulation'?'确认保存方案 B 为计划草稿':'确认保存计划草稿')+'</button><button type="button" class="btn btn-ghost" data-agent-reject>拒绝本次结果</button></div>';
 if(t.status==='completed'&&t.confirmed_action?.plan)h+='<p class="agent-evidence">已确认并保存计划草稿，尚未写入实际饮食。</p><button type="button" class="btn btn-ghost" data-agent-calendar>将这份计划加入日历草稿</button>';
 if(t.status==='completed'&&t.kind==='nutrition'&&t.local_committed)h+='<p class="agent-evidence">已按确认的份量记入实际饮食。</p>';
 if(t.mode==='local_tools'||t.mode==='local_fallback')h+='<p class="agent-mode-note">当前结果来自本地规则解析、受控工具与约束求解，未冒充模型生成。'+(t.fallback?'模型失败已回退。':'')+'</p>';
 if(t.model_contribution)h+='<p class="agent-mode-note">模型贡献：'+escHtml({validated_food_items:'食物和份量提案，经工具复核',validated_plan:'七日计划提案，经工具复核',tool_assisted_context_only:'调用工具获取上下文；最终方案仍由确定性工具求解'}[t.model_contribution]||t.model_contribution)+'</p>';
 if(t.model_usage)h+='<p class="agent-mode-note">实际模型调用 '+t.model_usage.calls+' 次 · 输入 '+t.model_usage.prompt_tokens+' tokens · 输出 '+t.model_usage.completion_tokens+' tokens。费用未配置单价，未估造金额。</p>';
 host.innerHTML=h||'<p>暂无结果。请查看任务状态或补充约束。</p>';normalizeIcons(host);
}
async function agentRemoteRequest(url,body,method){
 var controller=new AbortController(),timer=/\/(?:confirm|commit|commit-status)(?:\?|$)/.test(url)?setTimeout(function(){controller.abort();},10000):null;try{var response=await fetch(url,{method:method||'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+AGENT_APP.backend.token},cache:'no-store',signal:controller.signal,...(body?{body:JSON.stringify(body)}:{})});var data;try{data=await response.json();}catch(e){e.uncertain=true;throw e;}if(!response.ok||!data.success){var error=new Error(data.message||data.error_code||'Agent 请求失败');error.code=data.error_code;throw error;}return data;}catch(e){if(!e.code)e.uncertain=true;throw e;}finally{clearTimeout(timer);}
}
function agentIntent(text){if(/(吃了|喝了|一碗|一个).*(饭|肉|蛋|菜|奶)/.test(text))return 'nutrition';if(/如果|假设|模拟/.test(text))return 'simulation';if(/复盘|下周调整|执行/.test(text))return 'weekly';if(/计划|菜单|餐单/.test(text))return 'planning';if(/代谢|TDEE|体重|停滞/i.test(text))return 'metabolism';if(/不喜欢|记住|偏好/.test(text))return 'memory';if(/食物|高蛋白|晚餐/.test(text))return 'semantic';return null;}
function agentReadConstraints(){
 var available=[],prices={},times={};document.querySelectorAll('#agentFoodsTable [data-food-config]').forEach(function(row){if(!row.querySelector('input[type="checkbox"]').checked)return;var id=row.dataset.foodConfig;available.push(id);var price=row.querySelector('[data-food-price]').value,time=row.querySelector('[data-food-time]').value;if(price!=='')prices[id]=Number(price);if(time!=='')times[id]=Number(time);});
 var avoid=$('#agentAvoid').value.trim(),text=$('#agentPrompt').value,match=text.match(/(?:预算|每餐|单餐).{0,5}?(\d+(?:\.\d+)?)\s*元/),no=text.match(/(?:不要|不喜欢|不吃)([^，。；\n]{1,15})/);
 return {available_ids:available,prices,prep_times:times,budget:$('#agentBudget').value!==''?Number($('#agentBudget').value):match?Number(match[1]):null,max_prep:$('#agentPrep').value!==''?Number($('#agentPrep').value):null,avoid:[avoid,no?no[1]:''].filter(Boolean).join('、'),preference:$('#agentPreference').value};
}
async function agentRun(kind,input,options){
 options=options||{};if(AGENT_APP.current&&['pending','running'].includes(AGENT_APP.current.status)){appNotice('请先取消正在执行的任务');return;}
 AGENT_APP.host=options.host||'agentResult';AGENT_APP.slot=options.slot||{date:recordDate||todayStr(),meal:'lunch'};AGENT_APP.snapshot=agentFingerprint();
 var context=agentContext(kind),useModel=!!$('#agentUseModel').checked;input=input||{};if(!input.base_plan)AGENT_APP.pendingFeedback=null;input.use_model=useModel;
 $('#'+AGENT_APP.host).innerHTML='<p>正在准备任务与授权范围…</p>';
 AGENT_APP.remote=null;AGENT_APP.simulationChoice=null;
 try{
  if(useModel&&location.protocol!=='file:'){
   var consent=await ensureAiConsent('agent_upgrade');
   if(consent&&confirm('本次发送范围：'+(context.diary.length?'近28天实际饮食 '+context.diary.length+' 条、体重 '+context.weights.length+' 条；':'')+'本任务文字、必要阶段目标、用户已确认的偏好与计划约束。模型仅可通过注册工具查询这些数据。食物目录来自服务端内置数据库。是否授权本次后端与模型处理？')){
    if(!AGENT_APP.backend){var response=await fetch('/api/agents/session',{cache:'no-store'});var session=await response.json();if(!response.ok||!session.success)throw new Error('后端未提供Agent接口');AGENT_APP.backend=session;}
    var sendContext=JSON.parse(JSON.stringify(context));delete sendContext.foods;
    var result=await agentRemoteRequest('/api/agents/tasks',{kind,input,context:sendContext,authorized:true,model_consent:true});var task=result.task;AGENT_APP.remote=task.id;agentProgress(task);
    while(['pending','running'].includes(task.status)){await new Promise(r=>setTimeout(r,300));task=(await agentRemoteRequest('/api/agents/tasks/'+encodeURIComponent(task.id),null,'GET')).task;agentProgress(task);}
    agentRenderResult(task);return task;
   }
  }
  var engine=new HealthAgents.Orchestrator(context,{calculateTdee:function(){var p=loadProfile();return p?computeTdeeEstimate(p):{ok:false,reason:'缺少身体基准'};},onUpdate:agentProgress});AGENT_APP.engine=engine;
  var task=await engine.run(kind,{...input,use_model:false});if(useModel)task.fallback={code:'LOCAL_SELECTED',message:'未连接或未授权模型，本次没有发送到云端'};agentProgress(task);agentRenderResult(task);return task;
 }catch(e){$('#'+AGENT_APP.host).innerHTML='<p class="agent-warning">'+escHtml(agentNormalizeError(e))+'。原有记录与非AI功能仍可使用。</p>';return null;}
}
function agentCompatibilityPlan(plan){return {id:plan.plan_id,createdAt:new Date().toISOString(),data:{summary:'Agent工具验证后的用户确认计划；所有餐食仍为计划草稿。',facts:[],suggestions:[],limitations:plan.uncertainties,days:plan.days.map(function(d){return {date:d.date,meals:d.meals.map(function(m){return {slot:{breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'加餐'}[m.slot],items:m.items.map(function(it){var f=FOODS.find(function(f){return f.id===it.food_id;});return {name:f.n,amount:String(it.grams),unit:'g',kcal:Math.round(f.k*it.grams/100)};})};})};})}};}
function agentCommitNutrition(t,stageOnly){
 HealthAgents.schemaCheck(t.result,HealthAgents.resultSchemas.nutrition);var items=t.result.items;if(items.some(function(i){return i.unresolved;}))throw new Error('仍有待澄清食物');var date=AGENT_APP.slot.date;if(!HealthAgents.validDate(date))throw new Error('日期无效');
 var diary=loadDiary();if(Object.values(diary).some(function(rows){return rows.some(function(e){return e.agentTaskId===t.id;});}))throw new Error('该任务已写入，不能重复记餐');
 var rows=items.map(function(it){var f=FOODS.find(function(f){return f.id===it.food_id;});if(!f)throw new Error('食物编号无效');var n=HealthAgents.nutrition(agentContext('nutrition'),[{food_id:it.food_id,grams:it.grams}]).totals;return {meal:AGENT_APP.slot.meal,name:f.n,foodId:f.id,grams:it.grams,qty:it.grams,unit:'g',kcal:n.kcal,p:n.protein,f:n.fat,c:n.carb,cat:f.cat,aiPlan:false,agentTaskId:t.id,loggedAt:new Date().toISOString(),nutritionSource:f.src,estimated:true,portionAssumption:it.assumption};});
 diary[date]=(diary[date]||[]).concat(rows);var error=diaryValidationError(diary);if(error)throw new Error(error);if(stageOnly)return diary;saveDiary(diary);if(JSON.stringify(loadDiary())!==JSON.stringify(diary))throw new Error('本机存储失败，未确认写入');t.local_committed=true;
}
function agentAssertCurrent(t){
 if(AGENT_APP.current?.id!==t.id||AGENT_APP.current?.status==='cancelled')throw new Error('任务已取消或已更换，未写入');
 var current=agentFingerprint();if(current!==AGENT_APP.snapshot){var a=JSON.parse(AGENT_APP.snapshot||'{}'),b=JSON.parse(current),changed=Object.keys(b).filter(function(k){return JSON.stringify(a[k])!==JSON.stringify(b[k]);});throw new Error('草稿依据已变化：'+changed.join('、')+'。请重新生成并审核。');}
 if(Date.parse(t.expires_at)<=Date.now())throw new Error('草稿已过期，请重新生成');
}
function agentSubmissionState(t,state){t.submission_state=state;agentProgress(t);var label={submitting:'提交中',succeeded:'提交成功',failed:'提交失败',awaiting_result:'等待结果确认'}[state];appNotice(label);}
function agentRememberSubmission(t,entry){
 AGENT_APP.pendingCommits=AGENT_APP.pendingCommits||{};AGENT_APP.pendingCommits[t.id]=entry;
 if(AGENT_APP.remote){var all=agentJson(AGENT_PENDING,{});all[t.id]={...entry,task:JSON.parse(JSON.stringify(t)),remote:true};var updates={};updates[AGENT_PENDING]=JSON.stringify(all);agentPersist(updates);if(AGENT_APP.backend?.token)sessionStorage.setItem('hm_agent_resume_'+t.id,AGENT_APP.backend.token);}
}
function agentForgetSubmission(t){if(!AGENT_APP.remote){delete AGENT_APP.pendingCommits?.[t.id];return;}try{var all=agentJson(AGENT_PENDING,{});delete all[t.id];var updates={};updates[AGENT_PENDING]=JSON.stringify(all);agentPersist(updates);sessionStorage.removeItem('hm_agent_resume_'+t.id);}catch{/* Durable receipt remains; repeat status query is safe. */}}
async function agentQuerySubmission(t,key){
 var status;try{status=AGENT_APP.remote?await agentRemoteRequest('/api/agents/tasks/'+encodeURIComponent(t.id)+'/commit-status?confirmation_id='+encodeURIComponent(key),null,'GET'):AGENT_APP.engine.commitStatus(t.id,key);}catch(e){e.uncertain=true;throw e;}
 if(!['committed','not_committed'].includes(status.state)){var e=new Error('提交状态尚未确定，请稍后查询；不会创建新提交');e.uncertain=true;throw e;}
 if(status.task?.id!==t.id||(status.task.confirmation?.id&&status.task.confirmation.id!==key))throw new Error('提交结果凭据不匹配');
 return status;
}
async function agentRestoreSubmissions(){
 var all=agentJson(AGENT_PENDING,{}),entry=Object.values(all).find(function(x){return x?.remote&&x.task?.id;});if(!entry)return;
 var t=entry.task;t.status='needs_confirmation';t.submission_state='awaiting_result';AGENT_APP.current=t;AGENT_APP.remote=t.id;AGENT_APP.host='agentResult';AGENT_APP.pendingCommits=AGENT_APP.pendingCommits||{};AGENT_APP.pendingCommits[t.id]=entry;agentProgress(t);agentRenderResult(t);
 var token=sessionStorage.getItem('hm_agent_resume_'+t.id);if(!token){appNotice('等待结果确认：原会话不可用，不会重复提交');return;}AGENT_APP.backend={token};
 if(agentJson(AGENT_RECEIPTS,{})[t.id])await agentConfirm();else{try{var status=await agentQuerySubmission(t,entry.key);appNotice(status.state==='not_committed'?'原提交尚未完成，请重新核对草稿后操作':'本机缺少匹配回执，请核查已保存数据；不会重复提交');}catch(e){appNotice('等待结果确认：'+agentNormalizeError(e));}}
}
async function agentConfirm(){
 var t=AGENT_APP.current;if(!t||t.status!=='needs_confirmation'||AGENT_APP.confirming)return;
 AGENT_APP.confirming=true;document.querySelectorAll('[data-agent-confirm]').forEach(function(b){b.disabled=true;});
 var result,receipt,committed=false;
 var pending=AGENT_APP.pendingCommits?.[t.id]||agentJson(AGENT_PENDING,{})[t.id]||{key:agentJson(AGENT_RECEIPTS,{})[t.id]?.confirmation_id||t.confirmation?.id||HealthAgents.ID('submission'),attempted:false};
 agentSubmissionState(t,'submitting');
 async function execute(){
  agentStorage().recover();var receipts=agentJson(AGENT_RECEIPTS,{}),prior=receipts[t.id];
  var status=null;
  if(prior||pending.attempted){status=await agentQuerySubmission(t,pending.key);result=status.task;if(status.state==='committed'&&!prior)throw new Error('服务端已确认但本机回执缺失，请核查数据；不会重新写入');}
  if(!prior)agentAssertCurrent(t);
  if(!status||status.state==='not_committed'&&!status.prepared){
   pending.attempted=true;agentRememberSubmission(t,pending);
   result=AGENT_APP.remote?(await agentRemoteRequest('/api/agents/tasks/'+encodeURIComponent(t.id)+'/confirm',{confirmed:true,plan_id:AGENT_APP.simulationChoice||undefined,defer_commit:true,context_revision:t.context_revision,idempotency_key:pending.key})).task:await AGENT_APP.engine.confirm(t.id,true,AGENT_APP.simulationChoice||undefined,{deferCommit:true,contextRevision:t.context_revision,idempotencyKey:pending.key});
  }
  receipt={confirmation_id:pending.key,persisted:true};
  if(result.confirmation?.id!==pending.key||prior&&prior.confirmation_id!==pending.key)throw new Error('本机回执与待确认方案不一致，请保留数据后重新审核');
  agentRememberSubmission(result,pending);
  if(!prior){
   agentAssertCurrent(t);var updates={};
   if(result.kind==='nutrition'){
    updates.hm_diary=JSON.stringify(agentCommitNutrition(result,true));
   }else if(result.kind==='memory'){var all=agentMemories();all.push({...result.result,confirmed:true,confirmed_at:new Date().toISOString()});updates[AGENT_MEM]=JSON.stringify(all);}
   else if(result.confirmed_action?.plan){
    var plan=result.confirmed_action.plan,validation=HealthAgents.validatePlan(agentContext('planning'),plan);if(!validation.valid)throw new Error(validation.issues.join('；'));
    plan.confirmed_at=new Date().toISOString();var plans=agentPlans();if(!plans.some(function(p){return p.plan_id===plan.plan_id;}))plans.push(plan);
    updates[AGENT_PLANS]=JSON.stringify(plans);updates[WEEK_PLAN_KEY]=JSON.stringify(agentCompatibilityPlan(plan));var accepted=agentMemories();accepted.push({id:HealthAgents.ID('memory'),kind:'accepted',value:'确认保存计划 '+plan.plan_id,source:'用户点击确认保存计划',at:plan.confirmed_at,confirmed:true});if(AGENT_APP.pendingFeedback&&confirm('是否把本次单餐替换原因保存到可更正、可删除的偏好记忆？'))accepted.push({id:HealthAgents.ID('memory'),kind:'replacement',value:AGENT_APP.pendingFeedback,source:'用户确认替换计划 '+plan.plan_id,at:plan.confirmed_at,confirmed:true});updates[AGENT_MEM]=JSON.stringify(accepted);
   }else throw new Error('没有可保存的确认结果');
   receipts[t.id]={confirmation_id:receipt.confirmation_id,at:new Date().toISOString(),context_revision:t.context_revision};updates[AGENT_RECEIPTS]=JSON.stringify(receipts);
   agentPersist(updates,function(){agentAssertCurrent(t);});
  }
  committed=true;AGENT_APP.pendingFeedback=null;
  if(status?.state!=='committed')result=AGENT_APP.remote?(await agentRemoteRequest('/api/agents/tasks/'+encodeURIComponent(t.id)+'/commit',receipt)).task:await AGENT_APP.engine.acknowledgeCommit(t.id,receipt);
  if(result.status!=='completed'||result.persistence_status!=='persisted')throw new Error('保存状态尚未确认，请重试');
  if(result.kind==='nutrition')result.local_committed=true;
  result.submission_state='succeeded';agentForgetSubmission(t);agentProgress(result);agentRenderResult(result);if(result.confirmed_action?.plan){AGENT_APP.lastPlan=result.confirmed_action.plan;renderWeekPlan();}agentRenderMemory();renderCalendar();renderFitnessDashboard();
  if(result.kind==='nutrition'&&AGENT_APP.host==='quickAgentOutput'){$('#mealDialog').close();$('#quickText').value='';}appNotice(result.kind==='nutrition'?'已记录确认的实际餐食':'已保存用户确认的结果');
 }
 try{if(navigator.locks)await navigator.locks.request('health-agent-persist',execute);else await execute();}
 catch(e){if(!committed&&result?.confirmation){try{var failed={confirmation_id:result.confirmation.id,persisted:false};var failedTask=AGENT_APP.remote?(await agentRemoteRequest('/api/agents/tasks/'+encodeURIComponent(t.id)+'/commit',failed)).task:await AGENT_APP.engine.acknowledgeCommit(t.id,failed);agentProgress(failedTask);}catch{/* Original draft remains retryable; never report success. */}}agentSubmissionState(AGENT_APP.current||t,committed||e.uncertain?'awaiting_result':'failed');alert((committed?'本机已保存，但确认状态未同步；请重试，不会重复写入。':'保存未完成，草稿已保留。')+agentNormalizeError(e));}
 finally{AGENT_APP.confirming=false;document.querySelectorAll('[data-agent-confirm]').forEach(function(b){b.disabled=false;});}
}

function agentCalendarPlan(){
 var task=AGENT_APP.current,plan=task?.confirmed_action?.plan;if(!plan)return;var receipt=agentJson(AGENT_RECEIPTS,{})[task.id];if(task.status!=='completed'||!receipt||receipt.confirmation_id!==task.confirmation?.id||!agentPlans().some(function(p){return p.plan_id===plan.plan_id&&p.confirmed_at;})){appNotice('请先成功保存并确认这份计划，再加入日历');return;}if(!confirm('将已确认的七日计划加入日历草稿？这些草稿不计入实际摄入和TDEE；实际执行后需逐条确认。'))return;
 var diary=loadDiary();if(Object.values(diary).some(function(rows){return rows.some(function(e){return e.planId===plan.plan_id;});})){alert('此计划已有日历草稿，未重复添加');return;}
 for(var day of plan.days){diary[day.date]=diary[day.date]||[];for(var meal of day.meals)for(var it of meal.items){var f=FOODS.find(function(f){return f.id===it.food_id;}),n=HealthAgents.nutrition(agentContext('nutrition'),[it]).totals;diary[day.date].push({meal:meal.slot,name:f.n,foodId:f.id,grams:it.grams,qty:it.grams,unit:'g',kcal:n.kcal,p:n.protein,f:n.fat,c:n.carb,cat:f.cat,aiPlan:true,planId:plan.plan_id,estimated:true,nutritionSource:f.src});}}
 if(!saveDiary(diary)){appNotice('保存失败，计划未加入日历，请重试');return;}renderCalendar();appNotice('计划已作为草稿加入日历，未计入实际摄入');
}
function agentRenderHistory(){var host=$('#agentHistory');if(!host)return;var history=agentJson(AGENT_HISTORY,[]);if(!Array.isArray(history))history=[];host.innerHTML='<p class="agent-mode-note">保留最近的处理记录。未确认的结果不会自动保存。</p>'+history.slice(0,15).map(function(t){return '<details><summary>'+escHtml(agentKindLabel(t.kind))+' · '+escHtml(({submitting:'提交中',succeeded:'提交成功',failed:'提交失败',awaiting_result:'等待结果确认'}[t.submission_state])||AGENT_STATUS[t.status]||t.status)+' · '+escHtml(t.created_at.slice(0,16))+'</summary><p>'+escHtml(t.input_summary||'')+'</p><small>'+escHtml(t.id)+' · '+(t.calls||0)+' 步处理 · '+escHtml(t.mode||'')+'</small><ul>'+(t.steps||[]).map(function(step){return '<li>'+escHtml(step.agent+' / '+step.tool+' / '+step.status)+'</li>';}).join('')+'</ul></details>';}).join('')||'<p>尚无任务记录。</p>';}
function agentRenderMemory(){var host=$('#agentMemoryList');if(!host)return;host.innerHTML=agentMemories().map(function(m){return '<article class="agent-memory"><label>'+escHtml(agentKindLabel(m.kind))+'<input type="text" data-memory-edit="'+escHtml(m.id)+'" value="'+escHtml(m.value)+'" maxlength="300"></label><small>'+escHtml(m.source)+' · '+escHtml(m.at)+'</small><button class="btn btn-ghost btn-sm" type="button" data-memory-save="'+escHtml(m.id)+'">确认更正</button><button class="btn btn-ghost btn-sm" type="button" data-memory-delete="'+escHtml(m.id)+'">删除</button></article>';}).join('')||'<p>还没有保存喜好，可添加忌口或饮食偏好。</p>';}
function agentOpen(kind,text){switchTab('agents');$('#agentWorkflow').value=kind;$('#agentPrompt').value=text||'';$('#agentPrompt').focus();}
function initAgentUpgrade(){
 var restored=agentJson(AGENT_HISTORY,[]);AGENT_APP.tasks=Array.isArray(restored)?restored.filter(function(t){return t&&typeof t.id==='string';}).slice(0,30).map(function(t){
  if(['pending','running','needs_confirmation'].includes(t.status)){
    if(agentJson(AGENT_PENDING,{})[t.id]?.remote){t.status='needs_confirmation';t.submission_state='awaiting_result';return t;}if(agentJson(AGENT_RECEIPTS,{})[t.id]){t.status='completed';t.persistence_status='local_persisted';t.error={code:'ACK_INTERRUPTED',message:'本机保存已验证；页面刷新后后端确认状态未恢复。请查看已保存计划，不要重复生成。'};return t;}t.status='cancelled';t.error={code:'PAGE_INTERRUPTED',message:'页面已刷新，旧任务未恢复；请重新处理并确认。未自动写入记录或计划。'};
    t.updated_at=new Date().toISOString();
  }return t;
 }):[];
 lsSet(AGENT_HISTORY,JSON.stringify(AGENT_APP.tasks));
 aiScopeText=(function(original){return function(task){if(task==='agent_upgrade')return 'Agent任务按本次选择发送：任务文字、必要阶段目标、最近28天饮食/体重记录（仅复盘与代谢任务）、已确认偏好和计划约束。还需逐次授权；拒绝后使用本地工具。';return original(task);};})(aiScopeText);
 featureRoutes.agents=['center'];var center=document.createElement('section');center.id='tab-agents';center.classList.add('no-pointer-motion');center.hidden=true;center.innerHTML='<h1>AI 健康助手</h1><p class="sub">记饮食、做计划，确认后再保存。</p><div class="agent-layout"><div class="card"><h2>告诉我你的需求</h2><form id="agentTaskForm"><div class="input-grid"><label>想做什么<select id="agentWorkflow"><option value="auto">帮我自动选择</option><option value="nutrition">帮我记一餐</option><option value="semantic">找食物</option><option value="planning">安排一周饮食</option><option value="simulation">比较两种吃法</option><option value="metabolism">看看每日消耗</option><option value="weekly">总结这一周</option><option value="behavior">看看哪里难坚持</option><option value="memory">记住我的喜好</option></select></label><label>需要完成什么<textarea id="agentPrompt" maxlength="2000" placeholder="例如：中午吃了一碗米饭、一个鸡蛋、一些青菜。或：生成七日计划，单餐预算20元。"></textarea></label></div><label>要记住什么<select id="agentMemoryKind"><option value="preference">饮食喜好</option><option value="constraint">忌口与限制</option><option value="rejected">拒绝原因</option><option value="replacement">替换原因</option></select></label><label class="agent-model-toggle"><input id="agentUseModel" type="checkbox"> 使用在线 AI（发送本次所需资料）</label><details class="formula-drawer" id="agentConstraintPanel"><summary>饮食要求（选填）</summary><p class="sub">选择手头的食物，可填写价格和准备时间。</p><div class="input-grid"><label>每餐预算（元）<input type="number" id="agentBudget" min="1" max="1000" placeholder="不限"></label><label>准备时间（分钟）<input type="number" id="agentPrep" min="1" max="240"></label><label>忌口（用逗号分隔）<input type="text" id="agentAvoid" maxlength="200"></label><label>偏好<select id="agentPreference"><option value="多样">尽量多样</option><option value="便宜">更省钱</option><option value="快">更省时</option></select></label></div><div id="agentFoodsTable" class="agent-food-config"></div><p>想比较什么：<input type="text" id="agentHypothesis" placeholder="例如：单餐预算20元；不要鸡肉；准备时间10分钟"></p></details><div class="btn-row"><button type="submit" class="btn btn-primary">开始处理</button><button type="button" class="btn btn-ghost" id="agentCancel" disabled>停止</button></div></form></div><div class="card"><h2>处理进度</h2><div id="agentTaskStatus"><p>还没有开始。</p></div></div></div><div class="card"><h2>结果预览</h2><div id="agentResult"><p>结果会显示在这里，确认后才保存。</p></div></div><div class="card"><h2>我的喜好与反馈</h2><div id="agentMemoryList"></div><button type="button" id="agentAddMemory" class="btn btn-ghost">添加偏好或反馈</button></div><div class="card"><div class="panel-heading"><h2>最近处理记录</h2><button class="btn btn-ghost btn-sm" id="agentClearHistory" type="button">清空处理记录</button></div><div id="agentHistory"></div></div>';
 $('#appMain').appendChild(center);
 $('#agentFoodsTable').innerHTML=FOODS.filter(function(f){return ['grain','meat','dairy','veg','fruit','oil'].includes(f.cat);}).map(function(f){return '<label class="agent-food-config-row" data-food-config="'+escHtml(f.id)+'"><span><input type="checkbox"> '+escHtml(f.n)+' <small>'+escHtml(f.state)+'</small></span><input type="number" data-food-price min="0" max="500" step="0.1" aria-label="'+escHtml(f.n)+'每100克价格" placeholder="元/100g"><input type="number" data-food-time min="0" max="240" aria-label="'+escHtml(f.n)+'准备分钟" placeholder="准备分钟"></label>';}).join('');
 var directory=document.createElement('button');directory.type='button';directory.className='route-card motion-card';directory.dataset.tab='agents';directory.innerHTML='<span class="route-icon">'+uiIcon('spark')+'</span><strong>AI 健康助手</strong><small>记饮食、做计划、总结变化</small>';$('#featureDirectory').prepend(directory);
 var home=document.createElement('div');home.className='agent-home-entry';home.innerHTML=routeCard('agents','AI 健康助手','说说需求，帮你记录与安排','spark');$('.home-projects').after(home);
 // Embed entry points in existing surfaces; do not replace any original forms or handlers.
 var smart=document.createElement('details');smart.className='agent-inline formula-drawer';smart.innerHTML='<summary>AI 帮我识别这餐</summary><p>填写餐食后识别，份量和营养可再核对。</p><button type="button" class="btn btn-ghost" id="quickAgentParse">识别食物</button><p id="quickAgentStatus" role="status"></p><div id="quickAgentOutput"></div>';$('#quickNutrition').before(smart);
 var searchTools=document.createElement('div');searchTools.className='agent-inline';searchTools.innerHTML='<button type="button" class="btn btn-ghost" id="agentFoodSemantic">语义搜索 / 组合餐解析</button><p class="sub">例如：高蛋白晚餐。附近库存、售价以你提供的信息为准。</p>';$('#tab-food [data-feature-panel="library"]').prepend(searchTools);
 var planTools=document.createElement('div');planTools.className='agent-entry-grid';planTools.innerHTML='<button type="button" class="route-card" id="agentPlanEntry"><span class="route-icon">'+uiIcon('food')+'</span><span><strong>安排一周饮食</strong><small>按食材、预算和忌口安排</small></span></button><button type="button" class="route-card" id="agentLabEntry"><span class="route-icon">'+uiIcon('spark')+'</span><span><strong>比较两种吃法</strong><small>换种吃法，看看有什么不同</small></span></button>';$('#tab-plan').insertBefore(planTools,$('#tab-plan').children[1]||null);
 var trendTools=document.createElement('div');trendTools.innerHTML=routeCard('agents','AI 趋势解读','查看样本量、原算法估计与不确定性','activity');trendTools.firstChild.id='agentTrendEntry';$('#weightChartBox').before(trendTools);
 var coachTools=document.createElement('div');coachTools.className='agent-inline';coachTools.innerHTML='<button type="button" class="btn btn-ghost" id="agentWeeklyEntry">本周自适应复盘</button><button type="button" class="btn btn-ghost" id="agentMemoryEntry">查看与更正偏好记忆</button>';$('#coachBox').before(coachTools);
 $('#quickAgentParse').addEventListener('click',function(){var text=$('#quickText').value.trim();if(!text){appNotice('先输入餐食描述');return;}agentRun('nutrition',{text},{host:'quickAgentOutput',slot:{date:$('#quickDate').value,meal:$('#quickSlot').value}});});
 $('#agentFoodSemantic').addEventListener('click',function(){agentOpen('semantic',foodQuery||'高蛋白晚餐');});$('#agentPlanEntry').addEventListener('click',function(){agentOpen('planning','按我的约束生成七日计划');$('#agentConstraintPanel').open=true;});$('#agentLabEntry').addEventListener('click',function(){agentOpen('simulation','如果下周预算或准备时间变化，比较两个方案');$('#agentConstraintPanel').open=true;});
 $('#agentTrendEntry').removeAttribute('data-tab');$('#agentTrendEntry').addEventListener('click',function(){agentOpen('metabolism','解读我的体重趋势与数据质量');});$('#agentWeeklyEntry').addEventListener('click',function(){agentOpen('weekly','复盘实际执行，并生成下周调整草稿');$('#agentConstraintPanel').open=true;});$('#agentMemoryEntry').addEventListener('click',function(){agentOpen('memory','');$('#agentMemoryList').scrollIntoView({block:'center'});});$('#agentAddMemory').addEventListener('click',function(){$('#agentWorkflow').value='memory';$('#agentPrompt').focus();});
 $('#agentTaskForm').addEventListener('submit',function(e){e.preventDefault();var text=$('#agentPrompt').value.trim(),kind=$('#agentWorkflow').value;if(kind==='auto'){kind=agentIntent(text);if(!kind){appNotice('需求尚不明确，请选择具体想做什么');return;}}var input={text};if(kind==='memory')input.memory_kind=$('#agentMemoryKind').value;if(['planning','simulation','weekly','semantic'].includes(kind))input.constraints=agentReadConstraints();if(kind==='simulation')input.hypothesis=agentHypothesis();agentRun(kind,input);});
 $('#agentCancel').addEventListener('click',agentCancel);$('#agentClearHistory').addEventListener('click',function(){if(confirm('清空本机任务摘要？不会删除饮食记录、偏好或计划。')){lsSet(AGENT_HISTORY,'[]');AGENT_APP.tasks=[];agentRenderHistory();}});
 document.addEventListener('click',function(e){
  var choose=e.target.closest('[data-agent-choice]');if(choose&&AGENT_APP.current?.kind==='simulation'){AGENT_APP.simulationChoice=AGENT_APP.current.result[choose.dataset.agentChoice].plan_id;AGENT_APP.lastPlan=AGENT_APP.current.result[choose.dataset.agentChoice];var confirmButton=document.querySelector('#agentResult [data-agent-confirm]');if(confirmButton)confirmButton.textContent='确认保存方案 '+(choose.dataset.agentChoice==='baseline'?'A':'B')+' 为草稿';appNotice('已选择方案 '+(choose.dataset.agentChoice==='baseline'?'A':'B')+'，仍需点击确认保存');}
  if(e.target.closest('[data-agent-replan]')){var previous=AGENT_APP.lastPlan;agentRun('planning',{text:$('#agentPrompt').value,constraints:agentReadConstraints(),previous_plan:previous});}
  if(e.target.closest('[data-agent-confirm]'))agentConfirm();if(e.target.closest('[data-agent-reject]'))agentReject();if(e.target.closest('[data-agent-calendar]'))agentCalendarPlan();
  if(e.target.closest('[data-agent-edit]')){var host=e.target.closest('#quickAgentOutput,#agentResult'),items=[];host.querySelectorAll('[data-agent-food]').forEach(function(el){items.push({food_id:el.value,grams:Number(host.querySelector('[data-agent-grams="'+el.dataset.agentFood+'"]').value)});});agentRun('nutrition',{text:'用户编辑后的餐食',items},{host:host.id,slot:AGENT_APP.slot});}
  var replace=e.target.closest('[data-agent-replace]');if(replace)agentReplace(Number(replace.dataset.agentReplace),replace.dataset.agentSlot);
  var del=e.target.closest('[data-memory-delete]');if(del&&confirm('删除这条已确认记忆？')){lsSet(AGENT_MEM,JSON.stringify(agentMemories().filter(function(m){return m.id!==del.dataset.memoryDelete;})));agentRenderMemory();}
  var edit=e.target.closest('[data-memory-save]');if(edit&&confirm('用编辑后的内容更正此记忆？')){var value=document.querySelector('[data-memory-edit="'+CSS.escape(edit.dataset.memorySave)+'"]').value.trim();if(!value)return;var all=agentMemories();all.forEach(function(m){if(m.id===edit.dataset.memorySave){m.value=value;m.at=new Date().toISOString();m.source='用户主动更正';}});lsSet(AGENT_MEM,JSON.stringify(all));agentRenderMemory();}
 });
 agentRenderMemory();agentRenderHistory();setTimeout(function(){agentRestoreSubmissions().catch(function(e){appNotice('等待结果确认：'+agentNormalizeError(e));});},0);
 if(location.hash.slice(1)==='agents')switchTab('agents',true);
}
function agentHypothesis(){var text=$('#agentHypothesis').value,changes={};var budget=text.match(/(?:预算|每餐|单餐).{0,5}?(\d+(?:\.\d+)?)\s*元/),minutes=text.match(/(\d+)\s*分钟/),avoid=text.match(/(?:不要|不喜欢|不吃)([^，。；\n]{1,15})/);if(budget)changes.budget=Number(budget[1]);if(minutes)changes.max_prep=Number(minutes[1]);if(avoid)changes.avoid=[$('#agentAvoid').value,avoid[1]].filter(Boolean).join('、');if(/运动.*(下降|减少)/.test(text))changes.preference='运动量变化尚不可量化；不自动减少热量，保持当前目标';return changes;}
async function agentCancel(){var t=AGENT_APP.current;if(!t)return;if(agentJson(AGENT_RECEIPTS,{})[t.id]){appNotice('此结果已保存到本机，不能再取消保存；请重试同步确认状态。');return;}try{var result=AGENT_APP.remote?(await agentRemoteRequest('/api/agents/tasks/'+encodeURIComponent(t.id)+'/cancel',{})).task:AGENT_APP.engine.cancel(t.id);agentProgress(result);agentRenderResult(result);}catch(e){appNotice(agentNormalizeError(e));}}
async function agentReject(){var t=AGENT_APP.current;if(!t)return;var reason=prompt('可选：为什么拒绝这次结果？该原因将在再次确认后保存为反馈记忆。','');await agentCancel();if(reason&&confirm('将这条拒绝原因保存到可查看、可删除的记忆中？')){var memories=agentMemories();memories.push({id:HealthAgents.ID('memory'),kind:'rejected',value:reason.slice(0,300),source:'用户拒绝任务 '+t.id,at:new Date().toISOString(),confirmed:true});lsSet(AGENT_MEM,JSON.stringify(memories));agentRenderMemory();}}
function agentReplace(index,slot){var base=AGENT_APP.lastPlan;if(!base)return;var reason=prompt('这餐想怎么换？例如：便宜点、不要鸡肉、没时间准备。','');if(reason===null)return;AGENT_APP.pendingFeedback=reason.slice(0,300);var con=JSON.parse(JSON.stringify(base.constraints));if(/便宜/.test(reason))con.preference='便宜';var avoid=reason.match(/(?:不要|不吃|不喜欢)([^，。；\n]{1,15})/);if(avoid)con.avoid=(Array.isArray(con.avoid)?con.avoid:[]).concat(avoid[1]).join('、');else con.avoid=Array.isArray(con.avoid)?con.avoid.join('、'):con.avoid;
 if(/没时间|更快/.test(reason))con.preference='快';agentRun('planning',{text:reason,base_plan:base,constraints:con,day_index:index,slot,variant:1});}
initAgentUpgrade();
