'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const DEEPSEEK_API_KEY = String(process.env.DEEPSEEK_API_KEY || '').trim();
const DEEPSEEK_MODEL = String(process.env.DEEPSEEK_MODEL || 'deepseek-flash').trim();
const DEEPSEEK_BASE_URL = String(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
const TIMEOUT_MS = Math.max(5000, Math.min(60000, Number(process.env.AI_TIMEOUT_MS || 25000)));
const MAX_INPUT_CHARS = Math.max(1000, Math.min(30000, Number(process.env.AI_MAX_INPUT || 12000)));
const MAX_OUTPUT_TOKENS = Math.max(100, Math.min(2000, Number(process.env.AI_MAX_OUTPUT_TOKENS || 700)));
const RATE_PER_MIN = Math.max(1, Number(process.env.AI_RATE_PER_MIN || 6));
const RATE_PER_HOUR = Math.max(1, Number(process.env.AI_RATE_PER_HOUR || 30));
const DAILY_LIMIT = Math.max(1, Number(process.env.AI_DAILY_LIMIT || 200));
const ALLOWED_TASKS = new Set(['food', 'inventory', 'weight', 'weekly', 'report_followup', 'weekly_plan', 'coach', 'campus_meal']);
const HTML_FILE = path.join(__dirname, '..', 'index.html');

if (!/^https:\/\//i.test(DEEPSEEK_BASE_URL)) {
  throw new Error('DEEPSEEK_BASE_URL must be an https:// URL');
}

const rateBuckets = new Map();
let daily = { date: new Date().toISOString().slice(0, 10), count: 0 };

function now() { return Date.now(); }
function clientIp(req) {
  const trust = process.env.TRUST_PROXY === '1';
  const xf = trust ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function hitRate(ip) {
  const t = now();
  let b = rateBuckets.get(ip);
  if (!b) { b = { min: 0, hour: 0, minReset: t + 60000, hourReset: t + 3600000 }; rateBuckets.set(ip, b); }
  if (t > b.minReset) { b.min = 0; b.minReset = t + 60000; }
  if (t > b.hourReset) { b.hour = 0; b.hourReset = t + 3600000; }
  b.min++; b.hour++;
  const date = new Date().toISOString().slice(0, 10);
  if (daily.date !== date) daily = { date, count: 0 };
  daily.count++;
  if (b.min > RATE_PER_MIN) return { ok: false, code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试', retryAfter: Math.ceil((b.minReset - t) / 1000) };
  if (b.hour > RATE_PER_HOUR) return { ok: false, code: 'RATE_LIMITED', message: '本小时 AI 次数已达上限', retryAfter: Math.ceil((b.hourReset - t) / 1000) };
  if (daily.count > DAILY_LIMIT) return { ok: false, code: 'DAILY_LIMITED', message: '今日 AI 服务总量已达上限', retryAfter: 3600 };
  return { ok: true };
}
function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  }, extraHeaders || {}));
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        settled = true;
        reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      if (settled) return;
      settled = true;
      reject(e);
    });
  });
}
function str(v, max, fallback) {
  if (typeof v !== 'string') return fallback;
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
  return s ? s.slice(0, max) : fallback;
}
function num(v, min, max, fallback) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.round(n * 100) / 100;
}
function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

