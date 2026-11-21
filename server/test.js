'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeContext, buildEvidence, buildPrompt, validateModelResult, createServer } = require('./server.js');

const stage = { name: '减脂期', week: 3, kcal: 1800, protein: 120, fat: 55, carb: 180 };
const today = { kcal: 900, protein: 60, fat: 25, carb: 90 };

test('food context is minimized and validated', () => {
  const c = normalizeContext('food', { question: '减脂期能吃火鸡面吗', stage, today, sex: 'male', age: 30, name: '不应发送' });
  assert.equal(c.question, '减脂期能吃火鸡面吗');
  assert.equal(c.stage.kcal, 1800);
  assert.equal(c.sex, undefined);
  assert.equal(c.age, undefined);
  assert.equal(c.name, undefined);
  assert.throws(() => normalizeContext('food', { stage }), /question/);
});

test('food result requires evidence refs and known numbers', () => {
  const c = normalizeContext('food', { question: '能吃吗', stage, today });
  const ev = buildEvidence('food', c);
  const valid = {
    task: 'food', verdict: 'caution', summary: '需要控制份量。',
    facts: [{ text: '今日已摄入 900 千卡', refs: ['today.kcal'] }],
    inferences: ['可能影响今日缺口'], suggestions: ['减少份量'], limitations: ['仅依据今日汇总']
  };
  assert.equal(validateModelResult('food', valid, ev).ok, true);
  const badNumber = Object.assign({}, valid, { facts: [{ text: '今日已摄入 700 千卡', refs: ['today.kcal'] }] });
  assert.equal(validateModelResult('food', badNumber, ev).ok, false);
  const badRef = Object.assign({}, valid, { facts: [{ text: '今日已摄入 900 千卡', refs: ['today.nope'] }] });
  assert.equal(validateModelResult('food', badRef, ev).ok, false);
  const noRef = Object.assign({}, valid, { facts: [{ text: '今日已摄入 900 千卡', refs: [] }] });
  assert.equal(validateModelResult('food', noRef, ev).ok, false);
});

test('weight result validates dates and numbers', () => {
  const c = normalizeContext('weight', {
    stage,
    goal: { direction: 'lose', currentWeight: 80, targetWeight: 75, bmi: 25.2 },
    weights: [{ date: '2026-01-01', value: 80 }, { date: '2026-01-08', value: 79 }]
  });
  const ev = buildEvidence('weight', c);
  const valid = {
    task: 'weight', trend: 'down', summary: '体重下降 1 kg。',
    facts: [{ text: '2026-01-01 体重 80 kg', refs: ['weight.2026-01-01'] }],
    inferences: [], suggestions: ['继续保持'], limitations: ['记录时间较短']
  };
  assert.equal(validateModelResult('weight', valid, ev).ok, true);
  const badDate = Object.assign({}, valid, { facts: [{ text: '2025-12-01 体重 80 kg', refs: ['weight.2026-01-01'] }] });
  assert.equal(validateModelResult('weight', badDate, ev).ok, false);
  const badNumber = Object.assign({}, valid, { facts: [{ text: '2026-01-01 体重 77 kg', refs: ['weight.2026-01-01'] }] });
  assert.equal(validateModelResult('weight', badNumber, ev).ok, false);
});

test('inventory result validates meal structure', () => {
  const c = normalizeContext('inventory', { stage, today, inventory: [{ name: '鸡胸肉', unit: 'g', kcal: 165, protein: 31 }] });
  const ev = buildEvidence('inventory', c);
  const valid = {
    task: 'inventory', summary: '用现有食材搭配。',
    meals: [{ slot: '午餐', items: [{ name: '鸡胸肉', amount: '100', unit: 'g' }], kcal: 165 }],
    facts: [{ text: '鸡胸肉热量 165 千卡', refs: ['inventory.0.kcal'] }],
    inferences: [], suggestions: [], limitations: []
  };
  assert.equal(validateModelResult('inventory', valid, ev).ok, true);
  const bad = Object.assign({}, valid, { meals: [] });
  assert.equal(validateModelResult('inventory', bad, ev).ok, false);
});

