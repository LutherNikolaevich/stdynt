
export const parseDate = (s) => {
  if (!s || typeof s !== 'string') return new Date();
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

export const toDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const getLocalTodayStr = (d = new Date()) => toDateStr(d);

export const addDays = (ds, n) => {
  const d = parseDate(ds);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
};

export const daysBetween = (from, to) =>
  Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86400000);

export const isWeekend = (s) => {
  const day = parseDate(s).getDay();
  return day === 0 || day === 6;
};

export const isDateStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const daysInMonth = (y, m0) => new Date(y, m0 + 1, 0).getDate();

export const clampStartDay = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(28, Math.max(1, n)) : 1;
};

export const periodBounds = (todayStr, startDay = 1) => {
  const day = clampStartDay(startDay);
  const t = parseDate(todayStr);
  const m = t.getMonth() - (t.getDate() < day ? 1 : 0);
  const start = new Date(t.getFullYear(), m, day);
  const end = new Date(t.getFullYear(), m + 1, day);
  return { start: toDateStr(start), end: toDateStr(end) };
};

export const shiftPeriod = (todayStr, startDay = 1, offset = 0) => {
  const day = clampStartDay(startDay);
  const current = parseDate(periodBounds(todayStr, day).start);
  const start = new Date(current.getFullYear(), current.getMonth() + offset, day);
  const end = new Date(current.getFullYear(), current.getMonth() + offset + 1, day);
  return { start: toDateStr(start), end: toDateStr(end) };
};

export const periodTotals = (expenses, todayStr, startDay = 1, count = 6) => {
  const periods = [];
  for (let back = count - 1; back >= 0; back--) {
    const { start, end } = shiftPeriod(todayStr, startDay, -back);
    const total = expenses.reduce(
      (sum, e) => (e.date && e.date >= start && e.date < end ? sum + (Number(e.amount) || 0) : sum),
      0
    );
    periods.push({ start, end, total: Math.round(total * 100) / 100 });
  }
  return periods;
};

export const carryWindow = (settings, todayStr) => {
  const start = settings.dailyRolloverStartDate || todayStr;
  const base = Number(settings.rolloverBase) || 0;
  if (settings.resetCarryMonthly) {
    const p = periodBounds(todayStr, settings.monthStartDay).start;
    if (p > start) return { start: p, base: 0 };
  }
  return { start, base };
};

export const isCash = (x) => x.accountId === undefined || x.accountId === null;

const sumInto = (map, key, amount) => map.set(key, (map.get(key) || 0) + (Number(amount) || 0));

const cashDelta = (t) => {
  const amount = Number(t.amount) || 0;
  if (t.fromId === null && t.toId !== null) return -amount;
  if (t.toId === null && t.fromId !== null) return amount;
  return 0;
};

export function computeBudget({ settings, expenses, income, todayStr }) {
  const daily = Number(settings.dailyBudget) || 0;
  const hasDaily = daily > 0;
  const skipWeekends = settings.skipWeekends === true;
  const dailyOn = (ds) => (skipWeekends && isWeekend(ds) ? 0 : daily);
  const { start, base } = carryWindow(settings, todayStr);

  const spentBy = new Map();
  const earnedBy = new Map();
  const expBy = new Map();
  const incBy = new Map();
  for (const e of expenses) {
    if (!isCash(e) || !e.date || e.date < start || e.date > todayStr) continue;
    sumInto(spentBy, e.date, e.amount);
    if (!expBy.has(e.date)) expBy.set(e.date, []);
    expBy.get(e.date).push(e);
  }
  for (const e of income) {
    if (!isCash(e) || !e.date || e.date < start || e.date > todayStr) continue;
    sumInto(earnedBy, e.date, e.amount);
    if (!incBy.has(e.date)) incBy.set(e.date, []);
    incBy.get(e.date).push(e);
  }

  const dayRows = [];
  let carry = base;
  if (hasDaily) {
    for (let ds = start; ds < todayStr; ds = addDays(ds, 1)) {
      const spent = spentBy.get(ds) || 0;
      carry += dailyOn(ds) - spent + (earnedBy.get(ds) || 0);
      dayRows.push({
        date: ds,
        spent,
        carried: carry,
        weekendOff: dailyOn(ds) === 0,
        income: incBy.get(ds) || [],
        expenses: expBy.get(ds) || []
      });
    }
    dayRows.reverse();
  }

  const dailyToday = dailyOn(todayStr);
  const spentToday = spentBy.get(todayStr) || 0;
  const earnedToday = earnedBy.get(todayStr) || 0;
  const rolloverCarryover = hasDaily ? carry : 0;
  return {
    hasDaily,
    start,
    base,
    dailyToday,
    spentToday,
    earnedToday,
    rolloverCarryover,
    availableToday: hasDaily ? dailyToday + rolloverCarryover - spentToday + earnedToday : 0,
    dayRows
  };
}