function sanitizeStage(v) {
  const s = obj(v); if (!s) return null;
  return {
    name: str(s.name, 24, ''),
    week: num(s.week, 0, 260, 0),
    kcal: num(s.kcal, 0, 6000, 0),
    protein: num(s.protein, 0, 500, 0),
    fat: num(s.fat, 0, 500, 0),
    carb: num(s.carb, 0, 800, 0)
  };
}
function sanitizeToday(v) {
  const s = obj(v); if (!s) return null;
  return { kcal: num(s.kcal, 0, 10000, 0), protein: num(s.protein, 0, 500, 0), fat: num(s.fat, 0, 500, 0), carb: num(s.carb, 0, 1000, 0) };
}
function sanitizeGoal(v) {
  const s = obj(v); if (!s) return null;
  return { direction: ['lose','maintain','gain'].includes(s.direction) ? s.direction : 'maintain',
    currentWeight: num(s.currentWeight, 20, 350, null), targetWeight: num(s.targetWeight, 20, 350, null), bmi: num(s.bmi, 8, 80, null) };
}
function sanitizeInventory(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 30).map((x) => {
    const o = obj(x); if (!o) return null;
    const name = str(o.name, 40, '').normalize('NFKC').trim(); if (!name) return null;
    return { name, unit: str(o.unit, 10, '份'), kcal: num(o.kcal, 0, 2000, null), protein: num(o.protein, 0, 300, null) };
  }).filter(Boolean);
}
function sanitizeWeights(v) {
  if (!Array.isArray(v)) return [];
  return v.slice(-60).map((x) => {
    const o = obj(x); if (!o) return null;
    const date = str(o.date, 10, '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const value = num(o.value, 20, 350, null);
    return value === null ? null : { date, value };
  }).filter(Boolean);
}
function sanitizeWeek(v) {
  const s = obj(v); if (!s) return null;
  return {
    label: str(s.label, 40, ''),
    recorded: num(s.recorded, 0, 7, 0),
    entries: num(s.entries, 0, 100, 0),
    avgIntake: num(s.avgIntake, 0, 10000, null),
    intakeMayBeIncomplete: s.intakeMayBeIncomplete === true,
    weightCount: num(s.weightCount, 0, 7, null),
    weightFirst: num(s.weightFirst, 20, 350, null),
    weightLast: num(s.weightLast, 20, 350, null),
    weightChange: num(s.weightChange, -20, 20, null),
    streak: num(s.streak, 0, 10000, 0),
    cheat: num(s.cheat, 0, 100, 0)
  };
}

function isRealISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const parts = s.split('-').map(Number);
  const y = parts[0], m = parts[1], d = parts[2];
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function normalizePlanDates(raw) {
  if (!Array.isArray(raw) || raw.length !== 7) {
    throw Object.assign(new Error('dates must contain exactly 7 values'), { code: 'INVALID_DATES' });
  }
  const dates = raw.map((d) => typeof d === 'string' ? d.trim() : '');
  if (dates.some((d) => !isRealISODate(d))) {
    throw Object.assign(new Error('dates must be real calendar dates'), { code: 'INVALID_DATES' });
  }
  if (new Set(dates).size !== dates.length) {
    throw Object.assign(new Error('dates must be unique'), { code: 'INVALID_DATES' });
  }
  return dates.slice().sort();
}
function normalizeFoodName(name) {
  return String(name == null ? '' : name).normalize('NFKC').replace(/[\s\u3000]+/g, '').toLowerCase();
}

function normalizeContext(task, raw) {
  const c = obj(raw); if (!c) throw Object.assign(new Error('context must be an object'), { code: 'INVALID_REQUEST' });
  if (task === 'campus_meal') {
    const invalid = () => Object.assign(new Error('invalid meal candidates'), { code: 'INVALID_REQUEST' });
    if (!['quick', 'economy', 'variety'].includes(c.preference) ||
        !Array.isArray(c.candidates) || c.candidates.length < 2 || c.candidates.length > 7) throw invalid();
    const ids = new Set();
    const candidates = c.candidates.map(item => {
      if (!item || !['chicken', 'tofu', 'fish', 'bowl', 'noodles', 'roll', 'sandwich'].includes(item.id) ||
          ids.has(item.id) || !Number.isInteger(item.price) || item.price < 1 || item.price > 100 ||
          !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 120 ||
          !Number.isInteger(item.items) || item.items < 1 || item.items > 20) throw invalid();
      ids.add(item.id);
      return { id: item.id, price: item.price, minutes: item.minutes, items: item.items };
    });
    return { preference: c.preference, candidates };
  }
  const stage = sanitizeStage(c.stage);
  const today = sanitizeToday(c.today);
  const goal = sanitizeGoal(c.goal);
  const base = { stage, today };
  if (task === 'food') {
    const question = str(c.question, 200, '');
    if (!question) throw Object.assign(new Error('question is required'), { code: 'INVALID_REQUEST' });
    return Object.assign(base, { question });
  }
  if (task === 'inventory') {
    const inventory = sanitizeInventory(c.inventory);
    if (!inventory.length) throw Object.assign(new Error('inventory is required'), { code: 'INVENTORY_REQUIRED' });
    return Object.assign(base, { inventory });
  }
  if (task === 'weight') {
    const weights = sanitizeWeights(c.weights);
    if (weights.length < 2) throw Object.assign(new Error('at least two weight records required'), { code: 'INVALID_REQUEST' });
    return { stage, goal, weights };
  }
  if (task === 'weekly') {
    const week = sanitizeWeek(c.week);
    if (!week) throw Object.assign(new Error('week is required'), { code: 'INVALID_REQUEST' });
    const focus = ['overall','nutrition','weight','adherence'].includes(c.focus) ? c.focus : 'overall';
    return { stage, week, focus };
  }
  if (task === 'report_followup') {
    const question = str(c.question, 300, '');
    const r = obj(c.report);
    if (!question || !r) throw Object.assign(new Error('report and question are required'), { code: 'INVALID_REQUEST' });
    const metrics = obj(r.metrics) || {};
    const report = {
      title: str(r.title, 60, '健康报告'),
      stage: sanitizeStage(r.stage),
      metrics: {
        bmi: num(metrics.bmi, 8, 80, null), weight: num(metrics.weight, 20, 350, null),
        target: num(metrics.target, 20, 350, null), tdee: num(metrics.tdee, 500, 8000, null),
        kcalTarget: num(metrics.kcalTarget, 0, 6000, null)
      },
      week: sanitizeWeek(r.week),
      summary: str(r.summary, 600, '')
    };
    return { question, report };
  }
  if (task === 'weekly_plan') {
    const dates = normalizePlanDates(c.dates);
    const inventory = sanitizeInventory(c.inventory);
    if (!inventory.length) throw Object.assign(new Error('inventory is required'), { code: 'INVENTORY_REQUIRED' });
    return { stage, today, inventory, dates, preference: str(c.preference, 120, '') };
  }
  if (task === 'coach') {
    const week = sanitizeWeek(c.week);
    if (!week) throw Object.assign(new Error('week is required'), { code: 'INVALID_REQUEST' });
    const weights = sanitizeWeights(c.weights);
    return { stage, goal, week, weights, memory: str(c.memory, 800, '') };
  }
  throw Object.assign(new Error('unsupported task'), { code: 'INVALID_REQUEST' });
}

function addEvidence(list, id, label, value) {
  if (value === null || value === undefined) return;
  list.push({ id, label, value });
}
function buildEvidence(task, c) {
  const ev = [];
  if (c.stage) {
    addEvidence(ev, 'stage.kcal', '每日热量目标', c.stage.kcal);
    addEvidence(ev, 'stage.protein', '蛋白质目标 g', c.stage.protein);
    addEvidence(ev, 'stage.fat', '脂肪目标 g', c.stage.fat);
    addEvidence(ev, 'stage.carb', '碳水目标 g', c.stage.carb);
  }
  if (task === 'food' && c.today) {
    addEvidence(ev, 'today.kcal', '今日已摄入千卡', c.today.kcal);
    addEvidence(ev, 'today.protein', '今日蛋白质 g', c.today.protein);
    addEvidence(ev, 'today.fat', '今日脂肪 g', c.today.fat);
    addEvidence(ev, 'today.carb', '今日碳水 g', c.today.carb);
  }
  if (task === 'inventory') {
    c.inventory.forEach((it, i) => {
      addEvidence(ev, 'inventory.' + i + '.kcal', '食材 ' + it.name + ' 热量', it.kcal);
      addEvidence(ev, 'inventory.' + i + '.protein', '食材 ' + it.name + ' 蛋白质', it.protein);
    });
  }
  if (c.goal) {
    addEvidence(ev, 'goal.currentWeight', '当前体重 kg', c.goal.currentWeight);
    addEvidence(ev, 'goal.targetWeight', '目标体重 kg', c.goal.targetWeight);
    addEvidence(ev, 'goal.bmi', 'BMI', c.goal.bmi);
  }
  if (task === 'weight') {
    c.weights.forEach((w) => {
      addEvidence(ev, 'weight.' + w.date, '体重 ' + w.date + ' kg', w.value);
      ev.push({ id: 'weight.' + w.date + '.date', label: '体重记录日期', value: w.date });
    });
  }
  if (task === 'weekly') {
    const w = c.week;
    addEvidence(ev, 'week.recorded', '记录天数', w.recorded);
    addEvidence(ev, 'week.entries', '记录条数', w.entries);
    addEvidence(ev, 'week.avgIntake', '已记录日均千卡', w.avgIntake);
    addEvidence(ev, 'week.weightCount', '体重记录次数', w.weightCount);
    addEvidence(ev, 'week.weightFirst', '本周首体重 kg', w.weightFirst);
    addEvidence(ev, 'week.weightLast', '本周末体重 kg', w.weightLast);
    addEvidence(ev, 'week.weightChange', '本周体重变化 kg', w.weightChange);
    addEvidence(ev, 'week.streak', '连续坚持天数', w.streak);
    addEvidence(ev, 'week.cheat', '放纵餐次数', w.cheat);
    (String(w.label).match(/\b20\d{2}-\d{2}-\d{2}\b/g) || []).forEach((d) => {
      ev.push({ id: 'week.date.' + d, label: '本周日期', value: d });
    });
  }
  if (task === 'report_followup') {
    const r = c.report;
    addEvidence(ev, 'report.bmi', '报告 BMI', r.metrics.bmi);
    addEvidence(ev, 'report.weight', '报告体重 kg', r.metrics.weight);
    addEvidence(ev, 'report.target', '报告目标体重 kg', r.metrics.target);
    addEvidence(ev, 'report.tdee', '报告 TDEE', r.metrics.tdee);
    addEvidence(ev, 'report.kcalTarget', '报告热量目标', r.metrics.kcalTarget);
    if (r.week) {
      addEvidence(ev, 'report.week.recorded', '报告本周记录天数', r.week.recorded);
      addEvidence(ev, 'report.week.entries', '报告本周记录条数', r.week.entries);
      addEvidence(ev, 'report.week.weightChange', '报告本周体重变化 kg', r.week.weightChange);
      (String(r.week.label).match(/\b20\d{2}-\d{2}-\d{2}\b/g) || []).forEach((d) => {
        ev.push({ id: 'report.week.date.' + d, label: '报告本周日期', value: d });
      });
    }
  }
  if (task === 'weekly_plan') {
    if (c.today) addEvidence(ev, 'today.kcal', '今日已摄入千卡', c.today.kcal);
    c.dates.forEach((d) => ev.push({ id: 'plan.date.' + d, label: '计划日期', value: d }));
    c.inventory.forEach((it, i) => {
      addEvidence(ev, 'inventory.' + i + '.kcal', '食材 ' + it.name + ' 热量', it.kcal);
      addEvidence(ev, 'inventory.' + i + '.protein', '食材 ' + it.name + ' 蛋白质', it.protein);
    });
  }
  if (task === 'coach') {
    const w = c.week;
    addEvidence(ev, 'coach.week.recorded', '本周记录天数', w.recorded);
    addEvidence(ev, 'coach.week.entries', '本周记录条数', w.entries);
    addEvidence(ev, 'coach.week.avgIntake', '本周已记录日均千卡', w.avgIntake);
    addEvidence(ev, 'coach.week.weightCount', '本周体重记录次数', w.weightCount);
    addEvidence(ev, 'coach.week.weightChange', '本周体重变化 kg', w.weightChange);
    addEvidence(ev, 'coach.week.streak', '连续坚持天数', w.streak);
    c.weights.slice(-30).forEach((x) => {
      addEvidence(ev, 'coach.weight.' + x.date, '体重 ' + x.date + ' kg', x.value);
      ev.push({ id: 'coach.weight.' + x.date + '.date', label: '体重日期', value: x.date });
    });
  }
  return ev;
}

const SCHEMAS = {
  food: `{"task":"food","verdict":"allow|caution|avoid|insufficient","summary":"不超过300字","facts":[{"text":"事实，必须引用 refs","refs":["stage.kcal"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`,
  inventory: `{"task":"inventory","summary":"不超过300字","meals":[{"slot":"早餐|午餐|晚餐|加餐","items":[{"name":"食材名","amount":"份量","unit":"g|份"}],"kcal":0}],"facts":[{"text":"事实，必须引用 refs","refs":["inventory.0.kcal"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`,
  weight: `{"task":"weight","summary":"不超过300字","trend":"up|down|stable","facts":[{"text":"事实，必须引用 refs","refs":["weight.2026-01-01"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`,
  weekly: `{"task":"weekly","summary":"不超过300字","highlights":["本周亮点"],"focus_response":"针对用户侧重点的回应","facts":[{"text":"事实，必须引用 refs","refs":["week.recorded"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`,
  report_followup: `{"task":"report_followup","answer":"不超过400字，回答追问","facts":[{"text":"事实，必须引用 refs","refs":["report.bmi"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`,
  weekly_plan: `{"task":"weekly_plan","summary":"不超过300字","days":[{"date":"YYYY-MM-DD","meals":[{"slot":"早餐|午餐|晚餐|加餐","items":[{"name":"食材名","amount":"份量","unit":"g|份","kcal":0}],"kcal":0}]}],"facts":[{"text":"事实，必须引用 refs","refs":["stage.kcal"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`,
  coach: `{"task":"coach","summary":"不超过300字","observations":["观察"],"adjustments":["下周调整"],"next_focus":"下一周重点","facts":[{"text":"事实，必须引用 refs","refs":["coach.week.recorded"]}],"inferences":["推测"],"suggestions":["建议"],"limitations":["数据局限"]}`
};

function buildPrompt(task, c, ev) {
  if (task === 'campus_meal') {
    return {
      system: '从已通过预算和渠道筛选的候选中选一个。quick 优先看 minutes 小，economy 优先看 price 小，variety 优先看 items 大。以偏好为主要权重，再考虑其他两项的取舍。只输出 JSON，格式为 {"choice":"候选 ID"}。不可编造 ID，不输出其他字段。',
      user: JSON.stringify(c)
    };
  }
  const schema = SCHEMAS[task];
  const inventoryRule = (task === 'inventory' || task === 'weekly_plan')
    ? '\n7. 该任务只能使用 TASK_CONTEXT.inventory 中列出的食材；meals/items 的 name 必须与库存名称完全对应（允许统一空白/大小写），不得添加库存外食材。额外建议只能写在 suggestions，不得写进 meals/items。'
    : '';
  const coverageRule = (task === 'weekly' || task === 'coach')
    ? '\n补充：avgIntake 仅代表已记录日均；若 intakeMayBeIncomplete 为 true，在 limitations 明示可能低估。体重首末差只是两次读数的差值；缺少完整趋势证据时，勿推断体脂变化或据此要求改变热量目标。'
    : '';
  return {
    system: `你是健康管家中的营养与体重管理解释助手。只输出一个 JSON 对象，不要 Markdown、代码块或额外文字。\n必须遵守：\n1. 只能依据 TASK_CONTEXT 和 EVIDENCE 中的数据；不要编造日期、体重、热量、营养数值或记录。\n2. facts 中每条事实必须带 refs，refs 只能使用 EVIDENCE 中存在的 id；facts 中出现的带单位数值和日期必须由该条 facts 的 refs 支持。\n3. facts、inferences、suggestions、limitations 必须分开；推测不是事实。\n4. 数据不足时使用 limitations，并给出保守建议；不要下医学诊断。\n5. 输出必须符合此 JSON 结构：${schema}\n6. 语言使用简体中文，简洁、具体、可执行。${inventoryRule}${coverageRule}`,
    user: 'TASK: ' + task + '\nTASK_CONTEXT:\n' + JSON.stringify(c) + '\nEVIDENCE:\n' + JSON.stringify(ev) + '\n请只输出 JSON。'
  };
}

function datesIn(text) {
  return String(text).match(/\b20\d{2}-\d{2}-\d{2}\b/g) || [];
}
function numbersWithUnits(text) {
  const out = [];
  const re = /(-?\d+(?:\.\d+)?)\s*(kg|公斤|千卡|kcal|g|克|cm|厘米|%|天|周)/gi;
  let m;
  while ((m = re.exec(String(text))) !== null) out.push(Number(m[1]));
  return out;
}
function textList(v, maxItems, maxLen) {
  if (!Array.isArray(v)) return [];
  return v.slice(0, maxItems).map((x) => str(x, maxLen, '')).filter(Boolean);
}
function refSupportsDate(ref, date) {
  if (!ref) return false;
  if (ref.value === date) return true;
  return datesIn(ref.id).includes(date) || datesIn(ref.label).includes(date);
}
function validateFactList(v, ev) {
  if (!Array.isArray(v)) return { ok: false, reason: 'facts must be array', code: 'FACT_INVALID' };
  if (v.length > 6) return { ok: false, reason: 'too many facts', code: 'FACT_INVALID' };
  const byId = new Map(ev.map((x) => [x.id, x]));
  const out = [];
  for (const item of v) {
    const o = obj(item); if (!o) return { ok: false, reason: 'fact must be object', code: 'FACT_INVALID' };
    const text = str(o.text, 300, '');
    if (!text) return { ok: false, reason: 'empty fact', code: 'FACT_INVALID' };
    if (!Array.isArray(o.refs) || !o.refs.length || o.refs.length > 4) return { ok: false, reason: 'fact refs required', code: 'FACT_REFS' };
    const refs = o.refs.map((x) => str(x, 60, '')).filter(Boolean);
    if (refs.length !== o.refs.length || refs.some((x) => !byId.has(x))) return { ok: false, reason: 'unknown fact ref', code: 'FACT_REFS' };

    const refItems = refs.map((id) => byId.get(id));
    const allowedNumbers = refItems.filter((r) => typeof r.value === 'number' && Number.isFinite(r.value)).map((r) => r.value);
    const factDates = datesIn(text);
    if (factDates.some((d) => !refItems.some((r) => refSupportsDate(r, d)))) {
      return { ok: false, reason: 'date not supported by refs', code: 'FACT_DATE' };
    }
    for (const n of numbersWithUnits(text)) {
      if (!allowedNumbers.some((x) => Math.abs(x - n) <= 0.51)) {
        return { ok: false, reason: 'number not supported by refs', code: 'FACT_NUMBER' };
      }
    }
    /* 自然语言中的数学/因果无法完整验证；这里只拒绝明确的推测措辞进入 facts。 */
    if (/(可能|也许|大概|推测|预计|似乎|或许|应该会|可能是因为)/.test(text)) {
      return { ok: false, reason: 'speculation in facts', code: 'FACT_SPECULATION' };
    }
    out.push({ text, refs });
  }
  return { ok: true, value: out };
}

function validateInventoryUsage(task, result, context) {
  if (!['inventory', 'weekly_plan'].includes(task)) return { ok: true };
  if (context === undefined) return { ok: true }; // legacy/unit callers that only validate shape
  const inventory = context && Array.isArray(context.inventory) ? context.inventory : [];
  if (!inventory.length) return { ok: false, reason: 'inventory empty', code: 'INVENTORY_EMPTY' };
  const allowed = new Set(inventory.map((x) => normalizeFoodName(x.name)));
  const items = [];
  if (task === 'inventory') {
    (result.meals || []).forEach((m) => (m.items || []).forEach((it) => items.push(it)));
  } else {
    (result.days || []).forEach((d) => (d.meals || []).forEach((m) => (m.items || []).forEach((it) => items.push(it))));
  }
  for (const item of items) {
    if (!allowed.has(normalizeFoodName(item.name))) {
      return { ok: false, reason: 'item not in inventory', code: 'INVENTORY_MISMATCH' };
    }
  }
  return { ok: true };
}


function validateModelResult(task, raw, ev, context) {
  const o = obj(raw); if (!o) return { ok: false, reason: 'not object', code: 'AI_FORMAT' };
  if (o.task && o.task !== task) return { ok: false, reason: 'task mismatch', code: 'AI_FORMAT' };
  if (task === 'campus_meal') {
    if (!context.candidates.some(item => item.id === o.choice)) {
      return { ok: false, code: 'MEAL_CHOICE_INVALID', reason: 'choice outside approved candidates' };
    }
    return { ok: true, value: { task, choice: o.choice, summary: '已从候选中排序。', facts: [] } };
  }
  const result = { task, summary: str(o.summary, 800, '') };
  if (!result.summary) return { ok: false, reason: 'summary required', code: 'AI_FORMAT' };
  const facts = validateFactList(o.facts, ev);
  if (!facts.ok) return facts;
  result.facts = facts.value;
  result.inferences = textList(o.inferences, 5, 300);
  result.suggestions = textList(o.suggestions, 5, 300);
  result.limitations = textList(o.limitations, 5, 300);
  if (!result.limitations.length) result.limitations = ['结果基于当前有限记录，不能替代专业评估。'];
  if (task === 'food') {
    if (!['allow','caution','avoid','insufficient'].includes(o.verdict)) return { ok: false, reason: 'bad verdict' };
    result.verdict = o.verdict;
  }
  if (task === 'inventory') {
    if (!Array.isArray(o.meals) || !o.meals.length || o.meals.length > 4) return { ok: false, reason: 'meals required' };
    result.meals = [];
    for (const m of o.meals) {
      const mo = obj(m); if (!mo) return { ok: false, reason: 'bad meal' };
      const slot = str(mo.slot, 10, ''); if (!slot || !Array.isArray(mo.items) || !mo.items.length || mo.items.length > 8) return { ok: false, reason: 'bad meal items' };
      const items = mo.items.map((it) => {
        const io = obj(it); if (!io) return null;
        const name = str(io.name, 40, ''); if (!name) return null;
        return { name, amount: str(io.amount, 20, ''), unit: str(io.unit, 10, '') };
      }).filter(Boolean);
      if (!items.length) return { ok: false, reason: 'empty meal' };
      result.meals.push({ slot, items, kcal: num(mo.kcal, 0, 3000, null) });
    }
  }
  if (task === 'weight') {
    if (!['up','down','stable'].includes(o.trend)) return { ok: false, reason: 'bad trend' };
    result.trend = o.trend;
  }
  if (task === 'weekly') {
    result.highlights = textList(o.highlights, 4, 200);
    result.focus_response = str(o.focus_response, 600, '');
    if (!result.highlights.length) return { ok: false, reason: 'highlights required' };
  }
  if (task === 'report_followup') {
    result.answer = str(o.answer, 800, '');
    if (!result.answer) return { ok: false, reason: 'answer required' };
  }
  if (task === 'weekly_plan') {
    if (!Array.isArray(o.days) || o.days.length !== 7) return { ok: false, reason: 'seven days required', code: 'PLAN_DATE_COUNT' };
    const expectedDates = ev.filter((x) => String(x.id).startsWith('plan.date.')).map((x) => String(x.value)).sort();
    const seen = new Set();
    result.days = [];
    for (const day of o.days) {
      const d = obj(day); if (!d) return { ok: false, reason: 'bad day', code: 'PLAN_FORMAT' };
      const date = str(d.date, 10, '');
      if (!isRealISODate(date) || !expectedDates.includes(date)) return { ok: false, reason: 'unknown plan date', code: 'PLAN_DATE_UNKNOWN' };
      if (seen.has(date)) return { ok: false, reason: 'duplicate plan date', code: 'PLAN_DATE_DUPLICATE' };
      seen.add(date);
      if (!Array.isArray(d.meals) || !d.meals.length || d.meals.length > 4) return { ok: false, reason: 'bad day meals', code: 'PLAN_FORMAT' };
      const meals = [];
      for (const meal of d.meals) {
        const mo = obj(meal); if (!mo) return { ok: false, reason: 'bad plan meal', code: 'PLAN_FORMAT' };
        const slot = str(mo.slot, 10, ''); if (!slot) return { ok: false, reason: 'bad slot', code: 'PLAN_FORMAT' };
        if (!Array.isArray(mo.items) || !mo.items.length || mo.items.length > 8) return { ok: false, reason: 'bad plan items', code: 'PLAN_FORMAT' };
        const items = mo.items.map((it) => {
          const io = obj(it); if (!io) return null;
          const name = str(io.name, 40, ''); if (!name) return null;
          return { name, amount: str(io.amount, 20, ''), unit: str(io.unit, 10, ''), kcal: num(io.kcal, 0, 3000, null) };
        }).filter(Boolean);
        if (!items.length) return { ok: false, reason: 'empty plan meal', code: 'PLAN_FORMAT' };
        meals.push({ slot, items, kcal: num(mo.kcal, 0, 5000, null) });
      }
      result.days.push({ date, meals });
    }
    if (seen.size !== 7 || expectedDates.length !== 7 || expectedDates.some((d) => !seen.has(d))) {
      return { ok: false, reason: 'plan dates must exactly match request', code: 'PLAN_DATE_MISMATCH' };
    }
    result.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (task === 'coach') {
    result.observations = textList(o.observations, 5, 300);
    result.adjustments = textList(o.adjustments, 5, 300);
    result.next_focus = str(o.next_focus, 300, '');
    if (!result.observations.length || !result.adjustments.length || !result.next_focus) return { ok: false, reason: 'coach fields required', code: 'PLAN_FORMAT' };
  }
  const inv = validateInventoryUsage(task, result, context);
  if (!inv.ok) return inv;
  return { ok: true, value: result };
}

async function callDeepSeek(task, context, onDelta) {
  if (!DEEPSEEK_API_KEY) return { ok: false, status: 503, code: 'AI_NOT_CONFIGURED', message: '云端 AI 未配置，已使用本地分析' };
  const ev = buildEvidence(task, context);
  const p = buildPrompt(task, context, ev);
  const maxTokens = task === 'weekly_plan'
    ? Math.min(1800, Math.max(MAX_OUTPUT_TOKENS, 1500))
    : MAX_OUTPUT_TOKENS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(DEEPSEEK_BASE_URL + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + DEEPSEEK_API_KEY },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }],
        response_format: { type: 'json_object' },
        thinking: { type: process.env.AI_THINKING === 'enabled' ? 'enabled' : 'disabled' },
        max_tokens: maxTokens,
        temperature: 0.2,
        stream: !!onDelta
      }),
      signal: ctrl.signal
    });
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) return { ok: false, status: 502, code: 'AI_AUTH', message: 'AI 服务鉴权失败' };
      if (resp.status === 429) return { ok: false, status: 429, code: 'AI_QUOTA', message: 'AI 服务额度或频率受限' };
      return { ok: false, status: 502, code: 'AI_UPSTREAM', message: 'AI 服务暂时不可用' };
    }
    let data = {}, content = '';
    if (onDelta) {
      const decoder = new TextDecoder();
      let pending = '';
      const consume = line => {
        if (!line.startsWith('data:')) return;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        const event = JSON.parse(payload);
        const delta = event.choices?.[0]?.delta?.content;
        if (typeof delta === 'string') { content += delta; onDelta(delta); }
        if (event.usage) data.usage = event.usage;
      };
      for await (const chunk of resp.body) {
        pending += decoder.decode(chunk, {stream:true});
        const lines = pending.split('\n'); pending = lines.pop();
        lines.forEach(consume);
      }
      pending += decoder.decode();
      if (pending.trim()) consume(pending);
    } else {
      try { data = await resp.json(); } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        return { ok:false, status:502, code:'AI_FORMAT', message:'AI 返回格式不合格，已切换本地分析' };
      }
      content = data?.choices?.[0]?.message?.content;
    }
    if (typeof content !== 'string' || !content.trim()) return { ok: false, status: 502, code: 'AI_EMPTY', message: 'AI 返回为空，已切换本地分析' };
    let parsed;
    try { parsed = JSON.parse(content); } catch (e) { return { ok: false, status: 502, code: 'AI_FORMAT', message: 'AI 返回格式不合格，已切换本地分析' }; }
    const checked = validateModelResult(task, parsed, ev, context);
    if (!checked.ok) {
      const code = checked.code || 'AI_FORMAT';
      const messages = {
        INVENTORY_EMPTY: 'AI 未获得可用库存，已切换本地分析',
        INVENTORY_MISMATCH: 'AI 使用了库存外食材，已切换本地分析',
        PLAN_DATE_COUNT: 'AI 返回的日期数量不正确，已切换本地分析',
        PLAN_DATE_DUPLICATE: 'AI 返回了重复日期，已切换本地分析',
        PLAN_DATE_UNKNOWN: 'AI 返回了请求外的日期，已切换本地分析',
        PLAN_DATE_MISMATCH: 'AI 返回的日期与请求不一致，已切换本地分析',
        FACT_REFS: 'AI 事实引用无效，已切换本地分析',
        FACT_DATE: 'AI 事实日期无引用支持，已切换本地分析',
        FACT_NUMBER: 'AI 事实数值无引用支持，已切换本地分析',
        FACT_SPECULATION: 'AI 把推测写成了事实，已切换本地分析'
      };
      return { ok: false, status: 502, code, message: messages[code] || 'AI 返回未通过本地校验，已切换本地分析' };
    }
    return { ok: true, data: checked.value, evidence: ev.filter(e => checked.value.facts.some(f => f.refs.includes(e.id))), meta: { model: DEEPSEEK_MODEL, usage: data.usage ? { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens } : null } };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, status: 504, code: 'AI_TIMEOUT', message: 'AI 服务超时，已切换本地分析' };
    return { ok: false, status: 502, code: 'AI_NETWORK', message: 'AI 网络请求失败，已切换本地分析' };
  } finally {
    clearTimeout(timer);
  }
}

