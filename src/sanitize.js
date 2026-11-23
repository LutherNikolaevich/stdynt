import { isDateStr, clampStartDay, cashOnlyBaseFix, parseDate, toDateStr, addDays, planEach, PLAN_FREQUENCIES } from './budget.js';

export const AMOUNT_MAX = 999999999;
export const NOTE_MAX = 80;
export const NAME_MAX = 40;
export const CATEGORY_NAME_MAX = 24;
export const INSTALLMENT_COUNT_MAX = 120;
export const PLAN_EVERY_DAYS_MAX = 365;
const ID_MAX = 64;
const CARRY_MAX = 1e12;

export const validAmount = (v) => {
  if (v === '' || v === null || typeof v === 'boolean') return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n <= AMOUNT_MAX;
};

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const isRealDate = (v) => isDateStr(v) && toDateStr(parseDate(v)) === v;

const CLOCK = /^\d{1,2}:\d{2}$/;

export const parseEntryClock = (exp) => {
  if (typeof exp.time === 'string' && CLOCK.test(exp.time)) {
    const [h, m] = exp.time.split(':');
    if (Number(h) < 24 && Number(m) < 60) return `${h.padStart(2, '0')}:${m}`;
  }
  if (typeof exp.id === 'number' && exp.id > 1e12 && exp.id < 1e14) {
    const d = new Date(exp.id);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return null;
};

export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const buildCsv = (entries, { accounts = [], transfers = [], todayStr }) => {
  const withAccounts = accounts.length > 0;
  const nameOf = (id) => accounts.find((a) => a.id === id)?.name || '';
  const id = (v) => (typeof v === 'number' ? v : csvCell(v));
  const headers = ['ID', 'Type', 'Date', 'Time', 'Category', 'Amount', 'Note'];
  if (withAccounts) headers.push('Account', 'To account');
  const rows = entries.map((e) => [
    id(e.id),
    e.kind === 'income' ? 'Income' : 'Expense',
    e.date || todayStr,
    parseEntryClock(e) || '',
    csvCell(e.category || ''),
    Number(e.amount || 0),
    csvCell(e.note || ''),
    ...(withAccounts ? [csvCell(nameOf(e.accountId)), csvCell('')] : [])
  ]);
  if (withAccounts) {
    for (const t of transfers) {
      rows.push([
        id(t.id),
        'Transfer',
        t.date || todayStr,
        parseEntryClock(t) || '',
        csvCell(''),
        Number(t.amount || 0),
        csvCell(t.note || ''),
        csvCell(t.fromId === null ? 'Cash' : nameOf(t.fromId)),
        csvCell(t.toId === null ? 'Cash' : nameOf(t.toId))
      ]);
    }
  }
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
};

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const list = (v) => (Array.isArray(v) ? v : []);

export function sanitizeData(raw, { todayStr, currencies, defaultCategory, defaultSettings, zeroDecimalCurrencies = [] }) {
  const src = isObj(raw) ? raw : {};
  let dropped = 0;
  const keep = (rows, ok) =>
    list(rows).filter((x) => {
      const good = isObj(x) && ok(x);
      if (!good) dropped += 1;
      return good;
    });

  const seenIds = new Set();
  const uniqueId = (id) => {
    const usable = (typeof id === 'number' && Number.isFinite(id)) || (typeof id === 'string' && id !== '' && id.length <= ID_MAX);
    let next = usable ? id : null;
    while (next === null || seenIds.has(next)) next = Date.now() + Math.random();
    seenIds.add(next);
    return next;
  };
  const entryDate = (x) => (isRealDate(x.date) ? x.date : todayStr);
  const has = (v) => v !== undefined && v !== null;
  const loanLink = (x) => (has(x.debtId) ? { debtId: x.debtId, ...(has(x.payId) ? { payId: x.payId } : {}) } : {});
  const accountLink = (x) => (has(x.accountId) ? { accountId: x.accountId } : {});

  const expenses = keep(src.expenses, (x) => validAmount(x.amount)).map((x) => ({
    amount: Number(x.amount),
    category: clip(x.category, CATEGORY_NAME_MAX) || defaultCategory,
    note: clip(x.note, NOTE_MAX),
    date: entryDate(x),
    time: parseEntryClock(x),
    id: uniqueId(x.id),
    ...(has(x.subId) ? { subId: x.subId } : {}),
    ...loanLink(x),
    ...accountLink(x)
  }));

  const income = keep(src.income, (x) => validAmount(x.amount)).map((x) => ({
    amount: Number(x.amount),
    note: clip(x.note, NOTE_MAX),
    date: entryDate(x),
    time: parseEntryClock(x),
    id: uniqueId(x.id),
    ...loanLink(x),
    ...accountLink(x)
  }));

  const settingsSrc = isObj(src.settings) ? src.settings : {};
  const dayBefore = addDays(todayStr, -1);
  const subIdMap = new Map();
  const subscriptions = keep(src.subscriptions, (s) => clip(s.name, NAME_MAX) && validAmount(s.cost)).map((s) => {
    const id = uniqueId(s.id);
    subIdMap.set(s.id, id);
    const day = Number(s.billingDay);
    let logged = isRealDate(s.lastLogged) ? s.lastLogged : null;
    if (settingsSrc.logSubs !== true && (!logged || logged < dayBefore)) logged = dayBefore;
    return {
      id,
      name: clip(s.name, NAME_MAX),
      cost: Number(s.cost),
      billingDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
      since: isRealDate(s.since) ? s.since : todayStr,
      lastLogged: logged,
      ...(s.existing === true ? { existing: true } : {}),
      ...accountLink(s)
    };
  });
  expenses.forEach((x) => {
    if (!('subId' in x)) return;
    if (subIdMap.has(x.subId)) x.subId = subIdMap.get(x.subId);
    else delete x.subId;
  });

  const goals = keep(src.goals, (g) => clip(g.name, NAME_MAX) && validAmount(g.target)).map((g) => ({
    id: uniqueId(g.id),
    name: clip(g.name, NAME_MAX),
    target: Number(g.target),
    createdAt: isRealDate(g.createdAt) ? g.createdAt : todayStr,
    contributions: keep(g.contributions, (c) => validAmount(c.amount)).map((c) => ({
      id: uniqueId(c.id),
      amount: Number(c.amount),
      date: entryDate(c),
      ...accountLink(c)
    }))
  }));

  const debtMap = new Map();
  // Plans saved before schedules existed look like { months, dueDay, lastLogged }: a monthly
  // plan whose first payment fell on the first due day after the loan started.
  const firstDueDay = (since, dueDay) => {
    const from = parseDate(since);
    for (let i = 0; i < 2; i++) {
      const y = from.getFullYear();
      const m = from.getMonth() + i;
      const ds = toDateStr(new Date(y, m, Math.min(dueDay, new Date(y, m + 1, 0).getDate())));
      if (ds > since) return ds;
    }
    return null;
  };
  const installmentPlan = (d) => {
    const plan = d.installment;
    if (!isObj(plan)) return {};
    const old = !('count' in plan) && 'months' in plan;
    const count = Math.round(Number(old ? plan.months : plan.count));
    if (!(count >= 1 && count <= INSTALLMENT_COUNT_MAX)) return {};
    const zeroDecimal = zeroDecimalCurrencies.includes(settingsSrc.currency);
    const each = validAmount(plan.amount) ? Math.min(Number(plan.amount), Number(d.amount)) : planEach(d.amount, count, zeroDecimal);
    if (old) {
      const dueDay = Math.round(Number(plan.dueDay));
      const since = isRealDate(d.date) ? d.date : todayStr;
      return {
        installment: {
          count,
          amount: each,
          frequency: 'monthly',
          firstDue: dueDay >= 1 && dueDay <= 31 ? firstDueDay(since, dueDay) : null
        }
      };
    }
    const everyDays = Math.round(Number(plan.everyDays));
    const custom = plan.frequency === 'custom' && everyDays >= 1 && everyDays <= PLAN_EVERY_DAYS_MAX;
    return {
      installment: {
        count,
        amount: each,
        frequency: custom ? 'custom' : PLAN_FREQUENCIES.includes(plan.frequency) && plan.frequency !== 'custom' ? plan.frequency : 'monthly',
        ...(custom ? { everyDays } : {}),
        firstDue: isRealDate(plan.firstDue) ? plan.firstDue : null
      }
    };
  };
  const debts = keep(src.debts, (d) => clip(d.person, NAME_MAX) && validAmount(d.amount)).map((d) => {
    const id = uniqueId(d.id);
    const pays = new Map();
    debtMap.set(d.id, { id, pays });
    return {
      id,
      type: d.type === 'they_owe' ? 'they_owe' : 'i_owe',
      person: clip(d.person, NAME_MAX),
      amount: Number(d.amount),
      note: clip(d.note, NOTE_MAX),
      date: isRealDate(d.date) ? d.date : null,
      ...installmentPlan(d),
      ...accountLink(d),
      payments: keep(d.payments, (p) => validAmount(p.amount)).map((p) => {
        const payId = uniqueId(p.id);
        pays.set(p.id, payId);
        return {
          id: payId,
          amount: Number(p.amount),
          date: isRealDate(p.date) ? p.date : null,
          ...(clip(p.note, NOTE_MAX) ? { note: clip(p.note, NOTE_MAX) } : {}),
          ...accountLink(p)
        };
      })
    };
  });
  [...expenses, ...income].forEach((x) => {
    if (!('debtId' in x)) return;
    const debt = debtMap.get(x.debtId);
    const payId = 'payId' in x ? debt?.pays.get(x.payId) : null;
    if (!debt || payId === undefined) {
      delete x.debtId;
      delete x.payId;
      return;
    }
    x.debtId = debt.id;
    if ('payId' in x) x.payId = payId;
  });

  const accountMap = new Map();
  const accounts = keep(src.accounts, (a) => clip(a.name, NAME_MAX)).map((a) => {
    const id = uniqueId(a.id);
    if (!accountMap.has(a.id)) accountMap.set(a.id, id);
    const balance = typeof a.balance === 'boolean' || a.balance === null ? NaN : Number(a.balance);
    return {
      id,
      name: clip(a.name, NAME_MAX),
      type: a.type === 'ewallet' ? 'ewallet' : 'bank',
      balance: Number.isFinite(balance) && Math.abs(balance) <= AMOUNT_MAX ? Math.round(balance * 100) / 100 : 0
    };
  });
  const relink = (x) => {
    if (!('accountId' in x)) return;
    if (accountMap.has(x.accountId)) x.accountId = accountMap.get(x.accountId);
    else delete x.accountId;
  };
  [
    ...expenses,
    ...income,
    ...subscriptions,
    ...debts,
    ...debts.flatMap((d) => d.payments),
    ...goals.flatMap((g) => g.contributions)
  ].forEach(relink);

  // A side of null is cash. A side that is missing or unknown is not.
  const side = (v) => (v === null ? null : accountMap.get(v));
  const knownSide = (v) => v === null || accountMap.has(v);
  const transfers = keep(
    src.transfers,
    (t) =>
      validAmount(t.amount) &&
      knownSide(t.fromId) &&
      knownSide(t.toId) &&
      side(t.fromId) !== side(t.toId)
  ).map((t) => ({
    id: uniqueId(t.id),
    fromId: side(t.fromId),
    toId: side(t.toId),
    amount: Number(t.amount),
    note: clip(t.note, NOTE_MAX),
    date: entryDate(t),
    time: parseEntryClock(t)
  }));

  const s = settingsSrc;
  const budget = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, AMOUNT_MAX) : 0;
  };
  const threshold = Number(s.alertThreshold);
  const base = Number(s.rolloverBase);
  const settings = {
    currency:
      currencies.includes(s.currency) || (typeof s.currency === 'string' && /^\S{1,4}$/.test(s.currency))
        ? s.currency
        : defaultSettings.currency,
    monthlyBudget: budget(s.monthlyBudget),
    dailyBudget: budget(s.dailyBudget),
    alertThreshold: Number.isFinite(threshold) ? Math.min(100, Math.max(50, threshold)) : defaultSettings.alertThreshold,
    dailyRolloverStartDate: isRealDate(s.dailyRolloverStartDate) ? s.dailyRolloverStartDate : todayStr,
    rolloverBase: Number.isFinite(base) && Math.abs(base) <= CARRY_MAX ? base : 0,
    skipWeekends: s.skipWeekends === true,
    dailyBudgetSince: isRealDate(s.dailyBudgetSince) ? s.dailyBudgetSince : null,
    monthStartDay: clampStartDay(s.monthStartDay),
    resetCarryMonthly: s.resetCarryMonthly === true,
    logSubs: true,
    cashOnlyCarry: true
  };
  if (s.cashOnlyCarry !== true) {
    const fixed = settings.rolloverBase + cashOnlyBaseFix(settings, expenses, income, todayStr);
    settings.rolloverBase = Math.abs(fixed) <= CARRY_MAX ? Math.round(fixed * 100) / 100 : 0;
  }

  return { settings, expenses, income, subscriptions, goals, debts, accounts, transfers, dropped };
}
