'use strict';
module.exports = function legacyEstimate(profile, context){
const TDEE_RULES={windowDays:28,minRecordedDays:12,minCompleteDays:10,minWeightPoints:6,minSpanDays:14,maxWeekly:1.2,stableWeekly:.8};
const isNum=v=>typeof v==='number'&&Number.isFinite(v),fmt=v=>String(Math.round(v)),fmt1=v=>String(Math.round(v*10)/10);
const loadWeights=()=>Object.fromEntries(context.weights.map(x=>[x.date,x.value]));
const isoDaysAgo=n=>{const d=new Date(context.today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
const dayIntakeStats=iso=>{const rows=context.diary.filter(e=>e.date===iso&&!e.aiPlan);if(!rows.length)return null;return {kcal:rows.reduce((n,e)=>n+(isNum(e.kcal)?e.kcal:0),0),complete:rows.every(e=>isNum(e.kcal)&&!(e.unknownKcal>0))};};
function computeTdeeEstimate(p){
  var days = [];
  for (var i = TDEE_RULES.windowDays - 1; i >= 0; i--) days.push(isoDaysAgo(i));
  var recorded = 0, complete = 0, completeKcalSum = 0;
  days.forEach(function(iso){
    var st = dayIntakeStats(iso);
    if (!st) return;
    recorded++;
    if (st.complete){ complete++; completeKcalSum += st.kcal; }
  });
  var weights = loadWeights();
  var points = days.map(function(iso){ return {iso: iso, w: weights[iso]}; })
    .filter(function(x){ return isNum(x.w) && x.w >= 20 && x.w <= 300; });
  var res = {
    ok: false, reason: '', initial: p.tdee,
    usedDays: recorded, completeDays: complete, weightPoints: points.length, spanDays: 0,
    avgIntake: complete ? Math.round(completeKcalSum / complete) : 0,
    weightChange: null, weeklyChange: null, tdee: null, confidence: null, reasons: [],
    from: days[0], to: days[days.length - 1]
  };
  res.spanDays = points.length > 1 ? Math.round((Date.parse(points[points.length-1].iso)-Date.parse(points[0].iso))/86400000) : 0;
  if (recorded < TDEE_RULES.minRecordedDays){ res.reason = '有效记录不足 ' + TDEE_RULES.minRecordedDays + ' 天（当前 ' + recorded + ' 天）'; return res; }
  if (complete < TDEE_RULES.minCompleteDays){ res.reason = '完整记录不足 ' + TDEE_RULES.minCompleteDays + ' 天（当前 ' + complete + ' 天）'; return res; }
  if (points.length < TDEE_RULES.minWeightPoints){ res.reason = '体重数据不足 ' + TDEE_RULES.minWeightPoints + ' 次（当前 ' + points.length + ' 次）'; return res; }
  var span = Math.round((new Date(points[points.length - 1].iso) - new Date(points[0].iso)) / 86400000);
  res.spanDays = span;
  if (span < TDEE_RULES.minSpanDays){ res.reason = '体重数据跨度不足 ' + TDEE_RULES.minSpanDays + ' 天（当前 ' + span + ' 天）'; return res; }
  var n = points.length;
  var xs = points.map(function(x){ return (new Date(x.iso) - new Date(points[0].iso)) / 86400000; });
  var ys = points.map(function(x){ return x.w; });
  var mx = xs.reduce(function(s, x){ return s + x; }, 0) / n;
  var my = ys.reduce(function(s, x){ return s + x; }, 0) / n;
  var cov = 0, varx = 0;
  for (var i = 0; i < n; i++){
    cov += (xs[i] - mx) * (ys[i] - my);
    varx += (xs[i] - mx) * (xs[i] - mx);
  }
  var slope = varx ? cov / varx : 0;
  var intercept = my - slope * mx;
  var residuals = ys.map(function(y, j){ return y - (intercept + slope * xs[j]); });
  var sd = Math.sqrt(residuals.reduce(function(s, r){ return s + r * r; }, 0) / n);
  res.weightSd = Math.round(sd * 10) / 10;
  if (sd > 3){
    res.reason = '体重波动过大（趋势残差标准差 ' + fmt1(sd) + ' kg），暂不校准';
    return res;
  }
  var change = Math.round(slope * span * 100) / 100;
  var weekly = span ? change / span * 7 : 0;
  res.weightChange = change;
  res.weeklyChange = Math.round(weekly * 100) / 100;
  res.weightTrend = slope > 0.02 ? 'up' : (slope < -0.02 ? 'down' : 'stable');
  if (Math.abs(weekly) > TDEE_RULES.maxWeekly){
    res.reason = '体重周均变化 ' + fmt1(weekly) + ' kg，波动/变化过大，暂不校准';
    return res;
  }
  var tdee = Math.round(res.avgIntake - (change * 7700 / span));
  if (!isNum(tdee) || tdee < p.bmr * 0.85 || tdee > 6000){
    res.reason = '估算结果异常（' + fmt(tdee) + ' 千卡），可能记录不完整，暂不校准';
    return res;
  }
  res.tdee = tdee;
  res.ok = true;
  res.reasons = [
    '近 ' + recorded + ' 天有记录，其中 ' + complete + ' 天热量完整',
    '体重 ' + n + ' 个点，跨度 ' + span + ' 天（趋势 ' + (res.weightTrend === 'down' ? '下降' : res.weightTrend === 'up' ? '上升' : '平稳') + '，残差标准差 ' + fmt1(sd) + ' kg）',
    '平均摄入 ' + fmt(res.avgIntake) + ' 千卡/天，体重变化 ' + (change <= 0 ? '−' : '+') + fmt1(Math.abs(change)) + ' kg'
  ];
  if (span >= 21 && complete >= 18 && points.length >= 8 && sd <= 1.5 && Math.abs(weekly) <= TDEE_RULES.stableWeekly) res.confidence = '高';
  else if (span >= 14 && complete >= 12 && points.length >= 6 && sd <= 2.5 && Math.abs(weekly) <= TDEE_RULES.maxWeekly) res.confidence = '中';
  else res.confidence = '低';
  return res;
}

return computeTdeeEstimate(profile);
};