function securityHeaders() {
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store'
  };
}
function serveHtml(req, res, download) {
  fs.readFile(HTML_FILE, (err, data) => {
    if (err) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Frontend file not found'); return; }
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, securityHeaders(), download ? {'Content-Disposition':'attachment; filename="health-manager.html"'} : {}));
    res.end(data);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (await require('./agent-router').route(req,res,url)) return;
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) { serveHtml(req, res); return; }
    if (req.method === 'GET' && url.pathname === '/health-manager.html') { serveHtml(req, res, true); return; }
    if (req.method === 'GET' && url.pathname === '/api/ai/health') {
      sendJson(res, 200, { ok: true, aiConfigured: !!DEEPSEEK_API_KEY, model: DEEPSEEK_MODEL, limits: { perMinute: RATE_PER_MIN, perHour: RATE_PER_HOUR, maxInputChars: MAX_INPUT_CHARS, maxOutputTokens: MAX_OUTPUT_TOKENS } });
      return;
    }
    if (url.pathname === '/api/ai') {
      if (req.method !== 'POST') { sendJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', message: 'POST only' }); return; }
      const ip = clientIp(req);
      const rate = hitRate(ip);
      if (!rate.ok) { sendJson(res, 429, rate, rate.retryAfter ? { 'Retry-After': String(rate.retryAfter) } : undefined); return; }
      let bodyText;
      try { bodyText = await readBody(req, 24 * 1024); } catch (e) { sendJson(res, 413, { ok: false, code: 'BODY_TOO_LARGE', message: '请求体过大' }); return; }
      let body;
      try { body = JSON.parse(bodyText); } catch (e) { sendJson(res, 400, { ok: false, code: 'INVALID_JSON', message: '请求格式错误' }); return; }
      const task = str(body.task, 30, '');
      if (!ALLOWED_TASKS.has(task)) { sendJson(res, 400, { ok: false, code: 'INVALID_TASK', message: '任务类型无效' }); return; }
      let context;
      try { context = normalizeContext(task, body.context); } catch (e) {
        const code = e.code || 'INVALID_REQUEST';
        const messages = {
          INVALID_DATES: '日期必须为 7 个不同的真实日期',
          INVENTORY_REQUIRED: '库存不能为空'
        };
        sendJson(res, 400, { ok: false, code, message: messages[code] || '请求参数无效' });
        return;
      }
      const serialized = JSON.stringify(context);
      if (serialized.length > MAX_INPUT_CHARS) { sendJson(res, 413, { ok: false, code: 'INPUT_TOO_LARGE', message: '输入数据过多，请缩短记录范围' }); return; }
      if (body.stream === true) {
        res.writeHead(200, {...securityHeaders(), 'Content-Type':'application/x-ndjson; charset=utf-8', 'Cache-Control':'no-store', 'X-Accel-Buffering':'no'});
        res.flushHeaders();
        const write = obj => { if (!res.destroyed) res.write(JSON.stringify(obj)+'\n'); };
        const result = await callDeepSeek(task, context, text => write({type:'delta',text}));
        write({type:'result',result});
        res.end(); return;
      }
      const result = await callDeepSeek(task, context);
      if (!result.ok) { sendJson(res, result.status || 502, { ok: false, code: result.code, message: result.message }); return; }
      sendJson(res, 200, { ok: true, data: result.data, evidence: result.evidence, meta: result.meta });
      return;
    }
    sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: 'Not found' });
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log('Health Manager AI proxy: http://' + HOST + ':' + PORT);
    console.log('AI configured: ' + (DEEPSEEK_API_KEY ? 'yes' : 'no') + '; model: ' + DEEPSEEK_MODEL);
  });
}

module.exports = { createServer, normalizeContext, buildEvidence, validateModelResult, buildPrompt, callDeepSeek, _internal: { num, str, hitRate } };