const carriedDelta = (settings, todayStr, entry, kind) => {
  if (!entry || !(Number(settings.dailyBudget) > 0) || !isDateStr(entry.date)) return 0;
  const { start } = carryWindow(settings, todayStr);
  const since = settings.dailyBudgetSince || settings.dailyRolloverStartDate || start;
  const d = entry.date;
  if (d >= start || d < since) return 0;
  if (settings.resetCarryMonthly && d < periodBounds(todayStr, settings.monthStartDay).start) return 0;
  const amount = Number(entry.amount) || 0;
  return kind === 'income' ? amount : -amount;
};

export const foldDelta = (settings, todayStr, entry, kind) =>
  entry && isCash(entry) ? carriedDelta(settings, todayStr, entry, kind) : 0;

export const cashOnlyBaseFix = (settings, expenses, income, todayStr) => {
  let fix = 0;
  for (const e of expenses) if (!isCash(e)) fix -= carriedDelta(settings, todayStr, e, 'expense');
  for (const e of income) if (!isCash(e)) fix -= carriedDelta(settings, todayStr, e, 'income');
  return Math.round(fix * 100) / 100;
};

export const uncountedReason = (settings, todayStr, date) => {
  if (!(Number(settings.dailyBudget) > 0) || !isDateStr(date)) return null;
  const { start } = carryWindow(settings, todayStr);
  if (date >= start) return null;
  if (foldDelta(settings, todayStr, { date, amount: 1 }, 'expense') !== 0) return null;
  if (settings.resetCarryMonthly && date < periodBounds(todayStr, settings.monthStartDay).start) return 'closed-month';
  return 'before-budget';
};