test('weekly result requires highlights and focus response', () => {
  const c = normalizeContext('weekly', {
    stage, focus: 'nutrition',
    week: { label: '2026-01-01 ~ 2026-01-07', recorded: 5, entries: 12, avgIntake: 1700, weightFirst: 80, weightLast: 79, weightChange: -1, streak: 5, cheat: 1 }
  });
  const ev = buildEvidence('weekly', c);
  const valid = {
    task: 'weekly', summary: '本周整体稳定。', highlights: ['记录了 5 天'],
    focus_response: '营养方面，已知日均摄入 1700 千卡。',
    facts: [{ text: '本周记录 5 天', refs: ['week.recorded'] }],
    inferences: [], suggestions: ['保持记录'], limitations: ['有记录缺失']
  };
  assert.equal(validateModelResult('weekly', valid, ev).ok, true);
  assert.equal(validateModelResult('weekly', Object.assign({}, valid, { highlights: [] }), ev).ok, false);
});

test('missing facts and invalid verdict are rejected', () => {
  const c = normalizeContext('food', { question: '能吃吗', stage, today });
  const ev = buildEvidence('food', c);
  assert.equal(validateModelResult('food', { summary: 'x', verdict: 'allow' }, ev).ok, false);
  assert.equal(validateModelResult('food', { summary: 'x', verdict: 'maybe', facts: [] }, ev).ok, false);
});

test('prompt contains evidence and JSON instruction', () => {
  const c = normalizeContext('weight', {
    stage, goal: { direction: 'lose', currentWeight: 80, targetWeight: 75, bmi: 25 },
    weights: [{ date: '2026-01-01', value: 80 }, { date: '2026-01-08', value: 79 }]
  });
  const p = buildPrompt('weight', c, buildEvidence('weight', c));
  assert.match(p.system, /JSON/);
  assert.match(p.user, /EVIDENCE/);
  assert.doesNotMatch(p.user, /sex|年龄|姓名/);
});

