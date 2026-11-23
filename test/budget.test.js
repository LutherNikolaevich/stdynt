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