export const parseAmount = (raw, zeroDecimal = false) => {
  let s = String(raw ?? '')
    .trim()
    .replace(/[\s  ']/g, '');
  if (!/^[0-9.,]*[0-9][0-9.,]*$/.test(s)) return NaN;
  const last = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  const tail = last === -1 ? 0 : s.length - last - 1;
  const grouped = tail === 3 && !/^0+$/.test(s.slice(0, last));
  if (zeroDecimal || last === -1 || tail === 0 || grouped) {
    s = s.replace(/[.,]/g, '');
  } else {
    s = `${s.slice(0, last).replace(/[.,]/g, '')}.${s.slice(last + 1)}`;
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return zeroDecimal ? Math.round(n) : Math.round(n * 100) / 100;
};

export const dueBillingDates = (sub, todayStr) => {
  const day = Math.round(Number(sub.billingDay));
  if (!(day >= 1 && day <= 31) || !isDateStr(sub.since)) return [];
  const after = isDateStr(sub.lastLogged) ? sub.lastLogged : null;
  const from = parseDate(after && after > sub.since ? after : sub.since);
  const out = [];
  let y = from.getFullYear();
  let m = from.getMonth();
  for (let i = 0; i < 36; i++) {
    const ds = toDateStr(new Date(y, m, Math.min(day, daysInMonth(y, m))));
    if (ds > todayStr) break;
    if (ds >= sub.since && (!after || ds > after)) out.push(ds);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
};

export const paidBeforeTracking = (sub, period) => {
  if (!sub.existing || !isDateStr(sub.since)) return false;
  const day = Math.round(Number(sub.billingDay));
  if (!(day >= 1 && day <= 31)) return sub.since >= period.start && sub.since < period.end;
  for (let ds = period.start; ds < period.end; ds = addDays(ds, 1)) {
    const d = parseDate(ds);
    if (d.getDate() === Math.min(day, daysInMonth(d.getFullYear(), d.getMonth()))) return ds <= sub.since;
  }
  return false;
};

export const computeMonthlyCash = ({ expenses, income, transfers = [], subscriptions = [], period }) => {
  const inPeriod = (e) => !!e.date && e.date >= period.start && e.date < period.end;
  const cashExpenses = expenses.filter((e) => inPeriod(e) && isCash(e));
  const spent = cashExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const earned = income.filter((e) => inPeriod(e) && isCash(e)).reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const moved = transfers.filter(inPeriod).reduce((sum, t) => sum + cashDelta(t), 0);
  const pending = subscriptions.filter(isCash).reduce((sum, sub) => {
    const logged = paidBeforeTracking(sub, period) || cashExpenses.some((e) => e.subId === sub.id);
    return sum + (logged ? 0 : Number(sub.cost || 0));
  }, 0);
  return { spent, earned, moved, pending };
};

export const loanRemaining = (debt) =>
  Math.max(
    0,
    Math.round(
      ((Number(debt.amount) || 0) -
        (Array.isArray(debt.payments) ? debt.payments.reduce((s, p) => s + (Number(p.amount) || 0), 0) : 0)) *
        100
    ) / 100
  );

export const loanEntry = (debt, payment = null) => {
  const iOwe = debt.type === 'i_owe';
  const source = payment || debt;
  const label = payment
    ? iOwe
      ? debt.installment
        ? `${debt.person} installment`
        : `Paid back ${debt.person}`
      : `${debt.person} paid back`
    : iOwe
      ? `Borrowed from ${debt.person}`
      : `Lent to ${debt.person}`;
  const note = payment?.note ? `${label} · ${payment.note}` : label;
  return {
    kind: (payment ? !iOwe : iOwe) ? 'income' : 'expense',
    note,
    amount: Number(source.amount) || 0,
    date: source.date || null,
    debtId: debt.id,
    ...(payment ? { payId: payment.id } : {}),
    ...(source.accountId !== undefined && source.accountId !== null ? { accountId: source.accountId } : {})
  };
};

// Loan maths runs in whole cents so sums never pick up floating-point dust.
const cents = (n) => Math.round((Number(n) || 0) * 100);

export const PLAN_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'custom'];

// A loan can carry an installment plan: { count, amount, frequency, everyDays, firstDue }.
// `amount` is what each installment should be; `firstDue` may be null (no due dates, never overdue).
export const planEach = (total, count, zeroDecimal = false) => {
  const n = Math.max(1, Math.round(Number(count)) || 1);
  const per = (Number(total) || 0) / n;
  return zeroDecimal ? Math.max(1, Math.round(per)) : Math.max(0.01, Math.round(per * 100) / 100);
};

export const planDueDate = (plan, i) => {
  if (!plan || !isDateStr(plan.firstDue)) return null;
  if (plan.frequency === 'weekly') return addDays(plan.firstDue, 7 * i);
  if (plan.frequency === 'biweekly') return addDays(plan.firstDue, 14 * i);
  if (plan.frequency === 'custom') return addDays(plan.firstDue, Math.max(1, Math.round(Number(plan.everyDays)) || 1) * i);
  const first = parseDate(plan.firstDue);
  const y = first.getFullYear();
  const m = first.getMonth() + i;
  return toDateStr(new Date(y, m, Math.min(first.getDate(), daysInMonth(y, m))));
};

export const loanPaid = (debt) =>
  (Array.isArray(debt.payments) ? debt.payments.reduce((s, p) => s + cents(p.amount), 0) : 0) / 100;

// The plan laid out as rows: { n, due, amount, paid, status }. Payments fill the
// oldest installment first, so paying extra spills into the next one. The rows
// always add up to the loan total: the last one takes whatever the others leave.
export const loanSchedule = (debt) => {
  const plan = debt.installment;
  if (!plan) return [];
  const count = Math.max(1, Math.round(Number(plan.count)) || 1);
  const each = Math.max(1, cents(plan.amount));
  let left = cents(debt.amount);
  let pool = cents(loanPaid(debt));
  const rows = [];
  for (let i = 0; i < count && left > 0; i++) {
    const amount = i === count - 1 ? left : Math.min(each, left);
    const paid = Math.min(pool, amount);
    rows.push({
      n: i + 1,
      due: planDueDate(plan, i),
      amount: amount / 100,
      paid: paid / 100,
      status: paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    });
    left -= amount;
    pool -= paid;
  }
  return rows;
};

export const loanSummary = (debt, todayStr) => {
  const schedule = loanSchedule(debt);
  const remaining = loanRemaining(debt);
  const total = Number(debt.amount) || 0;
  const open = remaining > 0 ? schedule.filter((r) => r.status !== 'paid') : [];
  const overdue = open.filter((r) => r.due && r.due < todayStr).length;
  const next = open[0] || null;
  return {
    paid: Math.round((total - remaining) * 100) / 100,
    remaining,
    progress: total > 0 ? Math.min(1, Math.max(0, (total - remaining) / total)) : 1,
    schedule,
    nextDue: next ? next.due : null,
    nextAmount: next ? Math.round((next.amount - next.paid) * 100) / 100 : null,
    overdue,
    status: remaining <= 0 ? 'paid' : overdue > 0 ? 'overdue' : 'active'
  };
};

export const startSubscription = (fields, { id, entryId, todayStr, time = null, category, accountId = null, existing = false }) => {
  const link = accountId !== undefined && accountId !== null ? { accountId } : {};
  return {
    subscription: { id, ...fields, since: todayStr, lastLogged: todayStr, ...(existing ? { existing: true } : {}), ...link },
    expense: existing ? null : {
      id: entryId,
      amount: Number(fields.cost),
      category,
      note: fields.name,
      date: todayStr,
      time,
      subId: id,
      ...link
    }
  };
};

export const goalProgress = (goal) => {
  const target = Number(goal.target) || 0;
  const saved = Math.round(goal.contributions.reduce((sum, c) => sum + (Number(c.amount) || 0), 0) * 100) / 100;
  return {
    saved,
    remaining: Math.max(0, Math.round((target - saved) * 100) / 100),
    pct: target > 0 ? Math.min(100, (saved / target) * 100) : 0,
    done: target > 0 && saved >= target
  };
};

export const accountBalance = (account, { expenses = [], income = [], transfers = [], goals = [] } = {}) => {
  const id = account.id;
  const amount = (x) => Number(x.amount) || 0;
  let total = Number(account.balance) || 0;
  for (const e of income) if (e.accountId === id) total += amount(e);
  for (const e of expenses) if (e.accountId === id) total -= amount(e);
  for (const t of transfers) {
    if (t.toId === id) total += amount(t);
    if (t.fromId === id) total -= amount(t);
  }
  for (const g of goals) for (const c of g.contributions) if (c.accountId === id) total -= amount(c);
  return Math.round(total * 100) / 100;
};