test('http serves frontend with security headers', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/');
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /健康管家/);
    assert.match(html, /今天的健康圆环/);
    assert.match(html, /id="quickMealForm"/);
    assert.match(html, /AI 一周饮食计划/);
    assert.match(html, /btnWeekPlan/);
    assert.match(html, /id="btnVoiceDrink"/);
    assert.match(r.headers.get('content-security-policy') || '', /connect-src 'self'/);
    assert.match(r.headers.get('cache-control') || '', /no-store/);
    const download = await fetch('http://127.0.0.1:' + port + '/health-manager.html');
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') || '', /attachment; filename="health-manager.html"/);
    assert.equal(await download.text(), html);
    assert.equal((html.match(/\bsk-[A-Za-z0-9]{16,}\b/g) || []).length, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('weekly plan validates seven dates and meals', () => {
  const dates = ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07'];
  const c = normalizeContext('weekly_plan', { stage, today, dates, inventory: [{ name: '鸡胸肉', unit: 'g', kcal: 165, protein: 31 }] });
  const ev = buildEvidence('weekly_plan', c);
  const valid = {
    task: 'weekly_plan', summary: '一周计划。',
    days: dates.map((date) => ({ date, meals: [{ slot: '午餐', items: [{ name: '鸡胸肉', amount: '100', unit: 'g', kcal: 165 }], kcal: 165 }] })),
    facts: [{ text: '每日热量目标 1800 千卡', refs: ['stage.kcal'] }],
    inferences: [], suggestions: ['按计划执行'], limitations: ['需要按实际食材调整']
  };
  assert.equal(validateModelResult('weekly_plan', valid, ev).ok, true);
  const badDate = JSON.parse(JSON.stringify(valid)); badDate.days[0].date = '2026-02-01';
  assert.equal(validateModelResult('weekly_plan', badDate, ev).ok, false);
  const badDays = Object.assign({}, valid, { days: valid.days.slice(0, 6) });
  assert.equal(validateModelResult('weekly_plan', badDays, ev).ok, false);
});

test('coach validates observations, adjustments and focus', () => {
  const c = normalizeContext('coach', {
    stage,
    goal: { direction: 'lose', currentWeight: 80, targetWeight: 75, bmi: 25 },
    week: { label: '2026-01-01 ~ 2026-01-07', recorded: 5, entries: 12, avgIntake: 1700, weightChange: -1, streak: 5, cheat: 0 },
    weights: [{ date: '2026-01-01', value: 80 }, { date: '2026-01-07', value: 79 }],
    memory: '上次重点：晚餐蛋白质'
  });
  const ev = buildEvidence('coach', c);
  const valid = {
    task: 'coach', summary: '本周整体稳定。',
    observations: ['记录了 5 天'], adjustments: ['晚餐增加蛋白质'], next_focus: '保持记录',
    facts: [{ text: '本周记录 5 天', refs: ['coach.week.recorded'] }],
    inferences: [], suggestions: ['继续保持'], limitations: ['有两天未记录']
  };
  assert.equal(validateModelResult('coach', valid, ev).ok, true);
  assert.equal(validateModelResult('coach', Object.assign({}, valid, { next_focus: '' }), ev).ok, false);
});

test('http health and no-key fallback', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  try {
    const health = await fetch(base + '/api/ai/health');
    assert.equal(health.status, 200);
    const hd = await health.json();
    assert.equal(hd.ok, true);
    assert.equal(typeof hd.aiConfigured, 'boolean');
    const r = await fetch(base + '/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'food', context: { question: '能吃吗', stage, today } })
    });
    assert.equal(r.status, 503);
    const d = await r.json();
    assert.equal(d.code, 'AI_NOT_CONFIGURED');
    assert.equal(Object.prototype.hasOwnProperty.call(d, 'err'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('http rejects bad task and oversized body', async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;
  try {
    const bad = await fetch(base + '/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'unknown', context: {} })
    });
    assert.equal(bad.status, 400);
    const big = await fetch(base + '/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'food', context: { question: 'x'.repeat(30000) } })
    });
    assert.ok([400, 413].includes(big.status));

    const badDate = await fetch(base + '/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'weekly_plan', context: {
        stage, today, inventory: [{ name: '鸡胸肉', unit: 'g', kcal: 165, protein: 31 }],
        dates: ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-02-30']
      } })
    });
    assert.equal(badDate.status, 400);
    assert.equal((await badDate.json()).code, 'INVALID_DATES');

    const emptyInv = await fetch(base + '/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'inventory', context: { stage, today, inventory: [] } })
    });
    assert.equal(emptyInv.status, 400);
    assert.equal((await emptyInv.json()).code, 'INVENTORY_REQUIRED');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* ==================== 新增：日期 / 库存 / 事实引用 ==================== */

const planDates = ['2026-01-01','2026-01-02','2026-01-03','2026-01-04','2026-01-05','2026-01-06','2026-01-07'];
const planInventory = [{ name: '鸡胸肉', unit: 'g', kcal: 165, protein: 31 }];

test('plan input accepts 7 valid dates and sorts them', () => {
  const c = normalizeContext('weekly_plan', { stage, today, dates: planDates.slice().reverse(), inventory: planInventory });
  assert.deepEqual(c.dates, planDates);
});

test('plan input rejects duplicate dates', () => {
  const dates = planDates.slice(); dates[6] = dates[0];
  assert.throws(() => normalizeContext('weekly_plan', { stage, today, dates, inventory: planInventory }), (e) => e.code === 'INVALID_DATES');
});

test('plan input rejects invalid calendar dates', () => {
  const dates = planDates.slice(); dates[2] = '2026-02-30';
  assert.throws(() => normalizeContext('weekly_plan', { stage, today, dates, inventory: planInventory }), (e) => e.code === 'INVALID_DATES');
});

test('plan input rejects missing dates', () => {
  assert.throws(() => normalizeContext('weekly_plan', { stage, today, dates: planDates.slice(0, 6), inventory: planInventory }), (e) => e.code === 'INVALID_DATES');
});

