(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.HealthAgents=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION='2.0.0',NOW=()=>new Date().toISOString(),ID=p=>p+'-'+(typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
const clone=x=>JSON.parse(JSON.stringify(x)),round=x=>Math.round(x*10)/10,finite=x=>typeof x==='number'&&Number.isFinite(x),validDate=d=>typeof d==='string'&&d>='1900-01-01'&&d<='2200-12-31'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const STATES={pending:['running','cancelled'],running:['needs_input','needs_confirmation','completed','failed','cancelled'],needs_input:['cancelled'],needs_confirmation:['completed','cancelled','failed'],completed:[],failed:[],cancelled:[]};
class AgentError extends Error{constructor(code,message,data){super(message);this.code=code;this.data=data;}}
const fail=(code,msg,data)=>{throw new AgentError(code,msg,data);};
function schemaCheck(value,schema,path='$'){
 if(schema.enum&&!schema.enum.includes(value))fail('SCHEMA',path+' 枚举值无效');
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('SCHEMA',path+' 必须是对象');
  for(const key of schema.required||[])if(!(key in value))fail('SCHEMA',path+'.'+key+' 缺失');
  for(const key of Object.keys(value)){if(['__proto__','constructor','prototype'].includes(key))fail('SCHEMA','非法键');if(!schema.properties?.[key]){if(schema.additionalProperties===false)fail('SCHEMA',path+'.'+key+' 不允许');}else schemaCheck(value[key],schema.properties[key],path+'.'+key);}
 }
 if(schema.type==='array'){if(!Array.isArray(value)||value.length<(schema.minItems||0)||value.length>(schema.maxItems??10000))fail('SCHEMA',path+' 数组长度无效');value.forEach((v,i)=>schemaCheck(v,schema.items||{},path+'['+i+']'));}
 if(schema.type==='string'&&(typeof value!=='string'||value.length>(schema.maxLength??20000)||value.length<(schema.minLength||0)))fail('SCHEMA',path+' 文本无效');
 if(schema.type==='number'&&(!finite(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))fail('SCHEMA',path+' 数值超出范围');
 if(schema.type==='boolean'&&typeof value!=='boolean')fail('SCHEMA',path+' 布尔值无效');
 return true;
}
const str={type:'string',maxLength:1000},num={type:'number',minimum:0,maximum:10000},obj=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false}),arr=(items,min=0,max=100)=>({type:'array',items,minItems:min,maxItems:max});
const itemSchema=obj({food_id:{type:'string',maxLength:80},grams:{type:'number',minimum:1,maximum:1000}});
const resultSchemas={
 nutrition:obj({task_id:str,items:arr(obj({food_id:str,grams:num,name:str,source:str,assumption:str,confidence:str,unresolved:{type:'boolean'}}),0,30),nutrition_totals:{type:'object'},questions:arr(str),requires_confirmation:{type:'boolean'}}),
 metabolism:obj({task_id:str,estimate:{type:'object'},evidence:arr({type:'object'}),uncertainties:arr(str),requires_confirmation:{type:'boolean'}}),
 behavior:obj({task_id:str,comparison:{type:'object'},memory:arr({type:'object'}),recommendations:arr(str),requires_confirmation:{type:'boolean'}}),
 planning:obj({task_id:str,plan_id:str,constraints:{type:'object'},days:arr(obj({date:str,meals:arr(obj({slot:{enum:['breakfast','lunch','dinner','snack']},items:arr(itemSchema,1,8),nutrition_totals:{type:'object'},cost:{},prep_minutes:{}}),3,4),nutrition_totals:{type:'object'}}),7,7),nutrition_totals:{type:'object'},assumptions:arr(str),uncertainties:arr(str),validation:{type:'object'},alternatives:arr({type:'object'}),explanation:str,requires_confirmation:{type:'boolean'}})
};

resultSchemas.semantic=obj({candidates:arr({type:'object'},0,15),combinations:arr({type:'object'},0,5),note:str});
resultSchemas.memory=obj({kind:{enum:['preference','constraint','accepted','rejected','replacement']},value:str,source:str,id:str,at:str,confirmed:{type:'boolean'},requires_confirmation:{type:'boolean'}});
resultSchemas.simulation=obj({hypothetical:{type:'boolean'},baseline:resultSchemas.planning,alternative:resultSchemas.planning,differences:{type:'object'},note:str});
resultSchemas.weekly=obj({metabolism:resultSchemas.metabolism,behavior:resultSchemas.behavior,planning:{},note:str},['metabolism','behavior','planning']);
const taskSchema=obj({id:str,kind:str,status:{enum:Object.keys(STATES)},created_at:str,updated_at:str,input_summary:str,steps:arr({type:'object'},0,150),calls:num,result:{},mode:str},['id','kind','status','created_at','updated_at','steps','calls','mode']);taskSchema.additionalProperties=true;

