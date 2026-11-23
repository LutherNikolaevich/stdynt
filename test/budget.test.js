import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBudget, foldDelta, cashOnlyBaseFix } from '../src/budget.js';
import { sanitizeData } from '../src/sanitize.js';

const todayStr = '2026-11-23';
const settings = { dailyBudget: 100, dailyRolloverStartDate: '2026-11-20', dailyBudgetSince: '2026-11-01', rolloverBase: 0 };
const run = (expenses = [], income = []) => computeBudget({ settings, expenses, income, todayStr });

test('account entries today do not touch the figure', () => {
  const b = run([{ amount: 30, date: todayStr, accountId: 'bank' }], [{ amount: 50, date: todayStr, accountId: 'bank' }]);
  assert.equal(b.spentToday, 0);
  assert.equal(b.earnedToday, 0);
  assert.equal(b.availableToday, 100 + 300);
});

test('cash entries today do', () => {
  const b = run([{ amount: 30, date: todayStr }], [{ amount: 5, date: todayStr, accountId: null }]);
  assert.equal(b.spentToday, 30);
  assert.equal(b.availableToday, 100 + 300 - 30 + 5);
});

test('account entries in the carry window are left out of the carry', () => {
  const b = run([{ amount: 40, date: '2026-11-21', accountId: 'bank' }, { amount: 10, date: '2026-11-21' }]);
  assert.equal(b.rolloverCarryover, 300 - 10);
  assert.equal(b.dayRows.find((r) => r.date === '2026-11-21').expenses.length, 1);
});

test('foldDelta ignores account entries', () => {
  assert.equal(foldDelta(settings, todayStr, { amount: 20, date: '2026-11-10', accountId: 'bank' }, 'expense'), 0);
  assert.equal(foldDelta(settings, todayStr, { amount: 20, date: '2026-11-10' }, 'expense'), -20);
});

test('cashOnlyBaseFix gives back account entries baked into the base', () => {
  const expenses = [
    { amount: 20, date: '2026-11-10', accountId: 'bank' },
    { amount: 7, date: '2026-11-10' },
    { amount: 9, date: '2026-10-01', accountId: 'bank' }
  ];
  const income = [{ amount: 5, date: '2026-11-12', accountId: 'bank' }];
  assert.equal(cashOnlyBaseFix(settings, expenses, income, todayStr), 15);
});

test('sanitize runs the fix once', () => {
  const opts = { todayStr, currencies: ['$'], defaultCategory: 'Other', defaultSettings: { currency: '$', alertThreshold: 80 } };
  const raw = {
    settings: { ...settings, rolloverBase: 50 },
    accounts: [{ id: 'bank', name: 'Bank', type: 'bank', balance: 0 }],
    expenses: [{ id: 1, amount: 20, date: '2026-11-10', category: 'Other', accountId: 'bank' }]
  };
  const once = sanitizeData(raw, opts);
  assert.equal(once.settings.rolloverBase, 70);
  assert.equal(once.settings.cashOnlyCarry, true);
  const twice = sanitizeData({ ...raw, settings: once.settings, expenses: once.expenses, accounts: once.accounts }, opts);
  assert.equal(twice.settings.rolloverBase, 70);
});

test('monthly cash totals ignore accounts and use cash-side transfers', async () => {
  const { computeMonthlyCash } = await import('../src/budget.js');
  assert.equal(typeof computeMonthlyCash, 'function');
  const period = { start: '2026-11-01', end: '2026-12-01' };
  const totals = computeMonthlyCash({
    expenses: [
      { amount: 30, date: todayStr },
      { amount: 40, date: todayStr, accountId: 'bank' },
      { amount: 60, date: todayStr, accountId: 'wallet' },
      { amount: 999, date: '2026-10-31' }
    ],
    income: [{ amount: 5, date: todayStr }, { amount: 50, date: todayStr, accountId: 'bank' }],
    subscriptions: [{ id: 'cash-sub', cost: 20 }, { id: 'bank-sub', cost: 80, accountId: 'bank' }],
    transfers: [
      { amount: 10, date: todayStr, fromId: null, toId: 'bank' },
      { amount: 25, date: todayStr, fromId: 'bank', toId: null },
      { amount: 100, date: todayStr, fromId: 'bank', toId: 'wallet' },
      { amount: 7, date: '2026-10-31', fromId: 'bank', toId: null }
    ],
    period
  });
  assert.deepEqual(totals, { spent: 30, earned: 5, moved: 15, pending: 20 });
  const committed = totals.spent + totals.pending;
  const available = 500 + totals.earned + totals.moved;
  assert.equal(committed, 50);
  assert.equal(available, 520);
  assert.equal(available - committed, 470);
});

test('monthly pending subscriptions use cash payments only', async () => {
  const { computeMonthlyCash } = await import('../src/budget.js');
  assert.equal(typeof computeMonthlyCash, 'function');
  const period = { start: '2026-11-01', end: '2026-12-01' };
  const totals = computeMonthlyCash({
    expenses: [
      { amount: 40, date: todayStr, accountId: 'bank', subId: 'a' },
      { amount: 10, date: todayStr, subId: 'b' }
    ],
    income: [],
    subscriptions: [
      { id: 'a', cost: 20 },
      { id: 'b', cost: 10 },
      { id: 'c', cost: 30, existing: true, since: '2026-11-20', billingDay: 15 },
      { id: 'd', cost: 50, accountId: 'bank' }
    ],
    period
  });
  assert.deepEqual(totals, { spent: 10, earned: 0, moved: 0, pending: 20 });
});

test('cash<->account transfers leave today and carry unchanged', () => {
  const b = computeBudget({
    settings, expenses: [], income: [], todayStr,
    transfers: [
      { fromId: null, toId: 'bank', amount: 20, date: todayStr },
      { fromId: 'bank', toId: null, amount: 15, date: '2026-11-21' }
    ]
  });
  assert.equal(b.availableToday, 100 + 300);
  assert.equal(b.spentToday, 0);
  assert.equal(b.earnedToday, 0);
  assert.deepEqual(b.dayRows.map((r) => r.carried), [300, 200, 100]);
  assert.ok(b.dayRows.every((r) => !('moved' in r)));
});