test('plan output rejects duplicate, missing or extra dates', () => {
  const c = normalizeContext('weekly_plan', { stage, today, dates: planDates, inventory: planInventory });
  const ev = buildEvidence('weekly_plan', c);
  const valid = {
    task: 'weekly_plan', summary: '一周计划。',
    days: planDates.map((date) => ({ date, meals: [{ slot: '午餐', items: [{ name: '鸡胸肉', amount: '100', unit: 'g', kcal: 165 }], kcal: 165 }] })),
    facts: [{ text: '每日热量目标 1800 千卡', refs: ['stage.kcal'] }],
    inferences: [], suggestions: ['按计划执行'], limitations: ['需要按实际食材调整']
  };
  assert.equal(validateModelResult('weekly_plan', valid, ev, c).ok, true);
  const duplicate = JSON.parse(JSON.stringify(valid)); duplicate.days[1].date = duplicate.days[0].date;
  assert.equal(validateModelResult('weekly_plan', duplicate, ev, c).code, 'PLAN_DATE_DUPLICATE');
  const missing = JSON.parse(JSON.stringify(valid)); missing.days.pop();
  assert.equal(validateModelResult('weekly_plan', missing, ev, c).code, 'PLAN_DATE_COUNT');
  const extra = JSON.parse(JSON.stringify(valid)); extra.days[0].date = '2026-02-01';
  assert.equal(validateModelResult('weekly_plan', extra, ev, c).ok, false);
  const reversed = JSON.parse(JSON.stringify(valid)); reversed.days.reverse();
  const checked = validateModelResult('weekly_plan', reversed, ev, c);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value.days.map((d) => d.date), planDates);
});

test('inventory result must use only exact inventory names', () => {
  const c = normalizeContext('inventory', { stage, today, inventory: planInventory });
  const ev = buildEvidence('inventory', c);
  const valid = {
    task: 'inventory', summary: '用现有食材搭配。',
    meals: [{ slot: '午餐', items: [{ name: '鸡胸肉', amount: '100', unit: 'g' }], kcal: 165 }],
    facts: [{ text: '鸡胸肉热量 165 千卡', refs: ['inventory.0.kcal'] }],
    inferences: [], suggestions: [], limitations: []
  };
  assert.equal(validateModelResult('inventory', valid, ev, c).ok, true);
  const extra = JSON.parse(JSON.stringify(valid)); extra.meals[0].items[0].name = '牛肉';
  assert.equal(validateModelResult('inventory', extra, ev, c).code, 'INVENTORY_MISMATCH');
  const similar = JSON.parse(JSON.stringify(valid)); similar.meals[0].items[0].name = '鸡胸肉片';
  assert.equal(validateModelResult('inventory', similar, ev, c).code, 'INVENTORY_MISMATCH');
});

test('empty inventory is rejected explicitly', () => {
  assert.throws(() => normalizeContext('inventory', { stage, today, inventory: [] }), (e) => e.code === 'INVENTORY_REQUIRED');
  assert.throws(() => normalizeContext('weekly_plan', { stage, today, dates: planDates, inventory: [] }), (e) => e.code === 'INVENTORY_REQUIRED');
});

test('weekly plan rejects inventory-external food', () => {
  const c = normalizeContext('weekly_plan', { stage, today, dates: planDates, inventory: planInventory });
  const ev = buildEvidence('weekly_plan', c);
  const valid = {
    task: 'weekly_plan', summary: '一周计划。',
    days: planDates.map((date) => ({ date, meals: [{ slot: '午餐', items: [{ name: '鸡胸肉', amount: '100', unit: 'g', kcal: 165 }], kcal: 165 }] })),
    facts: [{ text: '每日热量目标 1800 千卡', refs: ['stage.kcal'] }],
    inferences: [], suggestions: [], limitations: []
  };
  assert.equal(validateModelResult('weekly_plan', valid, ev, c).ok, true);
  const extra = JSON.parse(JSON.stringify(valid)); extra.days[2].meals[0].items.push({ name: '西兰花', amount: '100', unit: 'g', kcal: 34 });
  assert.equal(validateModelResult('weekly_plan', extra, ev, c).code, 'INVENTORY_MISMATCH');
});