const toolSchemas={
 validate_agent_result:obj({kind:{enum:['nutrition','metabolism','behavior','planning','semantic','memory','simulation','weekly']},result:{type:'object'}}),search_food_database:obj({query:str}),parse_meal_description:obj({text:str}),calculate_meal_nutrition:obj({items:arr(itemSchema,0,30)}),
 get_diary_entries:obj({from:str,to:str}),get_weight_history:obj({from:str,to:str}),get_current_stage:obj({}),calculate_tdee_trend:obj({}),get_user_preferences:obj({}),
 save_user_preference_with_confirmation:obj({kind:{enum:['preference','constraint','accepted','rejected','replacement']},value:str,source:str}),
 validate_meal_plan:obj({plan:{type:'object'}}),compare_plan_with_actual:obj({plan_id:str}),create_plan_draft:obj({plan:{type:'object'}}),apply_confirmed_plan:obj({plan_id:str})
};
const AGENTS={Nutrition:['search_food_database','parse_meal_description','calculate_meal_nutrition'],Metabolism:['get_diary_entries','get_weight_history','get_current_stage','calculate_tdee_trend'],Planning:['get_current_stage','get_user_preferences','search_food_database','calculate_meal_nutrition','validate_meal_plan','create_plan_draft'],Behavior:['get_diary_entries','get_user_preferences','compare_plan_with_actual','save_user_preference_with_confirmation'],Guardian:['validate_meal_plan','validate_agent_result'],Orchestrator:['apply_confirmed_plan']};
const ALIASES={'米饭':['rice'],'鸡腿':['chickenleg','chicken-leg','chicken'],'鸡胸':['chickenbreast','chicken'],'青菜':['spinach','youmaicai'],'炒青菜':['spinach','youmaicai'],'鸡蛋':['egg'],'牛奶':['milk'],'西红柿':['tomato'],'高蛋白':['chicken','egg','tofu','beef','fish']};
function safeText(text){if(typeof text!=='string'||text.length>2000)fail('INPUT','请输入 2000 字以内文本');if(/(催吐|滥用.*泻药|利尿剂.*减|绝食|每天.{0,8}[1-6]\d{2}\s*(千卡|大卡)|一周.{0,5}(瘦|减).{0,2}(十|10|20)斤)/.test(text))fail('SAFETY','该请求不适合普通健康规划，请咨询专业人士。');return text;}
function normalizeContext(c,foods){
 c=c||{};const out={today:validDate(c.today)?c.today:NOW().slice(0,10),foods:foods||c.foods||[],diary:[],weights:[],stage:c.stage?clone(c.stage):null,profile:c.profile?clone(c.profile):null,preferences:[],plan:c.plan?clone(c.plan):null,trend:c.trend||null};
 if(!Array.isArray(out.foods)||out.foods.length>1000)fail('INPUT','食物目录无效');
 out.foods=out.foods.map(f=>({id:String(f.id).slice(0,80),n:String(f.n).slice(0,80),cat:String(f.cat),k:f.k,p:f.p,f:f.f,c:f.c,state:f.state||'edible',src:f.src||'项目内置参考值，未独立核实原始数据版本'})).filter(f=>[f.k,f.p,f.f,f.c].every(v=>finite(v)&&v>=0&&v<=1000));
 if(new Set(out.foods.map(f=>f.id)).size!==out.foods.length)fail('INPUT','食物编号重复');
 if(!Array.isArray(c.diary||[])||(c.diary||[]).length>2000)fail('INPUT','记录范围过大');
 for(const e of c.diary||[]){if(!validDate(e.date))fail('INPUT','饮食日期无效');out.diary.push({date:e.date,meal:['breakfast','lunch','dinner','snack'].includes(e.meal)?e.meal:'snack',name:String(e.name||'').slice(0,100),kcal:finite(e.kcal)&&e.kcal>=0&&e.kcal<=10000?e.kcal:null,p:finite(e.p)?e.p:null,f:finite(e.f)?e.f:null,c:finite(e.c)?e.c:null,aiPlan:e.aiPlan===true,planId:typeof e.planId==='string'?e.planId:'',unknownKcal:finite(e.unknownKcal)?e.unknownKcal:0});}
 if(!Array.isArray(c.weights||[])||(c.weights||[]).length>120)fail('INPUT','体重范围无效');
 out.weights=(c.weights||[]).map(w=>{if(!validDate(w.date)||!finite(w.value)||w.value<20||w.value>300)fail('INPUT','体重无效');return {date:w.date,value:w.value};});
 if(new Set(out.weights.map(w=>w.date)).size!==out.weights.length)fail('INPUT','体重日期重复');
 out.weights.sort((a,b)=>a.date.localeCompare(b.date));
 out.preferences=(c.preferences||[]).slice(0,100).filter(m=>m.confirmed===true).map(m=>({id:String(m.id),kind:String(m.kind),value:String(m.value).slice(0,300),source:String(m.source||'用户确认'),at:String(m.at),confirmed:true}));
 if(out.stage){for(const k of ['kcal','protein','fat','carb','tdee','bmr'])if(out.stage[k]!==null&&out.stage[k]!==undefined&&(!finite(out.stage[k])||out.stage[k]<0||out.stage[k]>8000))fail('INPUT','阶段数值无效');}
 return out;
}
function search(c,q){q=String(q||'').trim();if(!q)return c.foods.slice(0,15);const words=q.replace(/[，、。]/g,' ').split(/\s+/).filter(Boolean);return c.foods.map(f=>{let score=0;for(const word of words){if(f.id===word)score+=120;else if(f.n===word)score+=100;else if(f.n.includes(word)||word.includes(f.n))score+=60;else if((ALIASES[word]||[]).includes(f.id))score+=55;if((ALIASES[word]||[]).includes(f.id))score+=20;}if(/高蛋白/.test(q)&&f.p>=10)score+=30;if(/便宜|省钱/.test(q)&&['egg','tofu','rice'].includes(f.id))score+=5;return {f,score};}).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,10).map(x=>({...x.f,match_score:x.score}));}
const CHINESE={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'半':.5};
function parseMeal(c,text){
 safeText(text);let chunks=text.replace(/(今天|今日|中午|晚上|早上|早饭|早餐|午餐|晚餐|吃了|我吃了)/g,'').split(/[，、,；;\n]|和/).map(s=>s.trim()).filter(Boolean);
 return chunks.slice(0,20).map(chunk=>{
  const amount=chunk.match(/(\d+(?:\.\d+)?|[一二两三四五半])\s*(克|g|毫升|ml|碗|个|份|片|把|勺|杯)/i),qty=amount?(CHINESE[amount[1]]??Number(amount[1])):null,unit=amount?amount[2]:'未知';
  const name=chunk.replace(/(\d+(?:\.\d+)?|[一二两三四五半])\s*(克|g|毫升|ml|碗|个|份|片|把|勺|杯)/ig,'').replace(/一些|一点|一块/g,'').trim();
  const candidates=search(c,name),food=candidates[0],assumed={碗:150,个:50,份:100,片:35,把:30,勺:10,杯:250};
  const explicit=amount&&/^(克|g|毫升|ml)$/i.test(unit),grams=qty?(explicit?qty:qty*(assumed[unit]||100)):null;
  return {food_id:food?.id||'',grams:grams||0,name:food?.n||name,source:food?.src||'未知，尚无数据库匹配',assumption:explicit?'按用户输入重量计算':grams?qty+unit+' 暂按 '+grams+'g，需确认实际份量；烹饪用油未计入':'份量不明确，请补充克重；烹饪用油需单独确认',confidence:explicit&&food?'参考值':'估算/待澄清',unresolved:!food||!grams||!!(candidates[1]&&candidates[1].match_score===candidates[0].match_score),candidates:candidates.slice(0,4).map(f=>({id:f.id,name:f.n})),cooking:/炒|煎|炸|烤/.test(chunk)?'存在额外油脂，需单独补录':'做法未说明'};
 });
}
function nutrition(c,items){
 schemaCheck({items},toolSchemas.calculate_meal_nutrition);let totals={kcal:0,protein:0,fat:0,carb:0};const warnings=[],refs=[];
 for(const it of items){const f=c.foods.find(f=>f.id===it.food_id);if(!f)fail('FOOD_ID','未知食物编号 '+it.food_id);const g=it.grams/100;totals.kcal+=f.k*g;totals.protein+=f.p*g;totals.fat+=f.f*g;totals.carb+=f.c*g;refs.push({food_id:f.id,grams:it.grams,source:f.src,state:f.state});const macro=4*f.p+9*f.f+4*f.c;if(Math.abs(macro-f.k)>Math.max(25,f.k*.3))warnings.push(f.n+' 的供能与宏量换算差异较大，请核对原条目');}
 for(const k in totals)totals[k]=round(totals[k]);return {totals,refs,warnings,estimated:true,uncertainty:'数据库参考值 × 份量，未包含未录入的烹饪油/酱料；非化验结果'};
}
function constraints(c,input){
 const s=c.stage;if(!c.profile||!finite(c.profile.age)||c.profile.age<18||c.profile.age>100||c.profile.special!=='none')fail('SAFETY','需要有效成人身体基准，且确认无特殊健康情况');
 if(!s||!finite(s.kcal)||s.kcal<1200||s.restricted||s.safety_status==='restricted'||(c.profile&& (c.profile.age<18||c.profile.special!=='none')))fail('SAFETY','当前资料或健康情况不适合自动生成普通成人饮食计划，请先确认基准或寻求专业评估');
 if(!finite(s.bmr)||!finite(s.tdee)||s.kcal<s.bmr||s.kcal<s.tdee*.75||s.tdee-s.kcal>750||s.kcal-s.tdee>500)fail('SAFETY','能量目标超出已有安全约束，不能生成计划');
 input=input||{};const allowed=Array.isArray(input.available_ids)?input.available_ids:[];
 if(allowed.length<3||allowed.some(id=>!c.foods.some(f=>f.id===id)))fail('NEEDS_INPUT','请至少确认三种可获得食物，包含主食、蛋白质和蔬菜');
 const avoid=String(input.avoid||'').split(/[，,、\n]/).map(x=>x.trim()).filter(Boolean);
 for(const m of c.preferences.filter(m=>m.kind==='constraint'||/^(不要|不吃|不喜欢|过敏)/.test(m.value)))for(const word of m.value.replace(/^(不要|不吃|不喜欢|过敏)\s*/,'').split(/[，,、\n]/))if(word.trim())avoid.push(word.trim());
 const prices={},times={};for(const id of allowed){if(input.prices?.[id]!==undefined){if(!finite(input.prices[id])||input.prices[id]<0||input.prices[id]>500)fail('INPUT','价格无效');prices[id]=input.prices[id];}if(input.prep_times?.[id]!==undefined){if(!finite(input.prep_times[id])||input.prep_times[id]<0||input.prep_times[id]>240)fail('INPUT','时间无效');times[id]=input.prep_times[id];}}
 let budget=input.budget??null,maxPrep=input.max_prep??null;for(const memory of c.preferences.filter(m=>m.kind==='constraint')){const b=memory.value.match(/(?:单餐预算|每餐预算).{0,4}?(\d+(?:\.\d+)?)\s*元/),t=memory.value.match(/准备.{0,12}?(\d+)\s*分钟/);if(b)budget=budget===null?Number(b[1]):Math.min(budget,Number(b[1]));if(t)maxPrep=maxPrep===null?Number(t[1]):Math.min(maxPrep,Number(t[1]));}if(budget!==null&&(!finite(budget)||budget<1||budget>1000))fail('INPUT','预算无效');if(maxPrep!==null&&(!finite(maxPrep)||maxPrep<1||maxPrep>240))fail('INPUT','准备时间无效');
 const ids=allowed.filter(id=>!avoid.some(w=>c.foods.find(f=>f.id===id).n.includes(w)));
 if(budget!==null&&ids.some(id=>prices[id]===undefined))fail('NEEDS_INPUT','有预算约束时，请填写所有候选食物每100克价格；系统不会编造价格');
 if(maxPrep!==null&&ids.some(id=>times[id]===undefined))fail('NEEDS_INPUT','有准备时间约束时，请填写各食材预计准备分钟数');
 return {available_ids:ids,avoid,prices,prep_times:times,budget,max_prep:maxPrep,preference:String(input.preference||'').slice(0,300),target_kcal:s.kcal,protein:s.protein||s.kcal*.18/4,fat:s.fat||s.kcal*.27/9,carb:s.carb||Math.max(0,(s.kcal-(s.protein||s.kcal*.18/4)*4-(s.fat||s.kcal*.27/9)*9)/4),scope:'预算为单餐上限；时间按用户估计相加，价格不是实时商店报价'};
}
function meal(c,items,con){const n=nutrition(c,items);return {items,nutrition_totals:n.totals,cost:items.every(i=>con.prices[i.food_id]!==undefined)?round(items.reduce((s,i)=>s+con.prices[i.food_id]*i.grams/100,0)):null,prep_minutes:items.every(i=>con.prep_times[i.food_id]!==undefined)?items.reduce((s,i)=>s+con.prep_times[i.food_id],0):null};}
function generateMeal(c,con,share,variant=0){
 const pool=c.foods.filter(f=>con.available_ids.includes(f.id)),grains=pool.filter(f=>f.cat==='grain'&&f.c>10),proteins=pool.filter(f=>['meat','dairy'].includes(f.cat)&&f.p>=4),vegs=pool.filter(f=>f.cat==='veg'),oil=pool.find(f=>f.cat==='oil'&&f.k>0);let recipes=[];
 for(const g of grains)for(const p of proteins)for(const v of vegs)for(const oilGrams of (oil?[0,5,10,15,20,25]:[0])){
  const energy=con.target_kcal*share-v.k-(oil?oil.k*oilGrams/100:0),prot=con.protein*share-v.p-(oil?oil.p*oilGrams/100:0),det=g.k*p.p-p.k*g.p;if(Math.abs(det)<1e-6)continue;
  const gg=(energy*p.p-p.k*prot)/det*100,pg=(g.k*prot-energy*g.p)/det*100;
  if(gg<30||gg>650||pg<20||pg>400)continue;
  const m=meal(c,[{food_id:g.id,grams:round(gg)},{food_id:p.id,grams:round(pg)},{food_id:v.id,grams:100},...(oilGrams?[{food_id:oil.id,grams:oilGrams}]:[])],con);
  if(m.nutrition_totals.fat<con.fat*share*.7||m.nutrition_totals.fat>con.fat*share*1.35||m.nutrition_totals.carb<con.carb*share*.7||m.nutrition_totals.carb>con.carb*share*1.35)continue;
  if(con.budget!==null&&m.cost>con.budget)continue;if(con.max_prep!==null&&m.prep_minutes>con.max_prep)continue;recipes.push(m);
 }
 if(!recipes.length)fail('NEEDS_INPUT','现有食物或预算/时间无法同时满足当前营养目标。请补充候选食物，或调整约束后重试。');
 recipes.sort((a,b)=>con.preference.includes('便宜')||con.budget!==null?(a.cost??0)-(b.cost??0):con.preference.includes('快')?(a.prep_minutes??0)-(b.prep_minutes??0):a.items[1].food_id.localeCompare(b.items[1].food_id));return clone(recipes[variant%recipes.length]);
}
function planTotals(days){const n={kcal:0,protein:0,fat:0,carb:0};for(const day of days)for(const k in n)n[k]+=day.nutrition_totals[k];for(const k in n)n[k]=round(n[k]);return n;}
function buildPlan(c,input,taskId,variant=0){const con=constraints(c,input),days=[];for(let i=0;i<7;i++){const d=new Date(c.today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);const meals=['breakfast','lunch','dinner'].map((slot,j)=>({slot,...generateMeal(c,con,[.3,.35,.35][j],variant+i+j)})),totals={kcal:0,protein:0,fat:0,carb:0};meals.forEach(m=>Object.keys(totals).forEach(k=>totals[k]+=m.nutrition_totals[k]));Object.keys(totals).forEach(k=>totals[k]=round(totals[k]));days.push({date:d.toISOString().slice(0,10),meals,nutrition_totals:totals});}
 return {task_id:taskId,plan_id:ID('plan'),constraints:con,days,nutrition_totals:planTotals(days),assumptions:['所有份量均为数据库对应状态的可食重量','价格与准备时间只使用用户提供值','早餐也按现有候选组合求解，可用单餐替换进一步改善偏好'],uncertainties:['未计入未选择的调味油、酱料；营养为参考估算','每日准备时间按各食材估计相加，不能保证实际时间','不预测确定的体重或体脂变化'],validation:{valid:false,issues:[]},alternatives:[],explanation:'按可获得食物枚举组合，通过能量与蛋白质线性方程求份量，再逐项核查预算、忌口与时间。',requires_confirmation:true};}
