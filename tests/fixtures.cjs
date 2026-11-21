const foods=require('../server/foods.json');
const date='2026-11-20',ids=['rice','chicken','egg','broccoli','spinach','oil','tofu-n'];
function context(extra={}){return {today:date,foods,profile:{age:24,special:'none',bmr:1600,tdee:2400},stage:{kcal:2000,protein:110,fat:60,carb:255,bmr:1600,tdee:2400,safety_status:'ok'},diary:[],weights:[],preferences:[],...extra};}
function constraints(extra={}){return {available_ids:ids,prices:Object.fromEntries(ids.map(id=>[id,id==='chicken'?3:1])),prep_times:Object.fromEntries(ids.map(id=>[id,2])),...extra};}
function history(){const diary=[],weights=[];for(let i=0;i<22;i++){const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-i);const iso=d.toISOString().slice(0,10);diary.push({date:iso,meal:'lunch',name:'测试完整日汇总',kcal:2100,p:100,f:65,c:270,aiPlan:false});weights.push({date:iso,value:80+i*.035});}return {diary,weights};}
module.exports={context,constraints,history,foods,ids,date};