test('fact numbers/dates must be supported by their own refs', () => {
  const c = normalizeContext('food', { question: '能吃吗', stage, today });
  const ev = buildEvidence('food', c);
  const base = { task: 'food', verdict: 'caution', summary: 'x', inferences: [], suggestions: [], limitations: [] };
  assert.equal(validateModelResult('food', Object.assign({}, base, { facts: [{ text: '今日已摄入 900 千卡', refs: ['today.kcal'] }] }), ev).ok, true);
  assert.equal(validateModelResult('food', Object.assign({}, base, { facts: [{ text: '今日已摄入 900 千卡', refs: ['stage.kcal'] }] }), ev).code, 'FACT_NUMBER');
  assert.equal(validateModelResult('food', Object.assign({}, base, { facts: [{ text: '今日已摄入 700 千卡', refs: ['today.kcal'] }] }), ev).code, 'FACT_NUMBER');
  assert.equal(validateModelResult('food', Object.assign({}, base, { facts: [{ text: '今日已摄入 1800 千卡', refs: ['today.kcal'] }] }), ev).code, 'FACT_NUMBER');

  const wc = normalizeContext('weight', {
    stage, goal: { direction: 'lose', currentWeight: 80, targetWeight: 75, bmi: 25 },
    weights: [{ date: '2026-01-01', value: 80 }, { date: '2026-01-08', value: 79 }]
  });
  const wev = buildEvidence('weight', wc);
  const wbase = { task: 'weight', trend: 'down', summary: 'x', inferences: [], suggestions: [], limitations: [] };
  assert.equal(validateModelResult('weight', Object.assign({}, wbase, { facts: [{ text: '2026-01-01 体重 80 kg', refs: ['weight.2026-01-01'] }] }), wev).ok, true);
  assert.equal(validateModelResult('weight', Object.assign({}, wbase, { facts: [{ text: '2025-12-01 体重 80 kg', refs: ['weight.2026-01-01'] }] }), wev).code, 'FACT_DATE');
});

test('fact speculation is not accepted as fact', () => {
  const c = normalizeContext('food', { question: '能吃吗', stage, today });
  const ev = buildEvidence('food', c);
  const base = { task: 'food', verdict: 'caution', summary: 'x', inferences: [], suggestions: [], limitations: [] };
  const r = validateModelResult('food', Object.assign({}, base, { facts: [{ text: '今日已摄入 900 千卡，可能是水分', refs: ['today.kcal'] }] }), ev);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'FACT_SPECULATION');
});

test('legal one-decimal rounding is accepted', () => {
  const c = normalizeContext('food', { question: '能吃吗', stage, today: { kcal: 164.6, protein: 60, fat: 25, carb: 90 } });
  const ev = buildEvidence('food', c);
  const base = { task: 'food', verdict: 'caution', summary: 'x', inferences: [], suggestions: [], limitations: [] };
  assert.equal(validateModelResult('food', Object.assign({}, base, { facts: [{ text: '今日已摄入 165 千卡', refs: ['today.kcal'] }] }), ev).ok, true);
});

test('campus meal accepts only a filtered candidate and drops private request fields', () => {
  const candidates = [
    { id: 'roll', price: 13, minutes: 4, items: 3, privateNote: 'local only' },
    { id: 'tofu', price: 12, minutes: 10, items: 3 }
  ];
  const c = normalizeContext('campus_meal', { preference: 'quick', candidates, profile: { weight: 80 } });
  assert.deepEqual(c, { preference: 'quick', candidates: [
    { id: 'roll', price: 13, minutes: 4, items: 3 }, candidates[1]
  ] });
  assert.throws(() => normalizeContext('campus_meal', { preference: 'quick', candidates: [candidates[0], candidates[0]] }), /invalid meal candidates/);
  const prompt = buildPrompt('campus_meal', c, []);
  assert.doesNotMatch(prompt.user, /privateNote|profile/);
  assert.equal(validateModelResult('campus_meal', { choice: 'roll' }, [], c).value.choice, 'roll');
  assert.equal(validateModelResult('campus_meal', { choice: 'fish' }, [], c).code, 'MEAL_CHOICE_INVALID');
});