function validatePlan(c,plan){
 safeText(String(plan.explanation||''));
 schemaCheck(plan,resultSchemas.planning);const con=constraints(c,plan.constraints);const issues=[],warnings=[];if(new Set(plan.days.map(d=>d.date)).size!==7)issues.push('日期必须为七个不同日期');
 plan.days.forEach((d,index)=>{const expected=new Date(c.today+'T12:00:00Z');expected.setUTCDate(expected.getUTCDate()+index);if(d.date!==expected.toISOString().slice(0,10))issues.push('日期超出规划范围');if(new Set(d.meals.map(m=>m.slot)).size!==d.meals.length||!['breakfast','lunch','dinner'].every(s=>d.meals.some(m=>m.slot===s)))issues.push('缺少三餐或餐次重复');let totals={kcal:0,protein:0,fat:0,carb:0};
  for(const m of d.meals){const localCon=plan.constraints.meal_overrides?.[d.date+'/'+m.slot]?constraints(c,plan.constraints.meal_overrides[d.date+'/'+m.slot]):con;for(const it of m.items)if(!localCon.available_ids.includes(it.food_id))issues.push('使用未授权、不可获得或忌口食物');const computed=meal(c,m.items,localCon);for(const k in totals){totals[k]+=computed.nutrition_totals[k];if(!finite(m.nutrition_totals[k])||Math.abs(m.nutrition_totals[k]-computed.nutrition_totals[k])>1)issues.push('营养数字与工具计算不一致');}
   if(localCon.budget!==null&&(computed.cost===null||computed.cost>localCon.budget))issues.push('单餐预算超限');if(localCon.max_prep!==null&&(computed.prep_minutes===null||computed.prep_minutes>localCon.max_prep))issues.push('准备时间超限');if(m.cost!==computed.cost||m.prep_minutes!==computed.prep_minutes)issues.push('价格或准备时间与工具结果不一致');warnings.push(...nutrition(c,m.items).warnings);}
  for(const k in totals){totals[k]=round(totals[k]);if(!finite(d.nutrition_totals[k])||Math.abs(d.nutrition_totals[k]-totals[k])>1)issues.push('日营养汇总不一致');}
  if(totals.kcal<con.target_kcal*.85||totals.kcal>con.target_kcal*1.15)issues.push('能量目标偏差超出15%');if(totals.protein<con.protein*.8||totals.protein>con.protein*1.6)issues.push('蛋白质超出校验区间');if(totals.fat<con.fat*.7||totals.fat>con.fat*1.35)issues.push('脂肪超出校验区间');if(totals.carb<con.carb*.7||totals.carb>con.carb*1.35)issues.push('碳水超出校验区间');
 });const all=planTotals(plan.days);for(const k in all)if(!finite(plan.nutrition_totals[k])||Math.abs(plan.nutrition_totals[k]-all[k])>1)issues.push('七日汇总不一致');return {valid:issues.length===0,issues:[...new Set(issues)],warnings:[...new Set(warnings)],checked_at:NOW(),checks:['schema','food_ids','dates','nutrition_recomputed','budget','avoid','prep_time','energy_range','protein_range']};
}
function compare(c,planId){const plan=c.plan;if(!plan||plan.plan_id!==planId)return {plan_id:planId,matched:0,unrecorded:0,notes:['没有可比较的已确认计划']};const result={plan_id:planId,matched:0,unrecorded:0,meal_count:0,days:[],notes:['记录中同餐有实际条目仅表示有记录，不代表完全遵循计划；未记录不等于未进食']};for(const d of plan.days){if(d.date>c.today)continue;let row={date:d.date,slots:[]};for(const m of d.meals){const actual=c.diary.filter(e=>e.date===d.date&&e.meal===m.slot&&!e.aiPlan);result.meal_count++;if(actual.length)result.matched++;else result.unrecorded++;row.slots.push({slot:m.slot,actual_entries:actual.length,known_kcal:round(actual.reduce((s,e)=>s+(e.kcal||0),0)),plan_kcal:m.nutrition_totals.kcal,has_unknown:actual.some(e=>e.kcal===null),status:actual.length?'有实际记录，需人工核对执行':'无实际记录，执行未知'});}result.days.push(row);}return result;}

function guardResult(c,kind,result){
 if(resultSchemas[kind])schemaCheck(result,resultSchemas[kind]);
 if(kind==='nutrition'){if(result.items.some(i=>i.food_id&&!c.foods.some(f=>f.id===i.food_id&&f.src===i.source)))fail('EVIDENCE','食物来源不一致');const known=result.items.filter(i=>!i.unresolved);const n=nutrition(c,known.map(i=>({food_id:i.food_id,grams:i.grams})));for(const key of ['kcal','protein','fat','carb'])if(Math.abs(n.totals[key]-result.nutrition_totals.totals[key])>.2)fail('NUTRITION_MISMATCH','营养汇总不一致');}
 if(kind==='planning'){const v=validatePlan(c,result);if(!v.valid)fail('PLAN_INVALID',v.issues.join('；'));}
 if(kind==='behavior'&&result.memory.some(m=>!c.preferences.some(p=>p.id===m.id&&p.value===m.value)))fail('EVIDENCE','记忆没有用户确认的来源');
 if(kind==='metabolism'&&result.evidence.some(e=>!['diary.actual.count','weight.points','weight.dates'].includes(e.id)))fail('EVIDENCE','未知的证据编号');
 if(kind==='semantic'&&(!Array.isArray(result.candidates)||result.candidates.some(f=>!c.foods.some(x=>x.id===f.id&&x.k===f.k&&x.p===f.p))))fail('FOOD_ID','语义候选来源不一致');
 if(kind==='memory'&&(!['preference','constraint','accepted','rejected','replacement'].includes(result.kind)||result.confirmed!==false||typeof result.value!=='string'))fail('SCHEMA','记忆草稿结构无效');
 if(kind==='weekly'){guardResult(c,'metabolism',result.metabolism);guardResult(c,'behavior',result.behavior);if(result.planning)guardResult(c,'planning',result.planning);}
 if(kind==='simulation'){guardResult(c,'planning',result.baseline);guardResult(c,'planning',result.alternative);if(result.hypothetical!==true)fail('SCHEMA','模拟缺少假设标记');}
 return {valid:true,checks:['schema','registered_foods','deterministic_numbers','provenance','confirmation_gate'],at:NOW()};
}

class Orchestrator{
 constructor(context,adapter={}){this.context=normalizeContext(context,adapter.foods);this.adapter=adapter;this.tasks=new Map();this.drafts=new Map();this.maxCalls=adapter.maxCalls||120;}
 transition(t,status){if(['needs_input','needs_confirmation','completed'].includes(status)&&t.result){t.validation=guardResult(this.context,t.kind,t.result);if(!t.steps.some(s=>s.agent==='Guardian'&&s.tool==='validate_agent_result'))t.steps.push({id:ID('guard'),agent:'Guardian',tool:'validate_agent_result',status:'completed',at:NOW(),summary:'独立结构、来源与数值复核',duration_ms:0});}if(!STATES[t.status]?.includes(status))fail('STATE','不允许状态转换 '+t.status+' → '+status);t.status=status;t.requires_confirmation=status==='needs_confirmation';t.updated_at=NOW();this.emit(t);}
 emit(t){this.adapter.onUpdate?.(clone(t));}
 check(t){if(t.cancelled||t.status==='cancelled')fail('CANCELLED','任务已取消');if(Date.now()-t.started_ms>(this.adapter.timeoutMs||45000))fail('TIMEOUT','任务已超时');if(t.calls>=this.maxCalls)fail('CALL_LIMIT','工具调用次数达到上限');}
 async tool(t,agent,name,args={}){
  this.check(t);if(!AGENTS[agent]?.includes(name))fail('TOOL_PERMISSION',agent+' 无权调用 '+name);if(!toolSchemas[name])fail('TOOL_UNKNOWN','工具未注册');schemaCheck(args,toolSchemas[name]);t.calls++;
  const step={id:ID('call'),agent,tool:name,status:'running',at:NOW(),input_summary:name.includes('history')||name.includes('entries')?'读取授权日期范围':name.includes('plan')?'结构化计划（不记录完整原文）':Object.keys(args).join(',')};t.steps.push(step);this.emit(t);
  await (this.adapter.yieldControl?this.adapter.yieldControl():new Promise(r=>setTimeout(r,0)));this.check(t);
  try{const c=this.context;let data;
   switch(name){
    case 'validate_agent_result':data=guardResult(c,args.kind,args.result);break;
    case 'search_food_database':data=search(c,args.query);break;
    case 'parse_meal_description':data=parseMeal(c,args.text);break;
    case 'calculate_meal_nutrition':data=nutrition(c,args.items);break;
    case 'get_diary_entries':case 'get_weight_history':{if(!validDate(args.from)||!validDate(args.to)||args.from>args.to)fail('DATE','日期范围无效');data=(name==='get_diary_entries'?c.diary.filter(e=>!e.aiPlan):c.weights).filter(e=>e.date>=args.from&&e.date<=args.to);break;}
    case 'get_current_stage':data=c.stage;break;
    case 'calculate_tdee_trend':{if(!this.adapter.calculateTdee)fail('NO_ALGORITHM','未连接原有TDEE计算器');const est=this.adapter.calculateTdee(c);data={estimate:est,interval:est.ok&&finite(est.weightSd)&&est.spanDays?{low:Math.round(est.tdee-est.weightSd*7700/est.spanDays),high:Math.round(est.tdee+est.weightSd*7700/est.spanDays),label:'体重残差传播的敏感性范围，不是统计置信区间；不含系统性漏记误差'}:null,note:'未调用写入校准的操作；仅计算候选估计'};break;}
    case 'get_user_preferences':data=c.preferences;break;
    case 'save_user_preference_with_confirmation':data={...args,id:ID('memory'),at:NOW(),confirmed:false,requires_confirmation:true};break;
    case 'validate_meal_plan':data=validatePlan(c,args.plan);break;
    case 'compare_plan_with_actual':data=compare(c,args.plan_id);break;
    case 'create_plan_draft':{const v=validatePlan(c,args.plan);if(!v.valid)fail('PLAN_INVALID',v.issues.join('；'));data={...clone(args.plan),validation:v};this.drafts.set(data.plan_id,data);break;}
    case 'apply_confirmed_plan':{if(!t.confirmation||t.confirmation.plan_id!==args.plan_id)fail('CONFIRMATION','必须先得到用户对该计划的明确确认');const plan=this.drafts.get(args.plan_id);if(!plan)fail('PLAN_NOT_FOUND','没有待确认的计划');data={plan:clone(plan),aiPlan:true,requires_local_commit:true};break;}
   }
   step.status='completed';step.summary=Array.isArray(data)?data.length+' 项':data?.valid===false?'校验未通过':'返回结构化工具结果';const result={success:true,data,error_code:null,warnings:[],source:name==='calculate_tdee_trend'?'原有 computeTdeeEstimate()':name.includes('nutrition')||name.includes('food')?'项目内置食物参考数据库':'授权的本地数据与确定性工具',timestamp:NOW()};step.duration_ms=Date.now()-Date.parse(step.at);this.emit(t);return result;
  }catch(e){step.status='failed';step.error_code=e.code||'TOOL_FAILED';this.emit(t);throw e;}
 }
 async nutrition(t,input){const parsed=(await this.tool(t,'Nutrition','parse_meal_description',{text:input.text})).data;for(const item of parsed)await this.tool(t,'Nutrition','search_food_database',{query:item.name});let items=parsed.map(({candidates,cooking,...i})=>i);
  if(input.items){schemaCheck({items:input.items},toolSchemas.calculate_meal_nutrition);items=input.items.map(it=>{const f=this.context.foods.find(f=>f.id===it.food_id);if(!f)fail('FOOD_ID','食物编号无效');return {...it,name:f.n,source:f.src,assumption:'用户编辑确认份量；烹饪状态 '+f.state,confidence:'参考值',unresolved:false};});}
  const unresolved=items.filter(i=>i.unresolved),numbers=await this.tool(t,'Nutrition','calculate_meal_nutrition',{items:items.filter(i=>!i.unresolved).map(i=>({food_id:i.food_id,grams:i.grams}))});
  const r={task_id:t.id,items,nutrition_totals:numbers.data,questions:unresolved.map(i=>'请补充“'+i.name+'”的数据库条目或克重'),requires_confirmation:true};schemaCheck(r,resultSchemas.nutrition);t.result=r;t.validation=(await this.tool(t,'Guardian','validate_agent_result',{kind:'nutrition',result:r})).data;t.candidates=parsed.map(x=>({name:x.name,candidates:x.candidates,cooking:x.cooking}));this.transition(t,unresolved.length?'needs_input':'needs_confirmation');
 }
 async metabolism(t){const from=new Date(this.context.today+'T12:00:00Z');from.setUTCDate(from.getUTCDate()-27);const range={from:from.toISOString().slice(0,10),to:this.context.today};const diary=(await this.tool(t,'Metabolism','get_diary_entries',range)).data,weights=(await this.tool(t,'Metabolism','get_weight_history',range)).data;await this.tool(t,'Metabolism','get_current_stage',{});const calc=(await this.tool(t,'Metabolism','calculate_tdee_trend',{})).data;
 const result={task_id:t.id,estimate:calc,evidence:[{id:'diary.actual.count',value:diary.length,source:'actualEntries：排除aiPlan草稿'},{id:'weight.points',value:weights.length,source:'授权的28天体重记录'},{id:'weight.dates',value:weights.map(w=>w.date),source:'体重记录日期'}],uncertainties:['不是医学诊断；短期停滞不能据此解释为代谢下降','体重残差敏感性范围不包含漏记等系统误差',...(calc.estimate.ok?[]:[calc.estimate.reason||'数据不足'])],requires_confirmation:false};schemaCheck(result,resultSchemas.metabolism);t.agent_results.Metabolism=result;return result;
 }
 async behavior(t,feedback=''){const preferences=(await this.tool(t,'Behavior','get_user_preferences',{})).data;const comparison=(await this.tool(t,'Behavior','compare_plan_with_actual',{plan_id:this.context.plan?.plan_id||''})).data;const result={task_id:t.id,comparison,memory:preferences,recommendations:[...(feedback.trim()?['用户本次主动反馈：'+safeText(feedback).slice(0,300)]:[]),comparison.unrecorded?'有未记录餐次，先补全记录或说明执行障碍':'继续记录实际执行；有记录不代表完全遵循计划',...preferences.filter(m=>m.kind==='rejected'||m.kind==='replacement').slice(-3).map(m=>'下次规划参考已确认反馈：'+m.value)],requires_confirmation:false};schemaCheck(result,resultSchemas.behavior);t.agent_results.Behavior=result;return result;}
 async planning(t,input){await this.tool(t,'Planning','get_current_stage',{});await this.tool(t,'Planning','get_user_preferences',{});let plan;
  if(input.base_plan){const base=clone(input.base_plan);const checked=validatePlan(this.context,base);if(!checked.valid)fail('PLAN_INVALID','原计划验证失败');plan=base;plan.task_id=t.id;plan.plan_id=ID('plan');const con=constraints(this.context,input.constraints),index=Number(input.day_index),slot=input.slot;if(!Number.isInteger(index)||index<0||index>6||!['breakfast','lunch','dinner'].includes(slot))fail('INPUT','替换日期或餐次无效');const m=plan.days[index].meals.find(m=>m.slot===slot);if(!m)fail('INPUT','餐次不存在');let replacement=generateMeal(this.context,con,slot==='breakfast'?.3:.35,(input.variant||0)+1);if(JSON.stringify(m.items)===JSON.stringify(replacement.items)){for(let n=2;n<20;n++){let next=generateMeal(this.context,con,slot==='breakfast'?.3:.35,n);if(JSON.stringify(m.items)!==JSON.stringify(next.items)){replacement=next;break;}}}if(JSON.stringify(m.items)===JSON.stringify(replacement.items))fail('NEEDS_INPUT','没有找到满足约束的不同组合，请增加候选食物');Object.assign(m,replacement);plan.constraints=clone(base.constraints);plan.constraints.meal_overrides={...(base.constraints.meal_overrides||{}),[plan.days[index].date+'/'+slot]:con};plan.days.forEach(d=>{for(const k of ['kcal','protein','fat','carb'])d.nutrition_totals[k]=round(d.meals.reduce((s,m)=>s+m.nutrition_totals[k],0));});plan.nutrition_totals=planTotals(plan.days);plan.explanation='仅替换 '+plan.days[index].date+' '+slot+'，其余餐食保持原样；全计划按新约束重新验证。';
  }else plan=buildPlan(this.context,input.constraints,t.id,input.variant||0);
  for(const id of plan.constraints.available_ids.slice(0,12))await this.tool(t,'Planning','search_food_database',{query:this.context.foods.find(f=>f.id===id)?.n||id});
  // Every generated meal goes through an audited deterministic calculation tool.
  for(const day of plan.days)for(const meal of day.meals)await this.tool(t,'Planning','calculate_meal_nutrition',{items:meal.items});
  plan.validation=(await this.tool(t,'Guardian','validate_meal_plan',{plan})).data;if(!plan.validation.valid)fail('PLAN_INVALID',plan.validation.issues.join('；'));
  const draft=(await this.tool(t,'Planning','create_plan_draft',{plan})).data;t.agent_results.Planning=draft;if(input.base_plan||input.previous_plan)t.differences=comparePlans(input.base_plan||input.previous_plan,draft);return draft;
 }
 async run(kind,input={}){
  const t={id:ID('task'),kind,status:'pending',created_at:NOW(),updated_at:NOW(),started_ms:Date.now(),input_summary:String(input.text||kind).slice(0,120),steps:[],calls:0,result:null,agent_results:{},mode:'local_tools',validation:null,cancelled:false,requires_confirmation:false};this.tasks.set(t.id,t);this.emit(t);await new Promise(r=>setTimeout(r,0));if(t.cancelled)return t;this.transition(t,'running');
  try{if(!['nutrition','planning','metabolism','weekly','behavior','memory','semantic','simulation'].includes(kind))fail('INPUT','未知任务');safeText(String(input.text||''));
   if(this.adapter.model&&input.use_model){t.mode='model_and_tools';try{const model=await this.adapter.model({kind,input,context:this.context,task:t,callTool:(agent,name,args)=>this.tool(t,agent,name,args)});t.model_usage=model.usage||null;t.model_output=model.output||null;t.model_contribution='tool_assisted_context_only';
    if(kind==='nutrition'&&model.output?.items){schemaCheck({items:model.output.items},toolSchemas.calculate_meal_nutrition);input={...input,items:model.output.items};t.model_contribution='validated_food_items';}
    if(kind==='planning'&&model.output?.plan&&!input.base_plan){const plan=model.output.plan;plan.task_id=t.id;plan.plan_id=ID('plan');schemaCheck(plan,resultSchemas.planning);const validation=(await this.tool(t,'Guardian','validate_meal_plan',{plan})).data;if(!validation.valid)fail('PLAN_INVALID',validation.issues.join('；'));t.result=(await this.tool(t,'Planning','create_plan_draft',{plan})).data;t.model_contribution='validated_plan';this.transition(t,'needs_confirmation');return t;}
   }catch(e){if(t.cancelled||e.code==='CANCELLED')throw e;t.fallback={code:e.code||'MODEL_FAILED',message:'模型步骤未通过，已回退本地工具。具体原因：'+String(e.message||e.code||'未知错误').slice(0,220)};t.mode='local_fallback';this.emit(t);}}
   if(kind==='nutrition'){await this.nutrition(t,input);return t;}
   if(kind==='semantic'){const results=(await this.tool(t,'Nutrition','search_food_database',{query:input.text})).data;let combinations=[];if(input.constraints?.available_ids?.length>=3){const con=constraints(this.context,input.constraints);for(let i=0;i<3;i++){const m=generateMeal(this.context,con,.35,i);await this.tool(t,'Nutrition','calculate_meal_nutrition',{items:m.items});combinations.push(m);}}t.result={candidates:results,combinations,note:'仅来自本地数据库；附近商店库存、价格和购买地点未经核实。先勾选可获得食物，再生成组合。'};this.transition(t,'completed');return t;}
   if(kind==='metabolism'){t.result=await this.metabolism(t);this.transition(t,'completed');return t;}
   if(kind==='behavior'){t.result=await this.behavior(t,input.text||'');this.transition(t,'completed');return t;}
   if(kind==='memory'){t.result=(await this.tool(t,'Behavior','save_user_preference_with_confirmation',{kind:input.memory_kind||'preference',value:input.text,source:'用户在Agent中心主动输入'})).data;this.transition(t,'needs_confirmation');return t;}
   if(kind==='weekly'){const meta=await this.metabolism(t),behavior=await this.behavior(t,input.text||'');if(!input.constraints){t.result={metabolism:meta,behavior,planning:null,note:'尚未提供可获得食物与约束，复盘已完成；补充约束后可生成调整草稿。'};this.transition(t,'needs_input');return t;}const plan=await this.planning(t,input);t.result={metabolism:meta,behavior,planning:plan};this.transition(t,'needs_confirmation');return t;}
   if(kind==='simulation'){const a=await this.planning(t,input),b=await this.planning(t,{...input,constraints:{...input.constraints,...(input.hypothesis||{})},variant:1});t.result={hypothetical:true,baseline:a,alternative:b,differences:comparePlans(a,b),note:'假设模拟，未修改任何实际记录、TDEE 或已确认计划；未量化的运动变化不会被擅自换算为热量或体重变化'};this.transition(t,'needs_confirmation');return t;}
   t.result=await this.planning(t,input);this.transition(t,'needs_confirmation');return t;
  }catch(e){if(t.status==='cancelled')return t;t.error={code:e.code||'FAILED',message:e.message};t.result=e.data||t.result;this.transition(t,e.code==='CANCELLED'?'cancelled':e.code==='NEEDS_INPUT'?'needs_input':'failed');return t;}
 }
 cancel(id){const t=this.tasks.get(id);if(!t)fail('NOT_FOUND','找不到任务');if(!STATES[t.status].includes('cancelled'))fail('STATE','该任务不能取消');t.cancelled=true;this.adapter.abort?.(id);this.transition(t,'cancelled');return clone(t);}
 async confirm(id,choice,planChoice){const t=this.tasks.get(id);if(!t||t.status!=='needs_confirmation')fail('CONFIRMATION','任务当前不可确认');if(choice!==true)fail('CONFIRMATION','必须明确确认');t.confirmation={at:NOW()};t.started_ms=Date.now();
  let plan=t.result?.plan_id?t.result:t.result?.planning||t.result?.alternative;if(planChoice){if(t.kind!=='simulation'||![t.result.baseline.plan_id,t.result.alternative.plan_id].includes(planChoice))fail('CONFIRMATION','选择的方案不属于本次模拟');plan=planChoice===t.result.baseline.plan_id?t.result.baseline:t.result.alternative;}
  if(plan){t.confirmation.plan_id=plan.plan_id;const oldLimit=this.maxCalls;this.maxCalls=Math.max(oldLimit,t.calls+5);try{const v=validatePlan(this.context,plan);if(!v.valid)fail('PLAN_INVALID',v.issues.join('；'));t.confirmed_action=(await this.tool(t,'Orchestrator','apply_confirmed_plan',{plan_id:plan.plan_id})).data;}finally{this.maxCalls=oldLimit;}}
  else t.confirmed_action={type:t.kind==='memory'?'memory':'nutrition',data:clone(t.result),requires_local_commit:true};
  this.transition(t,'completed');return clone(t);
 }
}
function comparePlans(a,b){const diffs=[];for(let i=0;i<a.days.length;i++)for(const meal of a.days[i].meals){const other=b.days[i]?.meals.find(m=>m.slot===meal.slot);if(JSON.stringify(meal.items)!==JSON.stringify(other?.items))diffs.push({date:a.days[i].date,slot:meal.slot,before:meal.items,after:other?.items,cost_before:meal.cost,cost_after:other?.cost,prep_before:meal.prep_minutes,prep_after:other?.prep_minutes});}return {changed_meals:diffs.length,details:diffs,note:'成本或准备时间缺少用户输入时为null，不能据此宣称更便宜或更方便'};}
return {VERSION,Orchestrator,AgentError,STATES,AGENTS,toolSchemas,resultSchemas,taskSchema,schemaCheck,normalizeContext,nutrition,search,parseMeal,buildPlan,validatePlan,comparePlans,ID,validDate,clone};
});
