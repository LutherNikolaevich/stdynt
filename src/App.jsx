import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import {
  CalendarDays,
  ChartPie,
  Repeat,
  HandCoins,
  Settings,
  Plus,
  X,
  ArrowLeft,
  Download,
  Upload,
  TriangleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Wallet,
  ArrowRight,
  ArrowLeftRight,
  PiggyBank,
  Banknote,
  Smartphone,
  RefreshCw,
  SlidersHorizontal
} from 'lucide-react';
import {
  AMOUNT_MAX,
  NOTE_MAX,
  NAME_MAX,
  CATEGORY_NAME_MAX,
  INSTALLMENT_COUNT_MAX,
  PLAN_EVERY_DAYS_MAX,
  parseEntryClock,
  buildCsv,
  sanitizeData
} from './sanitize.js';
import {
  parseDate,
  toDateStr,
  getLocalTodayStr,
  addDays,
  daysBetween,
  isDateStr,
  periodBounds,
  shiftPeriod,
  periodTotals,
  goalProgress,
  clampStartDay,
  computeBudget,
  computeMonthlyCash,
  isCash,
  foldDelta,
  uncountedReason,
  parseAmount,
  suggestDaily,
  dueBillingDates,
  loanEntry,
  loanRemaining,
  startSubscription,
  paidBeforeTracking,
  loanSummary,
  planEach,
  planDueDate,
  PLAN_FREQUENCIES,
  accountBalance
} from './budget.js';
import { prefersReducedMotion, useNearViewport, useWindowedRows } from './perf.jsx';
import { ConsentCard } from './ConsentBanner.jsx';

// The liquid canvas is an enhancement over the CSS level, so it loads as its
// own chunk and starts after the first screen is already up.
const LiquidWell = React.lazy(() => import('./well.jsx'));

const CURRENCIES = [
  { symbol: '$', label: 'Dollar' },
  { symbol: '€', label: 'Euro' },
  { symbol: '£', label: 'Pound' },
  { symbol: '¥', label: 'Yen / Yuan' },
  { symbol: '₹', label: 'Rupee' },
  { symbol: '₱', label: 'Peso' },
  { symbol: '₩', label: 'Won' },
  { symbol: '₦', label: 'Naira' },
  { symbol: 'R', label: 'Rand' },
  { symbol: 'R$', label: 'Real' },
  { symbol: 'Rp', label: 'Rupiah' },
  { symbol: 'RM', label: 'Ringgit' },
  { symbol: '₫', label: 'Dong' },
  { symbol: '฿', label: 'Baht' },
  { symbol: '₺', label: 'Lira' },
  { symbol: 'zł', label: 'Złoty' },
  { symbol: 'kr', label: 'Krona / Krone' },
  { symbol: 'CHF', label: 'Swiss franc' }
];

const ZERO_DECIMAL_CURRENCIES = new Set(['¥', '₩', '₫', 'Rp']);

const STORAGE_KEY = 'stdynt_data_v1';

// Category inks: one shared lightness (78%) and chroma (0.1), hue only varies,
// so no category reads heavier than another in the donut or legend.
const INKS = [
  'oklch(78% 0.1 289deg)',
  'oklch(78% 0.1 58deg)',
  'oklch(78% 0.1 177deg)',
  'oklch(78% 0.1 2deg)',
  'oklch(78% 0.1 248deg)',
  'oklch(78% 0.1 133deg)',
  'oklch(78% 0.1 325deg)',
  'oklch(78% 0.1 110deg)'
];
const UNKNOWN_INK = 'oklch(70% 0.049 125deg)';

// Old saves carry the previous hex palette; map each onto its new oklch ink.
const LEGACY_INKS = {
  '#aaa2e6': INKS[0],
  '#e0a273': INKS[1],
  '#6fc3b0': INKS[2],
  '#e498ad': INKS[3],
  '#80b3e3': INKS[4],
  '#9dc97f': INKS[5],
  '#cc92ce': INKS[6],
  '#c3c577': INKS[7],
  '#a99bff': INKS[0],
  '#ff9f5a': INKS[1],
  '#3fd0b6': INKS[2],
  '#ff8fb0': INKS[3],
  '#5bb8ff': INKS[4],
  '#8fd866': INKS[5],
  '#e07be0': INKS[6],
  '#c9cf5a': INKS[7],
  '#4b3a8c': INKS[0],
  '#57429c': INKS[0],
  '#a0681a': INKS[1],
  '#aa6a00': INKS[1],
  '#1f6f78': INKS[2],
  '#008674': INKS[2],
  '#8a4b2a': INKS[3],
  '#ad472e': INKS[3],
  '#24476b': INKS[4],
  '#175d9b': INKS[4],
  '#2f6b47': INKS[5],
  '#316a23': INKS[5],
  '#7d3c6b': INKS[6],
  '#983c75': INKS[6],
  '#5b6b1f': INKS[7],
  '#737c24': INKS[7]
};

const DEFAULT_CATEGORIES = [
  { id: 'cat-food', name: 'Food & Drinks', color: INKS[0] },
  { id: 'cat-subscription', name: 'Subscription', color: INKS[1] },
  { id: 'cat-transport', name: 'Transport', color: INKS[2] }
];

const UPDATE_WAIT_MS = 20000;
const LOAN_CATEGORY_ID = 'cat-loan';
const SUB_CATEGORY_ID = 'cat-subscription';

const nextInk = (categories) =>
  INKS.find((c) => !categories.some((cat) => cat.color === c)) || INKS[categories.length % INKS.length];

const normalizeCategories = (raw, expenses = []) => {
  const out = [];
  const seen = new Set();
  const push = (name, color, id) => {
    const n = String(name || '').trim().slice(0, CATEGORY_NAME_MAX);
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    const valid = typeof color === 'string' && /^(#[0-9a-f]{6}|oklch\([^)]+\))$/i.test(color);
    out.push({
      id: id || `cat-${Date.now().toString(36)}-${out.length}`,
      name: n,
      color: valid ? LEGACY_INKS[color.toLowerCase()] || color : nextInk(out)
    });
  };
  const hasList = Array.isArray(raw) && raw.length > 0;
  const source = hasList ? raw : DEFAULT_CATEGORIES;
  source.forEach((c) => c && typeof c === 'object' && push(c.name, c.color, typeof c.id === 'string' ? c.id : null));
  if (!hasList) expenses.forEach((e) => e && typeof e.category === 'string' && push(e.category));
  return out.length > 0 ? out : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
};

const makeDefaultState = () => ({
  settings: {
    currency: '$',
    monthlyBudget: 0,
    dailyBudget: 0,
    alertThreshold: 80,
    dailyRolloverStartDate: getLocalTodayStr(),
    rolloverBase: 0,
    skipWeekends: false,
    dailyBudgetSince: null,
    monthStartDay: 1,
    resetCarryMonthly: false,
    logSubs: true,
    cashOnlyCarry: true
  },
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
  expenses: [],
  income: [],
  subscriptions: [],
  goals: [],
  debts: [],
  accounts: [],
  transfers: [],
  prefs: {
    onboarded: false,
    historySort: 'date',
    lastBackup: null,
    lastCategory: null,
    lastAccount: null,
    earlierOpen: null
  }
});

const round2 = (n) => Math.round(n * 100) / 100;

const has = (v) => v !== undefined && v !== null;

const ACCOUNT_TYPES = [
  ['bank', 'Bank'],
  ['ewallet', 'E-wallet']
];
const accountTypeLabel = (type) => (type === 'ewallet' ? 'E-wallet' : 'Bank');

const ACCOUNT_PRESETS = {
  bank: ['BDO', 'BPI', 'Metrobank', 'Landbank', 'PNB', 'UnionBank', 'China Bank', 'Maya Bank', 'GoTyme Bank', 'Maribank'],
  ewallet: ['Maya', 'GCash']
};
const CUSTOM_PRESET = '__custom__';

const withAccount = (x, accountId) => {
  const { accountId: _old, ...rest } = x;
  return has(accountId) ? { ...rest, accountId } : rest;
};

const dropAccount = (d, accountId) => {
  const strip = (x) => (x.accountId === accountId ? withAccount(x, null) : x);
  return {
    ...d,
    accounts: d.accounts.filter((a) => a.id !== accountId),
    transfers: d.transfers.filter((t) => t.fromId !== accountId && t.toId !== accountId),
    expenses: d.expenses.map(strip),
    income: d.income.map(strip),
    subscriptions: d.subscriptions.map(strip),
    goals: d.goals.map((g) => ({ ...g, contributions: g.contributions.map(strip) })),
    debts: d.debts.map((debt) => {
      const payments = Array.isArray(debt.payments) ? debt.payments : [];
      const touched = debt.accountId === accountId || payments.some((p) => p.accountId === accountId);
      return touched ? { ...strip(debt), payments: payments.map(strip) } : debt;
    })
  };
};

const accountLinks = (d, accountId) => {
  const ids = (rows) => new Set(rows.filter((x) => x.accountId === accountId).map((x) => x.id));
  const payments = d.debts.flatMap((debt) => (Array.isArray(debt.payments) ? debt.payments : []));
  return {
    expenses: ids(d.expenses),
    income: ids(d.income),
    subscriptions: ids(d.subscriptions),
    contributions: ids(d.goals.flatMap((g) => g.contributions)),
    debts: ids(d.debts),
    payments: ids(payments),
    transfers: d.transfers.filter((t) => t.fromId === accountId || t.toId === accountId)
  };
};

const restoreAccount = (d, account, index, links) => {
  if (d.accounts.some((a) => a.id === account.id)) return d;
  const accounts = [...d.accounts];
  accounts.splice(Math.max(0, Math.min(index, accounts.length)), 0, account);
  const relink = (set) => (x) => (set.has(x.id) && !has(x.accountId) ? { ...x, accountId: account.id } : x);
  const known = (id) => id === null || accounts.some((a) => a.id === id);
  const back = links.transfers.filter(
    (t) => known(t.fromId) && known(t.toId) && !d.transfers.some((x) => x.id === t.id)
  );
  return {
    ...d,
    accounts,
    transfers: [...d.transfers, ...back],
    expenses: d.expenses.map(relink(links.expenses)),
    income: d.income.map(relink(links.income)),
    subscriptions: d.subscriptions.map(relink(links.subscriptions)),
    goals: d.goals.map((g) => ({ ...g, contributions: g.contributions.map(relink(links.contributions)) })),
    debts: d.debts.map((debt) => {
      const payments = Array.isArray(debt.payments) ? debt.payments : [];
      const touched = links.debts.has(debt.id) || payments.some((p) => links.payments.has(p.id));
      return touched ? { ...relink(links.debts)(debt), payments: payments.map(relink(links.payments)) } : debt;
    })
  };
};

const applyEntryChange = (d, kind, before, after, todayStr, index = 0) => {
  const key = kind === 'income' ? 'income' : 'expenses';
  let list = d[key];
  if (before && after) {
    list = list.map((x) => (x.id === before.id ? after : x));
  } else if (after) {
    if (list.some((x) => x.id === after.id)) return d;
    list = [...list];
    list.splice(Math.max(0, Math.min(index, list.length)), 0, after);
  } else if (before) {
    list = list.filter((x) => x.id !== before.id);
  }
  const delta = foldDelta(d.settings, todayStr, after, kind) - foldDelta(d.settings, todayStr, before, kind);
  return {
    ...d,
    [key]: list,
    settings: delta
      ? { ...d.settings, rolloverBase: round2((Number(d.settings.rolloverBase) || 0) + delta) }
      : d.settings
  };
};

const applyLoanChange = (d, debtBefore, debtAfter, steps, todayStr, index = d.debts.length) => {
  let debts = d.debts;
  if (debtBefore && debtAfter) {
    debts = debts.map((x) => (x.id === debtBefore.id ? debtAfter : x));
  } else if (debtAfter) {
    if (!debts.some((x) => x.id === debtAfter.id)) {
      debts = [...debts];
      debts.splice(Math.max(0, Math.min(index, debts.length)), 0, debtAfter);
    }
  } else if (debtBefore) {
    debts = debts.filter((x) => x.id !== debtBefore.id);
  }
  let next = { ...d, debts };
  for (const [kind, before, after] of steps) {
    const cat = kind === 'expense' && after ? after.category : null;
    if (cat && !next.categories.some((c) => c.name === cat)) {
      next = { ...next, categories: [...next.categories, { id: LOAN_CATEGORY_ID, name: cat, color: nextInk(next.categories) }] };
    }
    next = applyEntryChange(next, kind, before, after, todayStr);
  }
  return next;
};

const syncDebtFromEntry = (d, entry) => {
  if (!has(entry.debtId)) return d;
  const sync = (x) => withAccount({ ...x, amount: entry.amount, date: entry.date }, entry.accountId);
  return {
    ...d,
    debts: d.debts.map((debt) => {
      if (debt.id !== entry.debtId) return debt;
      if (!has(entry.payId)) return sync(debt);
      return { ...debt, payments: (debt.payments || []).map((p) => (p.id === entry.payId ? sync(p) : p)) };
    })
  };
};

const ordinal = (n) => {
  const t = n % 100;
  const suffix = t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix}`;
};

const shortDay = (ds) => parseDate(ds).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const INCOME_FILTER = '\u0000income';

const rejectField = (input, message) => {
  input.setCustomValidity(message);
  input.reportValidity();
};
const clearValidity = (e) => e.currentTarget.setCustomValidity('');
const cleanMoneyInput = (v) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
const numericLock = (e) => {
  clearValidity(e);
  const el = e.currentTarget;
  const cleaned = cleanMoneyInput(el.value);
  if (cleaned !== el.value) el.value = cleaned;
};
const textLock = (e) => {
  clearValidity(e);
  const el = e.currentTarget;
  const v = el.value;
  const cleaned = v.replace(/[0-9]/g, '');
  if (cleaned !== v) el.value = cleaned;
};
const overMax = (input, amount) => {
  if (!(amount > AMOUNT_MAX)) return false;
  rejectField(input, `That's too much to track. The most is ${AMOUNT_MAX.toLocaleString('en-US')}.`);
  return true;
};

const asKind = (kind) => (x) => ({ ...x, kind });

const lastFridayStr = (todayStr) => {
  const d = parseDate(todayStr);
  d.setDate(d.getDate() - ((d.getDay() - 5 + 7) % 7));
  return toDateStr(d);
};

const byWhen = (a, b) =>
  (b.date || '').localeCompare(a.date || '') ||
  (parseEntryClock(b) || '').localeCompare(parseEntryClock(a) || '') ||
  (Number(b.id) || 0) - (Number(a.id) || 0);

const UNDO_MS = 5000;

const TREND_PERIODS = 5;
const TREND_FILL_SHARE = 80;
const compactAmount = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

const MONEY_VIEWS = [
  { id: 'today', label: 'Today', Icon: CalendarDays },
  { id: 'categories', label: 'Categories', Icon: ChartPie },
  { id: 'subs', label: 'Subs', Icon: Repeat },
  { id: 'loans', label: 'Loans', Icon: HandCoins },
  { id: 'accounts', label: 'Accounts', Icon: Wallet }
];

const VIEWS = [...MONEY_VIEWS.map((v) => v.id), 'settings'];
const ADD_FORMS = {
  today: ['expense', 'Log expense'],
  subs: ['add-subs', 'Add subscription'],
  loans: ['add-loans', 'Add loan'],
  accounts: ['add-accounts', 'Add account']
};
const ADD_SHEET_LABELS = {
  account: 'Add account',
  transfer: 'Transfer money',
  goal: 'New savings goal'
};
const readRoute = () => {
  const h = window.location.hash.replace(/^#\/?/, '');
  return VIEWS.includes(h) ? h : 'today';
};

const buzz = (ms = 8) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
  }
};

let installPrompt = null;
const installWatchers = new Set();
const setInstallPrompt = (e) => {
  installPrompt = e;
  installWatchers.forEach((fn) => fn(e));
};
let newBuildAnnounced = false;
const newBuildWatchers = new Set();
export const announceNewBuild = () => {
  newBuildAnnounced = true;
  newBuildWatchers.forEach((fn) => fn());
};
window.addEventListener('beforeinstallprompt', setInstallPrompt);
window.addEventListener('appinstalled', () => setInstallPrompt(null));
const IOS_NOT_INSTALLED = navigator.standalone === false;
const INSTALL_HINT_KEY = 'stdynt_install_hint_off';
const readInstallHintOff = () => {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY) === '1';
  } catch {
    return false;
  }
};

const isPhoneLayout = () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches;

const runViewTransition = (kind, commit) => {
  if (typeof document === 'undefined' || !document.startViewTransition || prefersReducedMotion()) {
    commit();
    return Promise.resolve();
  }
  const root = document.documentElement;
  const prev = root.dataset.vt;
  root.dataset.vt = kind;
  const restore = () => {
    if (prev) root.dataset.vt = prev;
    else delete root.dataset.vt;
  };
  try {
    const transition = document.startViewTransition(() => flushSync(commit));
    return transition.finished.catch(() => {}).then(restore);
  } catch {
    restore();
    commit();
    return Promise.resolve();
  }
};

const useTweened = (target, ms = 620) => {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const from = fromRef.current;
    if (prefersReducedMotion() || from === target) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    let raf;
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 4);
      const cur = p >= 1 ? target : from + (target - from) * eased;
      fromRef.current = cur;
      setValue(cur);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
};

function Fold({ id, label, open, onToggle, summary, className = '' }) {
  return (
    <button
      type="button"
      className={`fold ${open ? 'is-open' : ''} ${className}`}
      aria-expanded={open}
      aria-controls={id}
      onClick={onToggle}
    >
      <span className="fold-text">
        <span className="fold-label">{label}</span>
        {summary && !open && <small className="fold-summary">{summary}</small>}
      </span>
      <span className="fold-chev">
        <ChevronDown size={18} strokeWidth={2.25} aria-hidden="true" />
      </span>
    </button>
  );
}

const isWideScreen = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1000px)').matches;

const STAMP_MAX_CHARS = 13;

function StampFigure({ value, sym }) {
  const tweened = useTweened(value);
  const full = formatNumber(Math.abs(tweened), sym);
  return <span aria-hidden="true">{full.length > STAMP_MAX_CHARS ? shortNumber(tweened, sym, 1) : full}</span>;
}

const stampDate = (s) =>
  parseDate(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();

const entryStamp = (exp, todayStr) => {
  if ((exp.date || todayStr) !== todayStr) return stampDate(exp.date || todayStr);
  return parseEntryClock(exp) || 'TODAY';
};

const HISTORY_DAYS_STEP = 10;
const HISTORY_ROWS_STEP = 20;

const historyDayLabel = (dateStr, todayStr) => {
  if (dateStr === todayStr) return 'Today';
  const y = parseDate(todayStr);
  y.setDate(y.getDate() - 1);
  if (dateStr === toDateStr(y)) return 'Yesterday';
  const d = parseDate(dateStr);
  const sameYear = d.getFullYear() === parseDate(todayStr).getFullYear();
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' })
  });
};

const formatNumber = (num, currencySymbol) => {
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(currencySymbol);
  const decimals = isZeroDecimal ? 0 : 2;
  return Math.abs(Number(num || 0)).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

const MONEY_TIERS = 3;
const shortNumber = (num, currencySymbol, tier) => {
  const n = Math.abs(Number(num || 0));
  if (tier <= 0) return formatNumber(n, currencySymbol);
  if (n < 1000) return Math.round(n).toLocaleString('en-US');
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: tier === 1 ? 2 : tier === 2 ? 1 : 0
  }).format(n);
};

function MoneyFit({ parts, sym, className = '' }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  const text = ({ value, sign = 'neg' }, t) => {
    const val = Number(value || 0);
    const mark = sign === '+' ? '+' : val < 0 ? '−' : sign === 'both' ? '+' : '';
    return `${mark}${sym}${shortNumber(val, sym, t)}`;
  };
  const full = parts.map((p) => text(p, 0)).join(' ');
  const key = `${full}|${width}`;
  const [fit, setFit] = useState({ key, tier: 0 });
  const tier = fit.key === key ? fit.tier : 0;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && tier < MONEY_TIERS && el.scrollWidth > el.clientWidth + 0.5) setFit({ key, tier: tier + 1 });
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const box = el.parentElement || el;
    const ro = new ResizeObserver(() => setWidth(Math.round(box.clientWidth)));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return (
    <span ref={ref} className={`money-fit ${className}`} title={tier > 0 ? full : undefined}>
      {tier > 0 && <span className="sr-only">{full}</span>}
      {parts.map((p, i) => (
        <span key={i} className={p.className} aria-hidden={tier > 0 ? 'true' : undefined}>
          {text(p, tier)}
        </span>
      ))}
    </span>
  );
}

const Money = ({ value, sym, sign }) => <MoneyFit sym={sym} parts={[{ value, sign }]} />;

const PLAN_FREQUENCY_LABELS = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', custom: 'Custom' };

const firstDueGuess = (todayStr, frequency, everyDays) => {
  if (frequency === 'weekly') return addDays(todayStr, 7);
  if (frequency === 'biweekly') return addDays(todayStr, 14);
  if (frequency === 'custom') return addDays(todayStr, Math.max(1, Math.round(Number(everyDays)) || 30));
  return planDueDate({ frequency: 'monthly', firstDue: todayStr }, 1);
};

const PlanFields = ({ plan, todayStr, optional }) => {
  const [on, setOn] = useState(!optional || !!plan);
  const [frequency, setFrequency] = useState(plan?.frequency || 'monthly');
  const [due, setDue] = useState(plan ? plan.firstDue || '' : firstDueGuess(todayStr, 'monthly'));
  const [dueTouched, setDueTouched] = useState(!!plan);
  const pickFrequency = (e) => {
    const next = e.target.value;
    setFrequency(next);
    if (!dueTouched) setDue(firstDueGuess(todayStr, next));
  };
  return (
    <>
      {optional && (
        <label className="plan-toggle grow-full">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          <span>Pay in installments</span>
        </label>
      )}
      {on && (
        <>
          <label className="field day">
            <span>Payments</span>
            <input name="count" type="number" inputMode="numeric" min="1" max={INSTALLMENT_COUNT_MAX} defaultValue={plan?.count} placeholder="12" required onInput={clearValidity} />
          </label>
          <label className="field amount">
            <span>Each</span>
            <input name="each" type="text" inputMode="decimal" defaultValue={plan?.amount} placeholder="Even split" autoComplete="off" onInput={numericLock} />
          </label>
          <label className="field grow">
            <span>How often</span>
            <select name="frequency" value={frequency} onChange={pickFrequency}>
              {PLAN_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {PLAN_FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
          {frequency === 'custom' && (
            <label className="field day">
              <span>Every (days)</span>
              <input name="everyDays" type="number" inputMode="numeric" min="1" max={PLAN_EVERY_DAYS_MAX} defaultValue={plan?.everyDays} placeholder="10" required onInput={clearValidity} />
            </label>
          )}
          <label className="field date">
            <span>First due</span>
            <input
              name="firstDue"
              type="date"
              value={due}
              onChange={(e) => {
                setDue(e.target.value);
                setDueTouched(true);
              }}
            />
          </label>
        </>
      )}
    </>
  );
};

const readState = (parsed, todayStr) => {
  const defaults = makeDefaultState();
  const clean = sanitizeData(parsed, {
    todayStr,
    currencies: CURRENCIES.map((c) => c.symbol),
    zeroDecimalCurrencies: [...ZERO_DECIMAL_CURRENCIES],
    defaultCategory: DEFAULT_CATEGORIES[0].name,
    defaultSettings: defaults.settings
  });
  return { clean, defaults };
};

const UNREADABLE_KEY = `${STORAGE_KEY}_unreadable`;

const loadInitialData = () => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { state: makeDefaultState(), corrupted: false, dropped: 0 };
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { state: makeDefaultState(), corrupted: true, dropped: 0 };
    }
    const { clean, defaults } = readState(parsed, getLocalTodayStr());
    const { dropped, ...lists } = clean;
    const savedPrefs = parsed.prefs && typeof parsed.prefs === 'object' ? parsed.prefs : {};
    if (dropped > 0) {
      try {
        localStorage.setItem(UNREADABLE_KEY, saved);
      } catch {
      }
    }
    return {
      state: {
        ...lists,
        categories: normalizeCategories(parsed.categories, lists.expenses),
        prefs: { ...defaults.prefs, ...savedPrefs, onboarded: savedPrefs.onboarded !== false }
      },
      corrupted: false,
      dropped
    };
  } catch (err) {
    console.error('Error reading saved data:', err);
    return { state: makeDefaultState(), corrupted: true, dropped: 0 };
  }
};

export default function App() {
  const [{ state: initialData, corrupted: initialCorrupted, dropped: initialDropped }] = useState(loadInitialData);
  const [data, setData] = useState(initialData);
  const [storageCorrupted, setStorageCorrupted] = useState(initialCorrupted);
  const [undo, setUndo] = useState(null);
  const undoTimerRef = useRef(null);

  const [view, setView] = useState(readRoute);
  const viewRef = useRef(view);
  const lastMoneyViewRef = useRef(view === 'settings' ? 'today' : view);
  const navIdxRef = useRef(0);
  const scrollMemoRef = useRef({});
  const leavingRef = useRef(false);
  const [stampKey, setStampKey] = useState(0);
  const [sheetClosing, setSheetClosing] = useState(false);
  const addSheetRef = useRef(null);
  const [addSheetClosing, setAddSheetClosing] = useState(false);
  const [addSheetKind, setAddSheetKind] = useState('account');
  const [fabOpen, setFabOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sheetKind, setSheetKind] = useState('expense');
  const [notice, setNotice] = useState(
    initialDropped > 0
      ? `${initialDropped} saved ${initialDropped === 1 ? "entry couldn't be read and was" : "entries couldn't be read and were"} left out.`
      : ''
  );
  const [noticeIsError, setNoticeIsError] = useState(initialDropped > 0);
  const [pickedCat, setPickedCat] = useState(null);
  const [periodOffset, setPeriodOffset] = useState(0);
  useEffect(() => {
    if (view !== 'categories') setPeriodOffset(0);
    setFabOpen(false);
  }, [view]);
  const [hoverCat, setHoverCat] = useState(null);
  const [focusCat, setFocusCat] = useState(null);
  const sheetRef = useRef(null);
  const amountInputRef = useRef(null);
  const dragRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  const [todayStr, setTodayStr] = useState(getLocalTodayStr);
  const [historyPages, setHistoryPages] = useState(1);
  const [dayToggles, setDayToggles] = useState(() => new Set());
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyCat, setHistoryCat] = useState('');
  const [noticeKey, setNoticeKey] = useState(0);
  const [settingsFormKey, setSettingsFormKey] = useState(0);
  const [historyNearRef, historyNear] = useNearViewport();
  const [trendNearRef, trendNear] = useNearViewport();

  // The liquid canvas is an enhancement: let the first screen paint its level
  // from CSS first, then fetch and start the canvas when the browser is idle.
  const [wellReady, setWellReady] = useState(false);
  useEffect(() => {
    const start = () => setWellReady(true);
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(start, { timeout: 1000 });
      return () => cancelIdleCallback(id);
    }
    const id = setTimeout(start, 200);
    return () => clearTimeout(id);
  }, []);
  const [catMove, setCatMove] = useState(null);
  const [rowEdit, setRowEdit] = useState(null);
  const [loanFilter, setLoanFilter] = useState('all');
  const [payEdit, setPayEdit] = useState(null);
  const [openGoal, setOpenGoal] = useState(null);
  const [goalEditId, setGoalEditId] = useState(null);
  const [contributionEditId, setContributionEditId] = useState(null);
  const [sheetDate, setSheetDate] = useState('');
  const [sheetNote, setSheetNote] = useState('');
  const [sheetTime, setSheetTime] = useState('');
  const [sheetWhenOpen, setSheetWhenOpen] = useState(false);
  const [loanMore, setLoanMore] = useState({});
  const persistAskedRef = useRef(false);
  const [fileBusy, setFileBusy] = useState(null);

  const say = (message, isError = false) => {
    if (isError) buzz([20, 50, 20]);
    setNotice(message);
    setNoticeIsError(isError);
    setNoticeKey((k) => k + 1);
  };

  useEffect(() => {
    let timer;
    const sync = () => {
      setTodayStr(getLocalTodayStr());
      clearTimeout(timer);
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
      timer = setTimeout(sync, next - now);
    };
    const onVisible = () => document.visibilityState === 'visible' && sync();
    sync();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, []);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const y = Math.min(Math.max(0, window.scrollY), max);
        setScrolled(y > 4);
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const root = document.documentElement;
    let frame = 0;
    const sync = () => {
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
      root.style.setProperty('--kb', `${inset}px`);
      root.style.setProperty('--vvh', `${Math.round(viewport.height)}px`);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (!focused?.matches?.('input, select, textarea')) return;
        const covered = focused.getBoundingClientRect().bottom > viewport.height - 12;
        if (focused.closest('dialog[open]') || covered) focused.scrollIntoView({ block: 'nearest' });
      });
    };
    sync();
    viewport.addEventListener('resize', sync, { passive: true });
    viewport.addEventListener('scroll', sync, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', sync);
      viewport.removeEventListener('scroll', sync);
      root.style.removeProperty('--kb');
      root.style.removeProperty('--vvh');
    };
  }, []);

  useEffect(() => {
    if (storageCorrupted) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      say("Couldn't save. Changes may be lost when the app closes.", true);
    }
  }, [data, storageCorrupted]);

  useEffect(() => {
    if (!notice || undo) return;
    const t = setTimeout(() => {
      setNotice('');
      setNoticeIsError(false);
    }, 4000);
    return () => clearTimeout(t);
  }, [notice, undo, noticeKey]);

  const [canInstall, setCanInstall] = useState(Boolean(installPrompt));
  useEffect(() => {
    const onChange = (e) => setCanInstall(Boolean(e));
    installWatchers.add(onChange);
    return () => installWatchers.delete(onChange);
  }, []);
  const [hasNewBuild, setHasNewBuild] = useState(newBuildAnnounced);
  useEffect(() => {
    const onAnnounce = () => setHasNewBuild(true);
    newBuildWatchers.add(onAnnounce);
    return () => newBuildWatchers.delete(onAnnounce);
  }, []);
  const [installHintOff, setInstallHintOff] = useState(readInstallHintOff);
  const hideInstallHint = () => {
    setInstallHintOff(true);
    try {
      localStorage.setItem(INSTALL_HINT_KEY, '1');
    } catch {
    }
  };
  const [updateState, setUpdateState] = useState('idle');
  const checkForUpdate = async () => {
    setUpdateState('checking');
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) {
      window.location.reload();
      return;
    }
    try {
      await registration.update();
    } catch {
      setUpdateState('offline');
      return;
    }
    if (!(registration.installing || registration.waiting)) {
      setUpdateState('latest');
      return;
    }
    const giveUp = setTimeout(() => setUpdateState('offline'), UPDATE_WAIT_MS);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        clearTimeout(giveUp);
        window.location.reload();
      },
      { once: true }
    );
  };
  const updateLabel = {
    idle: 'Check for updates',
    checking: 'Checking…',
    latest: "You're on the latest version",
    offline: "Couldn't reach the server. Try again when online."
  }[updateState];
  const install = () => {
    const prompt = installPrompt;
    if (!prompt) return;
    setInstallPrompt(null);
    prompt.prompt();
  };

  const askPersist = () => {
    if (persistAskedRef.current) return;
    persistAskedRef.current = true;
    try {
      navigator.storage
        ?.persisted?.()
        .then((kept) => kept || navigator.storage.persist?.())
        .catch(() => {});
    } catch {
    }
  };

  const armUndoTimer = () => {
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndo(null), UNDO_MS);
  };
  const holdUndoTimer = () => clearTimeout(undoTimerRef.current);
  useEffect(() => {
    if (undo) armUndoTimer();
    return () => clearTimeout(undoTimerRef.current);
  }, [undo]);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const startIdx = Number.isInteger(history.state?.idx) ? history.state.idx : 0;
    navIdxRef.current = startIdx;
    history.replaceState({ ...(history.state || {}), idx: startIdx }, '', window.location.hash ? undefined : `#/${readRoute()}`);
    const onHash = () => {
      syncNavIdx();
      const next = readRoute();
      const cur = viewRef.current;
      if (cur === next) return;
      viewRef.current = next;
      scrollMemoRef.current[cur] = window.scrollY;
      document.documentElement.dataset.navDir = VIEWS.indexOf(next) >= VIEWS.indexOf(cur) ? 'fwd' : 'back';
      const commit = () => {
        flushSync(() => {
          setView(next);
          setAddSheetKind('account');
        });
        window.scrollTo({ top: next === 'settings' ? 0 : scrollMemoRef.current[next] || 0 });
      };
      runViewTransition('nav', commit);
    };
    const onPop = () => {
      if (!leavingRef.current) return;
      if (readRoute() !== 'settings') {
        leavingRef.current = false;
      } else if (syncNavIdx() > 0) {
        history.back();
      } else {
        leavingRef.current = false;
        window.location.hash = `/${lastMoneyViewRef.current}`;
      }
    };
    // A page restored from the back/forward cache keeps its React state, but
    // the browser restores no scroll position for it because the line above
    // made restoration manual. Save the position on the way out and put it
    // back when the page resumes from memory.
    const onPageHide = () => {
      scrollMemoRef.current[viewRef.current] = window.scrollY;
    };
    const onPageShow = (e) => {
      if (e.persisted) window.scrollTo(0, scrollMemoRef.current[viewRef.current] || 0);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  useEffect(() => {
    if (view !== 'settings') lastMoneyViewRef.current = view;
  }, [view]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('log')) return;
    history.replaceState(history.state, '', `${window.location.pathname}${window.location.hash || '#/today'}`);
    openSheet();
  }, []);

  const go = (next) => {
    if (next === view) return;
    window.location.hash = `/${next}`;
  };

  const syncNavIdx = () => {
    if (Number.isInteger(history.state?.idx)) {
      navIdxRef.current = history.state.idx;
    } else {
      navIdxRef.current += 1;
      history.replaceState({ ...(history.state || {}), idx: navIdxRef.current }, '');
    }
    return navIdxRef.current;
  };

  const leaveSettings = () => {
    if (syncNavIdx() > 0) {
      leavingRef.current = true;
      history.back();
    } else {
      window.location.hash = `/${lastMoneyViewRef.current}`;
    }
  };

  useEffect(() => {
    const label = view === 'settings' ? 'Settings' : MONEY_VIEWS.find((v) => v.id === view)?.label;
    document.title = label ? `${label} · stdynt` : 'stdynt';
  }, [view]);

  const onNavClick = (e, id) => {
    if (id !== view) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const onBackClick = (e) => {
    e.preventDefault();
    leaveSettings();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select'))) return;
      if (document.querySelector('dialog[open]')) return;
      const n = Number(e.key);
      if (Number.isInteger(n) && n >= 1 && n <= MONEY_VIEWS.length) {
        e.preventDefault();
        go(MONEY_VIEWS[n - 1].id);
      } else if (e.key === ',') {
        e.preventDefault();
        go('settings');
      } else if (e.key === 'Escape' && viewRef.current === 'settings') {
        e.preventDefault();
        leaveSettings();
      } else if ((e.key === 'n' || e.key === 'N') && !e.shiftKey && ADD_FORMS[viewRef.current]) {
        e.preventDefault();
        viewRef.current === 'today'
          ? openSheet()
          : viewRef.current === 'accounts'
            ? setFabOpen((o) => !o)
            : openAddSheet();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sym = data.settings.currency || '$';
  const fmt = (amount) => {
    const val = Number(amount || 0);
    const formatted = formatNumber(val, sym);
    return val < 0 ? `−${sym}${formatted}` : `${sym}${formatted}`;
  };

  const signed = (amount) => {
    const val = Number(amount || 0);
    const formatted = formatNumber(val, sym);
    return `${val >= 0 ? '+' : '−'}${sym}${formatted}`;
  };

  const categories = data.categories;
  const colorOf = (name) => categories.find((c) => c.name === name)?.color || UNKNOWN_INK;

  const accounts = data.accounts;
  const hasAccounts = accounts.length > 0;
  const accountOf = (id) => (has(id) ? accounts.find((a) => a.id === id) : undefined);
  const accountLabel = (id) => accountOf(id)?.name || (hasAccounts ? 'Cash' : undefined);
  const transferSide = (id) => (id === null ? 'Cash' : accountOf(id)?.name || 'Removed account');
  const balances = useMemo(
    () =>
      new Map(
        accounts.map((a) => [
          a.id,
          accountBalance(a, { expenses: data.expenses, income: data.income, transfers: data.transfers, goals: data.goals })
        ])
      ),
    [accounts, data.expenses, data.income, data.transfers, data.goals]
  );
  const balanceOf = (acc) => balances.get(acc.id) ?? 0;
  const sumBalances = (type) => round2(accounts.reduce((s, a) => s + (type && a.type !== type ? 0 : balanceOf(a)), 0));
  const defaultAccountId =
    data.prefs.lastAccount === 'none' ? null : (accountOf(data.prefs.lastAccount) || accounts[0])?.id ?? null;
  const readAccountId = (control) => {
    const value = String(control?.value ?? '');
    const match = value === '' ? null : accounts.find((a) => String(a.id) === value);
    return match ? match.id : null;
  };
  const accountField = (selected, label = 'Account') =>
    hasAccounts && (
      <label className="field account">
        <span>{label}</span>
        <select name="accountId" defaultValue={has(selected) ? String(selected) : ''}>
          <option value="">Cash</option>
          {accounts.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    );
  const transfersByWhen = useMemo(() => [...data.transfers].sort(byWhen), [data.transfers]);

  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(sym);
  const floorMoney = (n) => (zeroDecimal ? Math.floor(n) : Math.floor(n * 100) / 100);

  const monthlyBudget = Number(data.settings.monthlyBudget) || 0;
  const baseDaily = Number(data.settings.dailyBudget) || 0;
  const hasBudgetSet = monthlyBudget > 0 || baseDaily > 0;
  const hasDaily = baseDaily > 0;
  const skipWeekends = data.settings.skipWeekends === true;

  const monthStartDay = clampStartDay(data.settings.monthStartDay);
  const resetCarryMonthly = data.settings.resetCarryMonthly === true;
  const period = periodBounds(todayStr, monthStartDay);
  const inPeriod = (e) => !!e.date && e.date >= period.start && e.date < period.end;
  const monthName = parseDate(todayStr).toLocaleDateString('en-GB', { month: 'long' });
  const periodName =
    monthStartDay === 1 ? monthName : `${shortDay(period.start)} to ${shortDay(addDays(period.end, -1))}`;
  const periodLabel = (p) => {
    if (monthStartDay !== 1) return `${shortDay(p.start)} to ${shortDay(addDays(p.end, -1))}`;
    const start = parseDate(p.start);
    const sameYear = start.getFullYear() === parseDate(todayStr).getFullYear();
    return start.toLocaleDateString('en-GB', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
  };
  const viewPeriod = shiftPeriod(todayStr, monthStartDay, periodOffset);
  const viewPeriodName = periodOffset === 0 ? periodName : periodLabel(viewPeriod);
  const periodPossessive = monthStartDay === 1 ? `${monthName}'s` : "this month's";
  const daysLeftInPeriod = daysBetween(todayStr, period.end);
  const periodLastDay = shortDay(addDays(period.end, -1));

  const budget = useMemo(
    () =>
      computeBudget({
        settings: data.settings,
        expenses: data.expenses,
        income: data.income,
        todayStr
      }),
    [data.settings, data.expenses, data.income, todayStr]
  );
  const { dailyToday, rolloverCarryover, availableToday, spentToday, earnedToday } = budget;
  const startStr = budget.start;
  const rolloverBase = budget.base;
  const weekendOff = hasDaily && dailyToday === 0;

  const todaysEntries = [
    ...data.expenses.filter((e) => e.date === todayStr && isCash(e)).map(asKind('expense')),
    ...data.income.filter((e) => e.date === todayStr && isCash(e)).map(asKind('income'))
  ].sort(byWhen);

  const dayRows = budget.dayRows.map((r) => {
    const items = [
      ...r.income.map((e) => `+${fmt(e.amount)} ${e.note || 'income'}`),
      ...r.expenses.map((e) => e.note || e.category)
    ];
    return {
      date: r.date,
      spent: r.spent,
      carried: r.carried,
      what: items.slice(0, 2).join(', ') || (r.weekendOff ? 'Weekend, no budget' : 'Nothing spent')
    };
  });
  if (hasDaily && rolloverBase !== 0) {
    dayRows.push({
      date: 'base',
      base: true,
      carried: rolloverBase,
      what: `${shortDay(startStr)}, old daily rate`
    });
  }

  const monthlyExpenses = data.expenses.filter(inPeriod);
  const subLoggedThisPeriod = (sub) => paidBeforeTracking(sub, period) || monthlyExpenses.some((e) => e.subId === sub.id);
  const subsMonthly = data.subscriptions.reduce((s, sub) => s + Number(sub.cost || 0), 0);
  const {
    spent: spentMonthlyExpenses,
    earned: incomeMonthly,
    moved: movedMonthly,
    pending: subsPending
  } = computeMonthlyCash({
    expenses: data.expenses,
    income: data.income,
    transfers: data.transfers,
    subscriptions: data.subscriptions,
    period
  });
  const totalMonthlyCommitted = spentMonthlyExpenses + subsPending;
  const monthAvailable = monthlyBudget + incomeMonthly + movedMonthly;
  const percentMonthlyUsed = monthlyBudget > 0 ? (totalMonthlyCommitted / monthAvailable) * 100 : 0;
  const remainingMonthly = monthAvailable - totalMonthlyCommitted;
  const alertThresh = Number(data.settings.alertThreshold) || 80;
  const isOverAlert = monthlyBudget > 0 && percentMonthlyUsed >= alertThresh;
  const monthState = percentMonthlyUsed >= 100 ? 'over' : isOverAlert ? 'warn' : '';
  const perDayLeft =
    monthlyBudget > 0 && remainingMonthly > 0 && daysLeftInPeriod > 0
      ? floorMoney(remainingMonthly / daysLeftInPeriod)
      : 0;

  const viewExpenses = data.expenses.filter((e) => !!e.date && e.date >= viewPeriod.start && e.date < viewPeriod.end);
  const earliestExpenseDate = data.expenses.reduce((min, e) => (e.date && (!min || e.date < min) ? e.date : min), null);
  const hasEarlierPeriod = !!earliestExpenseDate && earliestExpenseDate < viewPeriod.start;
  const trend = periodTotals(data.expenses, todayStr, monthStartDay, TREND_PERIODS);
  const trendMax = Math.max(monthlyBudget, ...trend.map((t) => t.total));
  const categoryTotals = {};
  viewExpenses.forEach((e) => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount || 0);
  });
  const pieEntries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const pieTotal = pieEntries.reduce((a, b) => a + b[1], 0);
  const pieHas = (cat) => pieEntries.some(([c]) => c === cat);
  const pieFocus = pieHas(hoverCat) ? hoverCat : pieHas(pickedCat) ? pickedCat : null;
  const pieShown = pieFocus || pieEntries[0]?.[0];
  const pieShownAmt = categoryTotals[pieShown] || 0;
  const pickedExpenses = pieHas(pickedCat) ? viewExpenses.filter((e) => e.category === pickedCat) : [];
  const goToPeriod = (offset) => {
    const target = Math.min(0, offset);
    const commit = () => {
      setPeriodOffset(target);
      setPickedCat(null);
      setHoverCat(null);
    };
    if (target === periodOffset) return;
    document.documentElement.dataset.navDir = target >= periodOffset ? 'fwd' : 'back';
    runViewTransition('nav', commit);
  };

  const usageOf = (name) => data.expenses.filter((e) => e.category === name).length;

  const historySort = data.prefs.historySort === 'added' ? 'added' : 'date';
  const historyAll = useMemo(
    () =>
      [...data.expenses.map(asKind('expense')), ...data.income.map(asKind('income'))].sort(
        historySort === 'added' ? (a, b) => (Number(b.id) || 0) - (Number(a.id) || 0) : byWhen
      ),
    [data.expenses, data.income, historySort]
  );
  const setHistorySort = (sort) => {
    runRowTransition(() => {
      setData((d) => ({ ...d, prefs: { ...d.prefs, historySort: sort } }));
      setHistoryPages(1);
    });
  };

  const historyNeedle = historyQuery.trim().toLowerCase();
  const historyFiltered = historyNeedle !== '' || historyCat !== '';
  const historyEntries = historyFiltered
    ? historyAll.filter((e) => {
        const isIncome = e.kind === 'income';
        if (historyCat === INCOME_FILTER && !isIncome) return false;
        if (historyCat && historyCat !== INCOME_FILTER && (isIncome || e.category !== historyCat)) return false;
        if (!historyNeedle) return true;
        const hay = `${e.note || ''} ${isIncome ? 'income' : e.category || ''} ${accountLabel(e.accountId) || ''} ${e.amount} ${formatNumber(e.amount, sym)}`;
        return hay.toLowerCase().includes(historyNeedle);
      })
    : historyAll;
  const filterCats = [
    ...new Set([...categories.map((c) => c.name), ...data.expenses.map((e) => e.category).filter(Boolean)])
  ];
  const setHistoryFilter = (query, cat) => {
    runRowTransition(() => {
      setHistoryQuery(query);
      setHistoryCat(cat);
      setHistoryPages(1);
    });
  };

  const historyDays = [];
  if (historySort === 'date') {
    for (const e of historyEntries) {
      const date = e.date || todayStr;
      let day = historyDays[historyDays.length - 1];
      if (!day || day.date !== date) {
        day = { date, entries: [], spent: 0, earned: 0 };
        historyDays.push(day);
      }
      day.entries.push(e);
      if (e.kind === 'income') day.earned += Number(e.amount) || 0;
      else day.spent += Number(e.amount) || 0;
    }
  }
  const historyDaysShown = historySort === 'date' ? historyDays.slice(0, historyPages * HISTORY_DAYS_STEP) : [];
  const historyRowsShown = historySort === 'date' ? [] : historyEntries.slice(0, historyPages * HISTORY_ROWS_STEP);
  const historyWindowKey = `${historySort}:${historyCat}:${historyNeedle}:${historyEntries.length}`;
  const dayWindow = useWindowedRows(historyDaysShown.length, { resetKey: `d:${historyWindowKey}` });
  const rowWindow = useWindowedRows(historyRowsShown.length, { resetKey: `r:${historyWindowKey}` });
  const dayOpen = (date) => historyFiltered !== dayToggles.has(date);
  const toggleDay = (date) =>
    setDayToggles((s) => {
      const next = new Set(s);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  const hasAnyEntries =
    data.expenses.length + data.income.length + data.subscriptions.length + data.debts.length + accounts.length > 0;
  const lastFriday = lastFridayStr(todayStr);
  const { lastBackup } = data.prefs;
  const backupDue = hasAnyEntries && !storageCorrupted && !(lastBackup >= lastFriday);
  const backupNotifiedRef = useRef(false);
  useEffect(() => {
    if (!backupDue || backupNotifiedRef.current || notice || undo) return;
    backupNotifiedRef.current = true;
    say(
      lastBackup
        ? `Time for your weekly backup. Last one was ${stampDate(lastBackup).toLowerCase().replace(/^0/, '')}.`
        : 'No backup yet. Back one up from Settings.'
    );
  }, [backupDue, notice, undo, lastBackup]);

  const owed = data.debts.filter((d) => d.type === 'i_owe');
  const owedToMe = data.debts.filter((d) => d.type !== 'i_owe');
  const owedTotal = round2(owed.reduce((s, d) => s + loanRemaining(d), 0));
  const owedToMeTotal = round2(owedToMe.reduce((s, d) => s + loanRemaining(d), 0));
  const loanRows = [...owed, ...owedToMe]
    .map((debt) => ({ debt, sum: loanSummary(debt, todayStr) }))
    .sort((a, b) => (a.sum.status === 'paid') - (b.sum.status === 'paid'));
  const loanCounts = {
    all: loanRows.length,
    active: loanRows.filter((r) => r.sum.status !== 'paid').length,
    overdue: loanRows.filter((r) => r.sum.status === 'overdue').length,
    paid: loanRows.filter((r) => r.sum.status === 'paid').length
  };
  const shownLoans = loanRows.filter(
    ({ sum }) => loanFilter === 'all' || (loanFilter === 'active' ? sum.status !== 'paid' : sum.status === loanFilter)
  );

  const sheetCategories =
    editing && !categories.some((c) => c.name === editing.category) && editing.category
      ? [...categories, { id: 'cat-orphan', name: editing.category, color: UNKNOWN_INK }]
      : categories;

  const sheetMemory = useMemo(() => {
    const list = sheetKind === 'income' ? data.income : data.expenses;
    const newestFirst = list.filter((e) => !e.subId && !e.debtId).sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    const recent = [];
    const recentKeys = new Set();
    const notes = [];
    const noteCategory = new Map();
    for (const e of newestFirst) {
      const note = (e.note || '').trim();
      const key = `${note.toLowerCase()}|${e.category || ''}`;
      const usable = sheetKind === 'income' || categories.some((c) => c.name === e.category);
      if (recent.length < 4 && usable && !recentKeys.has(key)) {
        recentKeys.add(key);
        recent.push(e);
      }
      if (note && !noteCategory.has(note.toLowerCase())) {
        noteCategory.set(note.toLowerCase(), e.category);
        if (notes.length < 50) notes.push(note);
      }
    }
    return { recent, notes, noteCategory };
  }, [sheetKind, data.income, data.expenses, categories]);

  const sheetDateReason = sheetDate ? uncountedReason(data.settings, todayStr, sheetDate) : null;
  const sheetSubMatch =
    sheetKind === 'expense' && !editing?.subId && sheetNote.trim()
      ? data.subscriptions.find((s) => s.name.trim().toLowerCase() === sheetNote.trim().toLowerCase())
      : null;

  const nowClock = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const openSheet = (exp = null, kind = 'expense') => {
    const liveToday = getLocalTodayStr();
    if (liveToday !== todayStr) setTodayStr(liveToday);
    setEditing(exp || null);
    setSheetKind(exp?.kind || kind);
    setSheetClosing(false);
    setSheetWhenOpen(!!exp?.date && exp.date !== liveToday);
    sheetRef.current?.showModal();
    requestAnimationFrame(() => {
      const form = sheetRef.current?.querySelector('form');
      if (!form) return;
      form.reset();
      form.elements.amount.setCustomValidity('');
      if (exp) {
        form.elements.amount.value = exp.amount;
        form.elements.category.value = exp.category || categories[0].name;
        form.elements.note.value = exp.note || '';
        form.elements.date.value = exp.date || liveToday;
        form.elements.time.value = parseEntryClock(exp) || '';
        if (form.elements.accountId) form.elements.accountId.value = accountOf(exp.accountId) ? String(exp.accountId) : '';
      } else {
        const last = data.prefs.lastCategory;
        form.elements.category.value = categories.some((c) => c.name === last) ? last : categories[0].name;
        form.elements.date.value = liveToday;
        form.elements.time.value = nowClock();
        if (form.elements.accountId) form.elements.accountId.value = has(defaultAccountId) ? String(defaultAccountId) : '';
      }
      setSheetDate(form.elements.date.value);
      setSheetTime(form.elements.time.value);
      setSheetNote(form.elements.note.value);
      const pickedAccount = form.querySelector('.account-chips input:checked')?.closest('label');
      const accountRow = pickedAccount?.closest('.account-chips');
      if (accountRow) {
        accountRow.scrollLeft = Math.max(0, pickedAccount.offsetLeft - (accountRow.clientWidth - pickedAccount.offsetWidth) / 2);
      }
      const recentRow = sheetRef.current?.querySelector('.recent-row');
      if (recentRow) recentRow.scrollLeft = 0;
      amountInputRef.current?.focus();
    });
  };

  const fillFromRecent = (entry) => {
    const form = sheetRef.current?.querySelector('form');
    if (!form) return;
    form.elements.amount.value = entry.amount;
    form.elements.amount.setCustomValidity('');
    if (entry.category) form.elements.category.value = entry.category;
    form.elements.note.value = entry.note || '';
    if (form.elements.accountId && accountOf(entry.accountId)) form.elements.accountId.value = String(entry.accountId);
    setSheetNote(entry.note || '');
    form.querySelector('button[type="submit"]')?.focus();
  };
  const closeSheet = (after) => {
    if (sheetClosing) return;
    setSheetClosing(true);
    setTimeout(() => {
      sheetRef.current?.close();
      if (sheetRef.current) {
        sheetRef.current.style.transform = '';
        sheetRef.current.style.transition = '';
      }
      setSheetClosing(false);
      if (typeof after === 'function') after();
    }, 240);
  };

  const openAddSheet = (kind = 'account') => {
    setAddSheetKind(kind);
    setAddSheetClosing(false);
    addSheetRef.current?.showModal();
    requestAnimationFrame(() => {
      const form = addSheetRef.current?.querySelector('form');
      form?.reset();
      if (kind === 'account') {
        setSubOrigin('new');
        setLoanKind('i_owe');
        setLoanOrigin('new');
        resetAddAccountDraft('bank');
      }
      addSheetRef.current?.querySelector('input, select')?.focus();
    });
  };
  const closeAddSheet = () => {
    if (addSheetClosing) return;
    setAddSheetClosing(true);
    setTimeout(() => {
      addSheetRef.current?.close();
      if (addSheetRef.current) {
        addSheetRef.current.style.transform = '';
        addSheetRef.current.style.transition = '';
      }
      setAddSheetClosing(false);
    }, 240);
  };

  const onAddSheetDragStart = (e) => {
    if (!isPhoneLayout() || e.button > 0 || e.target.closest('button')) return;
    dragRef.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (addSheetRef.current) addSheetRef.current.style.transition = 'none';
  };
  const onAddSheetDragMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !addSheetRef.current) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    addSheetRef.current.style.transform = `translateY(${drag.dy}px)`;
  };
  const onAddSheetDragEnd = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const el = addSheetRef.current;
    if (!drag || !el) return;
    const speed = drag.dy / Math.max(1, performance.now() - drag.t);
    if (drag.dy > 110 || (drag.dy > 40 && speed > 0.6)) {
      el.style.transition = '';
      closeAddSheet();
    } else {
      el.style.transition = 'transform 0.4s var(--spring)';
      el.style.transform = '';
    }
  };

  const onSheetDragStart = (e) => {
    if (!isPhoneLayout() || e.button > 0 || e.target.closest('button')) return;
    dragRef.current = { y: e.clientY, t: performance.now(), dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  };
  const onSheetDragMove = (e) => {
    const drag = dragRef.current;
    if (!drag || !sheetRef.current) return;
    drag.dy = Math.max(0, e.clientY - drag.y);
    sheetRef.current.style.transform = `translateY(${drag.dy}px)`;
  };
  const onSheetDragEnd = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    const el = sheetRef.current;
    if (!drag || !el) return;
    const speed = drag.dy / Math.max(1, performance.now() - drag.t);
    if (drag.dy > 110 || (drag.dy > 40 && speed > 0.6)) {
      el.style.transition = '';
      closeSheet();
    } else {
      el.style.transition = 'transform 0.4s var(--spring)';
      el.style.transform = '';
    }
  };

  const nameVisibleRows = () => {
    const seen = new Map();
    document.querySelectorAll('[data-row]').forEach((el) => {
      const box = el.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      const id = el.dataset.row;
      const n = seen.get(id) || 0;
      seen.set(id, n + 1);
      el.style.viewTransitionName = `row-${id}-${n}`;
    });
  };
  const clearRowNames = () => {
    document.querySelectorAll('[data-row]').forEach((el) => {
      el.style.viewTransitionName = '';
    });
  };

  const runRowTransition = (commit) => {
    if (prefersReducedMotion() || !document.startViewTransition) {
      commit();
      return Promise.resolve();
    }
    nameVisibleRows();
    return runViewTransition('rows', () => {
      commit();
      nameVisibleRows();
    }).finally(clearRowNames);
  };

  const strikeOut = (id, commit) => {
    const els = [...document.querySelectorAll(`[data-row="${id}"]`)];
    if (els.length === 0 || prefersReducedMotion()) {
      commit();
      return;
    }
    if (els[0].classList.contains('row-strike')) return;
    els.forEach((el) => el.classList.add('row-strike'));
    setTimeout(() => runRowTransition(commit), 220);
  };

  const flashRow = (id) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const els = document.querySelectorAll(`[data-row="${id}"]`);
        els.forEach((el) => el.classList.add('row-fresh'));
        setTimeout(() => els.forEach((el) => el.classList.remove('row-fresh')), 800);
      });
    });
  };

  const handleExpenseSubmit = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amount = parseAmount(fd.get('amount'), zeroDecimal);
    if (!(amount > 0)) {
      rejectField(e.target.elements.amount, `Enter an amount, like ${zeroDecimal ? '500' : '4.50 or 4,50'}.`);
      return;
    }
    if (overMax(e.target.elements.amount, amount)) return;
    const enteredDate = fd.get('date') || todayStr;
    if (enteredDate > todayStr) {
      rejectField(e.target.elements.date, "That date hasn't happened yet.");
      return;
    }
    const time = String(fd.get('time') || '');
    const kind = sheetKind === 'income' ? 'income' : 'expense';
    const accountId = readAccountId(e.target.elements.accountId);
    const base = {
      amount,
      ...(kind === 'income' ? {} : { category: fd.get('category') || categories[0].name }),
      note: (fd.get('note')?.trim() || '').slice(0, NOTE_MAX),
      date: enteredDate,
      time: /^\d{1,2}:\d{2}$/.test(time) ? time : null
    };
    if (editing) {
      const { kind: _rowKind, ...before } = editing;
      const after = withAccount({ ...before, ...base }, accountId);
      setData((d) => syncDebtFromEntry(applyEntryChange(d, kind, before, after, todayStr), after));
      flashRow(before.id);
      setUndo({
        message: `Saved ${base.note || (kind === 'income' ? 'income' : base.category)}.`,
        restore: () => {
          setData((d) => syncDebtFromEntry(applyEntryChange(d, kind, after, before, todayStr), before));
          setStampKey((k) => k + 1);
          flashRow(before.id);
          setUndo(null);
        }
      });
    } else {
      const item = withAccount({ id: Date.now(), ...base }, accountId);
      setData((d) => {
        const next = applyEntryChange(d, kind, null, item, todayStr);
        return {
          ...next,
          prefs: {
            ...next.prefs,
            ...(kind === 'expense' ? { lastCategory: base.category } : {}),
            ...(next.accounts.length > 0 ? { lastAccount: accountId ?? 'none' } : {})
          }
        };
      });
      flashRow(item.id);
      askPersist();
    }
    setStampKey((k) => k + 1);
    buzz(12);
    e.target.reset();
    closeSheet();
  };

  const removeWithUndo = (listKey, item, message) => {
    const index = data[listKey].findIndex((x) => x.id === item.id);
    const entryKind = listKey === 'expenses' ? 'expense' : listKey === 'income' ? 'income' : null;
    const pressStamp = !!entryKind;
    const hasId = (v) => v !== undefined && v !== null;
    const debtIndex = entryKind && hasId(item.debtId) ? data.debts.findIndex((x) => x.id === item.debtId) : -1;
    const linked = debtIndex >= 0 ? data.debts[debtIndex] : null;
    const wholeLoan = linked && !hasId(item.payId);
    if (wholeLoan) message = `${message} Loan with ${linked.person} removed too.`;
    const dropLinked = (d) => {
      if (!linked) return d;
      return {
        ...d,
        debts: wholeLoan
          ? d.debts.filter((x) => x.id !== linked.id)
          : d.debts.map((x) => (x.id === linked.id ? { ...x, payments: (x.payments || []).filter((p) => p.id !== item.payId) } : x))
      };
    };
    const restoreLinked = (d) => {
      if (!linked) return d;
      if (wholeLoan) {
        if (d.debts.some((x) => x.id === linked.id)) return d;
        const debts = [...d.debts];
        debts.splice(Math.max(0, Math.min(debtIndex, debts.length)), 0, linked);
        return { ...d, debts };
      }
      return {
        ...d,
        debts: d.debts.map((x) =>
          x.id === linked.id
            ? { ...x, payments: (linked.payments || []).filter((p) => p.id === item.payId || (x.payments || []).some((q) => q.id === p.id)) }
            : x
        )
      };
    };
    strikeOut(item.id, () => {
      setData((d) =>
        entryKind
          ? dropLinked(applyEntryChange(d, entryKind, item, null, todayStr))
          : { ...d, [listKey]: d[listKey].filter((x) => x.id !== item.id) }
      );
      if (pressStamp) setStampKey((k) => k + 1);
      buzz();
      setUndo({
        message,
        restore: () => {
          setData((d) => {
            if (d[listKey].some((x) => x.id === item.id)) return d;
            if (entryKind) return restoreLinked(applyEntryChange(d, entryKind, null, item, todayStr, index));
            const list = [...d[listKey]];
            list.splice(Math.max(0, Math.min(index, list.length)), 0, item);
            return { ...d, [listKey]: list };
          });
          if (pressStamp) setStampKey((k) => k + 1);
          flashRow(item.id);
          setUndo(null);
        }
      });
    });
  };

  const replaceWithUndo = (listKey, before, after, message) => {
    setData((d) => ({ ...d, [listKey]: d[listKey].map((x) => (x.id === before.id ? after : x)) }));
    flashRow(before.id);
    setUndo({
      message,
      restore: () => {
        setData((d) => ({ ...d, [listKey]: d[listKey].map((x) => (x.id === before.id ? before : x)) }));
        flashRow(before.id);
        setUndo(null);
      }
    });
  };

  const deleteExpense = ({ kind, ...exp }) =>
    kind === 'income'
      ? removeWithUndo('income', exp, `Deleted ${exp.note || 'income'}, +${fmt(exp.amount)}.`)
      : removeWithUndo('expenses', exp, `Deleted ${exp.note || exp.category}, ${fmt(exp.amount)}.`);

  const entryLabel = (exp) => exp.note || (exp.kind === 'income' ? 'Income' : exp.category);
  const entryAmount = (exp) => (exp.kind === 'income' ? `+${fmt(exp.amount)}` : fmt(exp.amount));

  const renderHistoryRow = (exp, underDay, vindex) => {
    const isIncome = exp.kind === 'income';
    const stamp = underDay
      ? (exp.date || todayStr) === todayStr
        ? parseEntryClock(exp)
        : null
      : entryStamp(exp, todayStr);
    const meta = [exp.note ? (isIncome ? 'Income' : exp.category) : '', accountLabel(exp.accountId), stamp]
      .filter(Boolean)
      .join(' · ');
    return (
      <li key={exp.id} className="list-row" data-row={exp.id} data-vindex={vindex}>
        <button
          type="button"
          className="row-open"
          onClick={() => openSheet(exp)}
          aria-label={`Edit ${entryLabel(exp)}, ${entryAmount(exp)}`}
        >
          <span
            className={`cat-dot ${isIncome ? 'income-dot' : ''}`}
            style={isIncome ? undefined : { background: colorOf(exp.category) }}
          />
          <span className="list-main">
            <span>{entryLabel(exp)}</span>
            {meta && <small>{meta}</small>}
          </span>
          <span className="num amt">{entryAmount(exp)}</span>
        </button>
        <button
          className="row-del"
          onClick={() => deleteExpense(exp)}
          aria-label={`Delete ${entryLabel(exp)}, ${entryAmount(exp)}`}
        >
          <X size={16} strokeWidth={2.25} />
        </button>
      </li>
    );
  };

  const nameTaken = (name, exceptId) =>
    categories.some((c) => c.id !== exceptId && c.name.toLowerCase() === name.toLowerCase());

  const categoryExample =
    ['Books & Study', 'Going out', 'Laundry', 'Gifts', 'Phone'].find((n) => !nameTaken(n)) || 'Books & Study';

  const handleAddCategory = (e) => {
    e.preventDefault();
    const input = e.target.elements.catName;
    const name = input.value.trim().slice(0, CATEGORY_NAME_MAX);
    if (!name) {
      rejectField(input, 'Enter a name.');
      return;
    }
    if (nameTaken(name)) {
      say(`"${name}" is already a category.`, true);
      return;
    }
    const id = `cat-${Date.now().toString(36)}`;
    setData((d) => ({ ...d, categories: [...d.categories, { id, name, color: nextInk(d.categories) }] }));
    flashRow(id);
    e.target.reset();
  };

  const renameCategory = (cat, input) => {
    const name = input.value.trim().slice(0, CATEGORY_NAME_MAX);
    if (name === cat.name) return;
    if (!name || nameTaken(name, cat.id)) {
      input.value = cat.name;
      say(name ? `"${name}" is already a category.` : 'A category needs a name.', true);
      return;
    }
    setData((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.id === cat.id ? { ...c, name } : c)),
      expenses: d.expenses.map((x) => (x.category === cat.name ? { ...x, category: name } : x)),
      prefs: d.prefs.lastCategory === cat.name ? { ...d.prefs, lastCategory: name } : d.prefs
    }));
    if (pickedCat === cat.name) setPickedCat(name);
    if (historyCat === cat.name) setHistoryCat(name);
  };

  const cycleInk = (cat) => {
    const next = INKS[(INKS.indexOf(cat.color) + 1) % INKS.length];
    setData((d) => ({
      ...d,
      categories: d.categories.map((c) => (c.id === cat.id ? { ...c, color: next } : c))
    }));
  };

  const deleteCategory = (cat) => {
    if (categories.length <= 1) return;
    if (usageOf(cat.name) === 0) {
      removeWithUndo('categories', cat, `Removed category ${cat.name}.`);
      return;
    }
    setCatMove({ id: cat.id, to: categories.find((c) => c.id !== cat.id).name });
  };

  const moveAndRemoveCategory = (cat, toName) => {
    const index = categories.findIndex((c) => c.id === cat.id);
    const movedIds = new Set(data.expenses.filter((e) => e.category === cat.name).map((e) => e.id));
    const n = movedIds.size;
    setCatMove(null);
    strikeOut(cat.id, () => {
      setData((d) => ({
        ...d,
        categories: d.categories.filter((c) => c.id !== cat.id),
        expenses: d.expenses.map((e) => (movedIds.has(e.id) ? { ...e, category: toName } : e)),
        prefs: d.prefs.lastCategory === cat.name ? { ...d.prefs, lastCategory: toName } : d.prefs
      }));
      if (pickedCat === cat.name) setPickedCat(null);
      buzz();
      setUndo({
        message: `Removed ${cat.name}, ${n} moved to ${toName}.`,
        restore: () => {
          setData((d) => {
            if (d.categories.some((c) => c.id === cat.id)) return d;
            const list = [...d.categories];
            list.splice(Math.max(0, Math.min(index, list.length)), 0, cat);
            return {
              ...d,
              categories: list,
              expenses: d.expenses.map((e) =>
                movedIds.has(e.id) && e.category === toName ? { ...e, category: cat.name } : e
              )
            };
          });
          flashRow(cat.id);
          setUndo(null);
        }
      });
    });
  };

  const readBillingDay = (input) => {
    const raw = String(input.value || '').trim();
    if (!raw) return { ok: true, day: null };
    const day = Number(raw);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      rejectField(input, 'A billing day is a date from 1 to 31.');
      return { ok: false };
    }
    return { ok: true, day };
  };

  const readSubForm = (form) => {
    const name = form.elements.name.value.trim().slice(0, NAME_MAX);
    const cost = parseAmount(form.elements.cost.value, zeroDecimal);
    if (!name) {
      rejectField(form.elements.name, 'Enter a name.');
      return null;
    }
    if (!(cost > 0)) {
      rejectField(form.elements.cost, 'Enter what it costs each month.');
      return null;
    }
    if (overMax(form.elements.cost, cost)) return null;
    const billing = readBillingDay(form.elements.billingDay);
    if (!billing.ok) return null;
    return { name, cost, billingDay: billing.day };
  };

  const subCategoryName = (d) =>
    (
      d.categories.find((c) => c.id === SUB_CATEGORY_ID) ||
      d.categories.find((c) => c.name.toLowerCase() === 'subscription') ||
      d.categories[0]
    ).name;

  const handleAddSub = (e) => {
    e.preventDefault();
    const fields = readSubForm(e.target);
    if (!fields) return;
    const id = Date.now();
    const entryId = id + 1;
    const accountId = readAccountId(e.target.elements.accountId);
    const time = nowClock();
    const existing = new FormData(e.target).get('origin') === 'existing';
    setData((d) => {
      if (d.subscriptions.some((s) => s.id === id)) return d;
      const { subscription, expense } = startSubscription(fields, {
        id,
        entryId,
        todayStr,
        time,
        category: subCategoryName(d),
        accountId,
        existing
      });
      const next = expense ? applyEntryChange(d, 'expense', null, expense, todayStr) : d;
      return { ...next, subscriptions: [...next.subscriptions, subscription] };
    });
    if (!existing) setStampKey((k) => k + 1);
    flashRow(id);
    if (!existing) flashRow(entryId);
    buzz(12);
    askPersist();
    setSubOrigin('new');
    setUndo({
      message: existing
        ? `Added ${fields.name}. It is logged from its next billing day.`
        : `Added ${fields.name}, logged ${fmt(fields.cost)} today.`,
      restore: () => {
        setData((d) => {
          const logged = d.expenses.find((x) => x.id === entryId);
          const next = logged ? applyEntryChange(d, 'expense', logged, null, todayStr) : d;
          return { ...next, subscriptions: next.subscriptions.filter((s) => s.id !== id) };
        });
        setStampKey((k) => k + 1);
        setUndo(null);
      }
    });
    e.target.reset();
    closeAddSheet();
  };

  const saveSub = (e, sub) => {
    e.preventDefault();
    const fields = readSubForm(e.target);
    if (!fields) return;
    const after = withAccount(
      { ...sub, ...fields, since: sub.since || todayStr },
      hasAccounts ? readAccountId(e.target.elements.accountId) : sub.accountId
    );
    if (fields.billingDay !== sub.billingDay && isDateStr(sub.lastLogged) && sub.lastLogged.slice(0, 7) === todayStr.slice(0, 7)) {
      const t = parseDate(todayStr);
      after.lastLogged = toDateStr(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    }
    setRowEdit(null);
    replaceWithUndo('subscriptions', sub, after, `Saved ${fields.name}.`);
  };

  useEffect(() => {
    if (storageCorrupted) return;
    const dueNames = data.subscriptions.filter((s) => dueBillingDates(s, todayStr).length > 0).map((s) => s.name);
    if (dueNames.length === 0) return;
    const firstId = Date.now();
    setData((d) => {
      const catName = subCategoryName(d);
      let next = d;
      let i = 0;
      const lastBySub = new Map();
      for (const sub of d.subscriptions) {
        const dates = dueBillingDates(sub, todayStr);
        if (dates.length === 0) continue;
        for (const date of dates) {
          const entry = withAccount(
            { id: firstId + i++, amount: Number(sub.cost), category: catName, note: sub.name, date, time: null, subId: sub.id },
            d.accounts.some((a) => a.id === sub.accountId) ? sub.accountId : null
          );
          next = applyEntryChange(next, 'expense', null, entry, todayStr);
        }
        lastBySub.set(sub.id, dates[dates.length - 1]);
      }
      if (lastBySub.size === 0) return d;
      return {
        ...next,
        subscriptions: next.subscriptions.map((s) => (lastBySub.has(s.id) ? { ...s, lastLogged: lastBySub.get(s.id) } : s))
      };
    });
    setStampKey((k) => k + 1);
    say(
      dueNames.length === 1
        ? `Logged ${dueNames[0]} for its billing day.`
        : `Logged ${dueNames.length} subscriptions for their billing days.`
    );
  }, [todayStr, data.subscriptions, storageCorrupted]);

  const loanCategory =
    (categories.find((c) => c.id === LOAN_CATEGORY_ID) || categories.find((c) => c.name.toLowerCase() === 'loan'))?.name || 'Loan';

  const loanStep = (debt, payment, id) => {
    const { kind, ...fields } = loanEntry(debt, payment);
    const entry = { id, ...fields, date: fields.date || todayStr, time: null };
    if (kind === 'expense') entry.category = loanCategory;
    return [kind, null, entry];
  };

  const findLoanEntry = (debt) => {
    const { kind } = loanEntry(debt);
    const list = kind === 'income' ? data.income : data.expenses;
    const entry = list.find((x) => x.debtId === debt.id && (x.payId === undefined || x.payId === null));
    return entry ? [kind, entry] : null;
  };

  const findPayEntry = (debt, payment) => {
    const { kind } = loanEntry(debt, payment);
    const list = kind === 'income' ? data.income : data.expenses;
    const entry = list.find((x) => x.debtId === debt.id && x.payId === payment.id);
    return entry ? [kind, entry] : null;
  };

  const commitLoan = ({ before, after, steps, message }) => {
    const index = before ? data.debts.findIndex((x) => x.id === before.id) : data.debts.length;
    const run = () => {
      setData((d) => applyLoanChange(d, before, after, steps, todayStr, index));
      if (steps.length > 0) setStampKey((k) => k + 1);
      if (after) flashRow(after.id);
      else buzz();
      setUndo({
        message,
        restore: () => {
          const back = steps.map(([kind, b, a]) => [kind, a, b]).reverse();
          setData((d) => applyLoanChange(d, after, before, back, todayStr, index));
          if (steps.length > 0) setStampKey((k) => k + 1);
          if (before) flashRow(before.id);
          setUndo(null);
        }
      });
    };
    if (before && !after) strikeOut(before.id, run);
    else run();
  };

  const settleDebt = (debt, paid, message, accountId = debt.accountId) => {
    if (!(paid > 0)) return;
    const payment = withAccount({ id: Date.now(), amount: paid, date: todayStr }, accountOf(accountId) ? accountId : null);
    const after = { ...debt, payments: [...(Array.isArray(debt.payments) ? debt.payments : []), payment] };
    setRowEdit(null);
    commitLoan({ before: debt, after, steps: [loanStep(debt, payment, payment.id + 1)], message });
  };

  const removeLoan = (debt) => {
    const logged = (Array.isArray(debt.payments) && debt.payments.length > 0) || findLoanEntry(debt);
    setRowEdit(null);
    commitLoan({
      before: debt,
      after: null,
      steps: [],
      message: logged ? `Removed loan with ${debt.person}. Its entries stay in your log.` : `Removed loan with ${debt.person}.`
    });
  };

  const handleAddDebt = (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const person = fd.get('person')?.trim();
    const amount = parseAmount(fd.get('amount'), zeroDecimal);
    const isItem = fd.get('type') === 'installment';
    const type = fd.get('type') === 'they_owe' ? 'they_owe' : 'i_owe';
    const note = String(fd.get('note') || '').trim();
    if (!person) {
      rejectField(e.target.elements.person, isItem ? 'Enter what it is.' : 'Enter a name.');
      return;
    }
    if (!(amount > 0)) {
      rejectField(e.target.elements.amount, 'Enter how much, like 12.00.');
      return;
    }
    if (overMax(e.target.elements.amount, amount)) return;
    const since = e.target.elements.date.value || todayStr;
    if (since > todayStr) {
      rejectField(e.target.elements.date, "That date hasn't happened yet.");
      return;
    }
    const existing = fd.get('origin') === 'existing';
    let paidBefore = 0;
    const rawPaidBefore = existing ? String(fd.get('paidBefore') || '').trim() : '';
    if (rawPaidBefore) {
      paidBefore = parseAmount(rawPaidBefore, zeroDecimal);
      const paidInput = e.target.elements.paidBefore;
      if (!(paidBefore > 0)) {
        rejectField(paidInput, 'Enter how much is already paid, or leave it blank.');
        return;
      }
      if (overMax(paidInput, paidBefore)) return;
      if (paidBefore > amount) {
        rejectField(paidInput, 'That is more than the total.');
        return;
      }
    }
    const plan = readPlan(e.target, amount);
    if (plan === undefined) return;
    const id = Date.now();
    const accountId = readAccountId(e.target.elements.accountId);
    const payments = paidBefore > 0 ? [withAccount({ id: id + 2, amount: paidBefore, date: since }, accountId)] : [];
    const debt = withAccount(
      { id, type, person, amount, note: isItem ? '' : note, date: since, ...(plan ? { installment: plan } : {}), payments },
      accountId
    );
    const planned = plan ? ` ${plan.count} ${plan.count === 1 ? 'payment' : 'payments'} of ${fmt(plan.amount)}.` : '';
    const when = since === todayStr ? 'today' : shortDay(since);
    const alreadyPaid = paidBefore > 0 ? `, ${fmt(paidBefore)} already paid` : '';
    commitLoan({
      before: null,
      after: debt,
      steps: isItem || existing ? [] : [loanStep(debt, null, id + 1)],
      message: existing
        ? `Added ${person}${alreadyPaid}, nothing logged.${planned}`
        : isItem
          ? `Added ${person}.${planned}`
          : type === 'i_owe'
          ? `Borrowed ${fmt(amount)} from ${person}, added to ${when}.${planned}`
          : `Lent ${fmt(amount)} to ${person}, taken from ${when}.${planned}`
    });
    askPersist();
    e.target.reset();
    setLoanKind('i_owe');
    setLoanOrigin('new');
    closeAddSheet();
  };

  const readPlan = (form, amount, prev = null) => {
    const input = form.elements.count;
    if (!input) return null;
    const count = Number(String(input.value || '').trim());
    if (!Number.isInteger(count) || count < 1 || count > INSTALLMENT_COUNT_MAX) {
      rejectField(input, `Enter how many payments, from 1 to ${INSTALLMENT_COUNT_MAX}.`);
      return undefined;
    }
    if (amount / count < (zeroDecimal ? 1 : 0.01)) {
      rejectField(input, 'That is too many payments for this amount.');
      return undefined;
    }
    const eachInput = form.elements.each;
    const rawEach = String(eachInput.value || '').trim();
    const even = planEach(amount, count, zeroDecimal);
    let each = even;
    if (rawEach) {
      each = parseAmount(rawEach, zeroDecimal);
      if (!(each > 0)) {
        rejectField(eachInput, 'Enter what each payment is, or leave it blank to split evenly.');
        return undefined;
      }
      if (each > amount) {
        rejectField(eachInput, 'One payment cannot be more than the total.');
        return undefined;
      }
      const old = prev?.installment;
      if (old && each === old.amount && old.amount === planEach(prev.amount, old.count, zeroDecimal)) each = even;
    }
    const frequency = PLAN_FREQUENCIES.includes(form.elements.frequency.value) ? form.elements.frequency.value : 'monthly';
    const plan = { count, amount: each, frequency };
    if (frequency === 'custom') {
      const daysInput = form.elements.everyDays;
      const everyDays = Number(String(daysInput.value || '').trim());
      if (!Number.isInteger(everyDays) || everyDays < 1 || everyDays > PLAN_EVERY_DAYS_MAX) {
        rejectField(daysInput, `Enter a number of days, from 1 to ${PLAN_EVERY_DAYS_MAX}.`);
        return undefined;
      }
      plan.everyDays = everyDays;
    }
    plan.firstDue = isDateStr(form.elements.firstDue.value) ? form.elements.firstDue.value : null;
    return plan;
  };

  const saveDebt = (e, debt) => {
    e.preventDefault();
    const form = e.target;
    const person = form.elements.person.value.trim();
    const amount = parseAmount(form.elements.amount.value, zeroDecimal);
    if (!person) {
      rejectField(form.elements.person, 'Enter a name.');
      return;
    }
    if (!(amount > 0)) {
      rejectField(form.elements.amount, 'Enter how much, like 12.00.');
      return;
    }
    if (overMax(form.elements.amount, amount)) return;
    const plan = readPlan(form, amount, debt);
    if (plan === undefined) return;
    const date = isDateStr(form.elements.date.value) ? form.elements.date.value : debt.date || null;
    const { installment: _plan, ...rest } = debt;
    const after = { ...rest, person, amount, note: form.elements.note.value.trim(), date, ...(plan ? { installment: plan } : {}) };
    const logged = findLoanEntry(debt);
    const steps = [];
    if (logged) {
      const [kind, entry] = logged;
      const { note } = loanEntry(after);
      steps.push([kind, entry, { ...entry, amount, date: date || entry.date, note }]);
    }
    setRowEdit(null);
    commitLoan({
      before: debt,
      after,
      steps,
      message: loanRemaining(after) <= 0 ? `Saved. Loan with ${person} is paid.` : `Saved loan with ${person}.`
    });
  };

  const readPayment = (form) => {
    const input = form.elements.paid;
    const amount = parseAmount(input.value, zeroDecimal);
    if (!(amount > 0)) {
      rejectField(input, 'Enter how much was paid back.');
      return null;
    }
    if (overMax(input, amount)) return null;
    const rawDate = form.elements.date.value;
    const note = form.elements.note.value.trim().slice(0, NOTE_MAX);
    return { amount, date: isDateStr(rawDate) && rawDate <= todayStr ? rawDate : todayStr, ...(note ? { note } : {}) };
  };

  const recordPayment = (e, debt) => {
    e.preventDefault();
    const fields = readPayment(e.target);
    if (!fields) return;
    const { amount } = fields;
    const left = loanRemaining(debt);
    const payment = withAccount({ id: Date.now(), ...fields }, readAccountId(e.target.elements.accountId));
    const after = { ...debt, payments: [...(Array.isArray(debt.payments) ? debt.payments : []), payment] };
    const extra = amount - left;
    commitLoan({
      before: debt,
      after,
      steps: [loanStep(debt, payment, payment.id + 1)],
      message:
        extra >= 0.005
          ? `Settled with ${debt.person}. ${fmt(amount)} paid, ${fmt(extra)} more than was left.`
          : extra > -0.005
            ? `Settled with ${debt.person}, ${fmt(left)} paid.`
            : `${fmt(amount)} paid, ${fmt(left - amount)} left.`
    });
    e.target.reset();
  };

  const savePayment = (e, debt, payment) => {
    e.preventDefault();
    const fields = readPayment(e.target);
    if (!fields) return;
    const { note: _note, ...kept } = payment;
    const next = { ...kept, ...fields };
    const after = { ...debt, payments: debt.payments.map((p) => (p.id === payment.id ? next : p)) };
    const found = findPayEntry(debt, payment);
    const steps = [];
    if (found) {
      const [kind, entry] = found;
      const ours = entry.note === loanEntry(debt, payment).note;
      steps.push([kind, entry, { ...entry, amount: next.amount, date: next.date, ...(ours ? { note: loanEntry(after, next).note } : {}) }]);
    }
    setPayEdit(null);
    commitLoan({ before: debt, after, steps, message: `Payment saved, ${fmt(loanRemaining(after))} left.` });
  };

  const removePayment = (debt, payment) => {
    const after = { ...debt, payments: debt.payments.filter((p) => p.id !== payment.id) };
    const found = findPayEntry(debt, payment);
    setPayEdit(null);
    commitLoan({
      before: debt,
      after,
      steps: found ? [[found[0], found[1], null]] : [],
      message: `Removed the ${fmt(payment.amount)} payment, ${fmt(loanRemaining(after))} left.`
    });
  };

  const accountNameTaken = (name, exceptId) =>
    accounts.some((a) => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase());

  const readBalance = (input, { emptyIsZero = false, allowNegative = false } = {}) => {
    const raw = String(input.value || '').trim();
    if (!raw && emptyIsZero) return 0;
    const negative = /^[-−]/.test(raw);
    const n = parseAmount(raw.replace(/^[-−]\s*/, ''), zeroDecimal);
    if (Number.isNaN(n)) {
      rejectField(input, `Enter a balance, like ${zeroDecimal ? '1500' : '150.00'}.`);
      return null;
    }
    if (negative && n > 0 && !allowNegative) {
      rejectField(input, "A starting balance can't be below zero.");
      return null;
    }
    if (overMax(input, n)) return null;
    return negative ? -n : n;
  };

  const firstAvailablePreset = (type, exceptId, list = accounts) => {
    const presets = ACCOUNT_PRESETS[type] || ACCOUNT_PRESETS.bank;
    return presets.find((n) => !list.some((a) => a.id !== exceptId && a.name.toLowerCase() === n.toLowerCase())) || presets[0];
  };

  const presetForAccount = (type, name) => {
    const list = ACCOUNT_PRESETS[type] || ACCOUNT_PRESETS.bank;
    return list.find((n) => n.toLowerCase() === String(name || '').trim().toLowerCase()) || CUSTOM_PRESET;
  };

  const [addAccountType, setAddAccountType] = useState('bank');
  const [addAccountPreset, setAddAccountPreset] = useState(() => firstAvailablePreset('bank'));
  const [editAccountType, setEditAccountType] = useState('bank');
  const [editAccountPreset, setEditAccountPreset] = useState(CUSTOM_PRESET);

  const resetAddAccountDraft = (type = 'bank', list = accounts) => {
    setAddAccountType(type);
    setAddAccountPreset(firstAvailablePreset(type, undefined, list));
  };

  const startEditAccount = (acc) => {
    setEditAccountType(acc.type);
    setEditAccountPreset(presetForAccount(acc.type, acc.name));
    setRowEdit({ list: 'accounts', id: acc.id });
  };

  const readAccountName = (form, preset, exceptId) => {
    const isCustom = preset === CUSTOM_PRESET;
    const targetInput = isCustom ? form.elements.name : form.elements.preset;
    const raw = isCustom ? form.elements.name?.value : preset;
    const name = String(raw || '').trim().slice(0, NAME_MAX);
    if (!name) {
      rejectField(targetInput, 'Enter a name.');
      return null;
    }
    if (accountNameTaken(name, exceptId)) {
      rejectField(targetInput, `You already have an account called ${name}.`);
      return null;
    }
    return name;
  };

  const handleAddAccount = (e) => {
    e.preventDefault();
    const form = e.target;
    const name = readAccountName(form, addAccountPreset);
    if (!name) return;
    const balance = readBalance(form.elements.balance, { emptyIsZero: true });
    if (balance === null) return;
    const account = { id: Date.now(), name, type: addAccountType === 'ewallet' ? 'ewallet' : 'bank', balance };
    const nextAccounts = [...accounts, account];
    setData((d) => (d.accounts.some((a) => a.id === account.id) ? d : { ...d, accounts: [...d.accounts, account] }));
    flashRow(account.id);
    buzz(12);
    askPersist();
    setUndo({
      message: `Added ${name}, starting at ${fmt(balance)}.`,
      restore: () => {
        setData((d) => dropAccount(d, account.id));
        setUndo(null);
      }
    });
    form.reset();
    resetAddAccountDraft('bank', nextAccounts);
    closeAddSheet();
  };

  const saveAccount = (e, acc) => {
    e.preventDefault();
    const form = e.target;
    const name = readAccountName(form, editAccountPreset, acc.id);
    if (!name) return;
    const now = readBalance(form.elements.balance, { allowNegative: true });
    if (now === null) return;
    const balance = round2((Number(acc.balance) || 0) + now - balanceOf(acc));
    if (Math.abs(balance) > AMOUNT_MAX) {
      rejectField(form.elements.balance, `That's too much to track. The most is ${AMOUNT_MAX.toLocaleString('en-US')}.`);
      return;
    }
    const after = { ...acc, name, type: editAccountType === 'ewallet' ? 'ewallet' : 'bank', balance };
    setRowEdit(null);
    if (after.name === acc.name && after.type === acc.type && after.balance === acc.balance) return;
    replaceWithUndo('accounts', acc, after, `Saved ${name}.`);
  };

  const removeAccount = (acc) => {
    const index = accounts.findIndex((a) => a.id === acc.id);
    const links = accountLinks(data, acc.id);
    const linked =
      links.expenses.size +
      links.income.size +
      links.subscriptions.size +
      links.contributions.size +
      links.debts.size +
      links.payments.size;
    const moved = links.transfers.length;
    const parts = [
      linked > 0 ? `${linked} ${linked === 1 ? 'entry' : 'entries'} unlinked` : '',
      moved > 0 ? `${moved} ${moved === 1 ? 'transfer' : 'transfers'} removed` : ''
    ].filter(Boolean);
    strikeOut(acc.id, () => {
      setData((d) => dropAccount(d, acc.id));
      buzz();
      setUndo({
        message: `Removed ${acc.name}.${parts.length > 0 ? ` ${parts.join(', ')}.` : ''}`,
        restore: () => {
          setData((d) => restoreAccount(d, acc, index, links));
          flashRow(acc.id);
          setUndo(null);
        }
      });
    });
  };

  const readTransferForm = (form) => {
    const fromId = readAccountId(form.elements.fromId);
    const toId = readAccountId(form.elements.toId);
    if (fromId === toId) {
      rejectField(
        form.elements.toId,
        fromId === null ? 'Pick at least one account.' : 'Pick two different accounts.'
      );
      return null;
    }
    const amount = parseAmount(form.elements.amount.value, zeroDecimal);
    if (!(amount > 0)) {
      rejectField(form.elements.amount, `Enter how much to move, like ${zeroDecimal ? '500' : '20.00'}.`);
      return null;
    }
    if (overMax(form.elements.amount, amount)) return null;
    const date = form.elements.date.value || todayStr;
    if (date > todayStr) {
      rejectField(form.elements.date, "That date hasn't happened yet.");
      return null;
    }
    return { fromId, toId, amount, date, note: form.elements.note.value.trim().slice(0, NOTE_MAX) };
  };

  const handleTransfer = (e) => {
    e.preventDefault();
    const form = e.target;
    const fields = readTransferForm(form);
    if (!fields) return;
    const { fromId, toId, amount } = fields;
    const transfer = { id: Date.now(), ...fields, time: nowClock() };
    setData((d) => (d.transfers.some((t) => t.id === transfer.id) ? d : { ...d, transfers: [transfer, ...d.transfers] }));
    [transfer.id, fromId, toId].filter(has).forEach(flashRow);
    buzz(12);
    setUndo({
      message: `Transferred ${fmt(amount)} from ${transferSide(fromId)} to ${transferSide(toId)}.`,
      restore: () => {
        setData((d) => ({ ...d, transfers: d.transfers.filter((t) => t.id !== transfer.id) }));
        [fromId, toId].filter(has).forEach(flashRow);
        setUndo(null);
      }
    });
    form.reset();
    closeAddSheet();
  };

  const saveTransfer = (e, transfer) => {
    e.preventDefault();
    const fields = readTransferForm(e.target);
    if (!fields) return;
    setRowEdit(null);
    replaceWithUndo(
      'transfers',
      transfer,
      { ...transfer, ...fields },
      `Saved transfer, ${fmt(fields.amount)} from ${transferSide(fields.fromId)} to ${transferSide(fields.toId)}.`
    );
  };

  const readGoalForm = (form) => {
    const name = form.elements.name.value.trim().slice(0, NAME_MAX);
    const target = parseAmount(form.elements.target.value, zeroDecimal);
    if (!name) {
      rejectField(form.elements.name, 'Enter a name.');
      return null;
    }
    if (!(target > 0)) {
      rejectField(form.elements.target, `Enter what you are saving for, like ${zeroDecimal ? '20000' : '800.00'}.`);
      return null;
    }
    if (overMax(form.elements.target, target)) return null;
    return { name, target };
  };

  const handleAddGoal = (e) => {
    e.preventDefault();
    const fields = readGoalForm(e.target);
    if (!fields) return;
    const id = Date.now();
    const goal = { id, ...fields, createdAt: todayStr, contributions: [] };
    setData((d) => (d.goals.some((g) => g.id === id) ? d : { ...d, goals: [...d.goals, goal] }));
    setOpenGoal(id);
    flashRow(id);
    buzz(12);
    setUndo({
      message: `Started saving for ${fields.name}.`,
      restore: () => {
        setData((d) => ({ ...d, goals: d.goals.filter((g) => g.id !== id) }));
        setOpenGoal(null);
        setUndo(null);
      }
    });
    e.target.reset();
    closeAddSheet();
  };

  const saveGoal = (e, goal) => {
    e.preventDefault();
    const fields = readGoalForm(e.target);
    if (!fields) return;
    setGoalEditId(null);
    replaceWithUndo('goals', goal, { ...goal, ...fields }, `Saved ${fields.name}.`);
  };

  const deleteGoal = (goal) => {
    setGoalEditId(null);
    setOpenGoal(null);
    removeWithUndo('goals', goal, `Deleted ${goal.name}.`);
  };

  const changeContributions = (goalId, change) =>
    setData((d) => ({
      ...d,
      goals: d.goals.map((g) => (g.id === goalId ? { ...g, contributions: change(g.contributions) } : g))
    }));

  const readContributionForm = (form) => {
    const amount = parseAmount(form.elements.amount.value, zeroDecimal);
    if (!(amount > 0)) {
      rejectField(form.elements.amount, `Enter how much to set aside, like ${zeroDecimal ? '500' : '20.00'}.`);
      return null;
    }
    if (overMax(form.elements.amount, amount)) return null;
    const date = form.elements.date.value || todayStr;
    if (date > todayStr) {
      rejectField(form.elements.date, "That date hasn't happened yet.");
      return null;
    }
    return { amount, date, accountId: readAccountId(form.elements.accountId) };
  };

  const handleAddMoney = (e, goal) => {
    e.preventDefault();
    const fields = readContributionForm(e.target);
    if (!fields) return;
    const contribution = withAccount({ id: Date.now(), amount: fields.amount, date: fields.date }, fields.accountId);
    const wasDone = goalProgress(goal).done;
    const nowDone = goalProgress({ ...goal, contributions: [...goal.contributions, contribution] }).done;
    changeContributions(goal.id, (list) => (list.some((c) => c.id === contribution.id) ? list : [...list, contribution]));
    flashRow(goal.id);
    buzz(nowDone && !wasDone ? 30 : 12);
    setUndo({
      message:
        nowDone && !wasDone
          ? `${goal.name} reached. Nicely done.`
          : `Set aside ${fmt(fields.amount)} for ${goal.name}.`,
      restore: () => {
        changeContributions(goal.id, (list) => list.filter((c) => c.id !== contribution.id));
        flashRow(goal.id);
        setUndo(null);
      }
    });
    e.target.reset();
  };

  const saveContribution = (e, goal, contribution) => {
    e.preventDefault();
    const fields = readContributionForm(e.target);
    if (!fields) return;
    const after = withAccount({ ...contribution, amount: fields.amount, date: fields.date }, fields.accountId);
    setContributionEditId(null);
    changeContributions(goal.id, (list) => list.map((c) => (c.id === contribution.id ? after : c)));
    setUndo({
      message: `Saved ${fmt(after.amount)} for ${goal.name}.`,
      restore: () => {
        changeContributions(goal.id, (list) => list.map((c) => (c.id === contribution.id ? contribution : c)));
        setUndo(null);
      }
    });
  };

  const removeContribution = (goal, contribution) => {
    const index = goal.contributions.findIndex((c) => c.id === contribution.id);
    setContributionEditId(null);
    changeContributions(goal.id, (list) => list.filter((c) => c.id !== contribution.id));
    setUndo({
      message: `Took ${fmt(contribution.amount)} out of ${goal.name}.`,
      restore: () => {
        changeContributions(goal.id, (list) => {
          if (list.some((c) => c.id === contribution.id)) return list;
          const next = [...list];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, contribution);
          return next;
        });
        setUndo(null);
      }
    });
  };

  const contributionFields = (c) => (
    <>
      <label className="field amount">
        <span>Amount</span>
        <input name="amount" type="text" inputMode="decimal" defaultValue={c?.amount} placeholder={zeroDecimal ? '0' : '0.00'} autoComplete="off" required onInput={numericLock} />
      </label>
      <label className="field date">
        <span>On</span>
        <input name="date" type="date" defaultValue={c?.date || todayStr} max={todayStr} required />
      </label>
      {accountField(c ? c.accountId : defaultAccountId, 'Taken from')}
    </>
  );

  const sideValue = (id) => (has(id) ? String(id) : '');

  const transferDefaults = {
    fromId: accounts.length > 1 ? accounts[0].id : null,
    toId: accounts[accounts.length > 1 ? 1 : 0]?.id ?? null,
    amount: '',
    note: '',
    date: todayStr
  };

  const sideOptions = () => (
    <>
      <option value="">Cash</option>
      {accounts.map((a) => (
        <option key={a.id} value={String(a.id)}>
          {a.name}
        </option>
      ))}
    </>
  );

  const transferFields = (t) => (
    <>
      <label className="field grow">
        <span>From</span>
        <select name="fromId" defaultValue={sideValue(t.fromId)} autoFocus>
          {sideOptions()}
        </select>
      </label>
      <label className="field grow">
        <span>To</span>
        <select name="toId" defaultValue={sideValue(t.toId)}>
          {sideOptions()}
        </select>
      </label>
      <label className="field amount">
        <span>Amount</span>
        <input name="amount" type="text" inputMode="decimal" defaultValue={t.amount} placeholder={zeroDecimal ? '0' : '0.00'} autoComplete="off" required onInput={numericLock} />
      </label>
      <label className="field">
        <span>Date</span>
        <input name="date" type="date" defaultValue={t.date} max={todayStr} required />
      </label>
      <label className="field grow-full">
        <span>Note</span>
        <input name="note" type="text" defaultValue={t.note} placeholder="Optional" autoComplete="off" maxLength={NOTE_MAX} />
      </label>
    </>
  );

  const clearTransferValidity = (e) => {
    const { fromId, toId } = e.currentTarget.elements;
    fromId.setCustomValidity('');
    toId.setCustomValidity('');
  };

  const commitSettings = (patch) => {
    setData((d) => {
      const cur = d.settings;
      const next = { ...cur, ...patch };
      const oldDaily = Number(cur.dailyBudget) || 0;
      const newDaily = Number(next.dailyBudget) || 0;
      const rateChanged =
        newDaily !== oldDaily ||
        (next.skipWeekends === true) !== (cur.skipWeekends === true) ||
        (next.resetCarryMonthly === true) !== (cur.resetCarryMonthly === true) ||
        (next.resetCarryMonthly === true && clampStartDay(next.monthStartDay) !== clampStartDay(cur.monthStartDay));
      if (rateChanged) {
        const live = computeBudget({
          settings: cur,
          expenses: d.expenses,
          income: d.income,
          todayStr
        });
        next.dailyRolloverStartDate = todayStr;
        next.rolloverBase = oldDaily > 0 && newDaily > 0 ? round2(live.rolloverCarryover) : 0;
        if (!(newDaily > 0)) next.dailyBudgetSince = null;
        else if (!(oldDaily > 0)) next.dailyBudgetSince = todayStr;
        else if (!isDateStr(cur.dailyBudgetSince)) next.dailyBudgetSince = live.start;
      }
      return JSON.stringify(next) === JSON.stringify(cur) ? d : { ...d, settings: next };
    });
    setStampKey((k) => k + 1);
  };

  const saveSettingsForm = (form) => {
    const fd = new FormData(form);
    const currency = fd.get('currency') || '$';
    const zero = ZERO_DECIMAL_CURRENCIES.has(currency);
    const readMoney = (name) => {
      const raw = String(fd.get(name) || '').trim();
      if (!raw) return 0;
      const n = parseAmount(raw, zero);
      if (Number.isNaN(n)) {
        rejectField(form.elements[name], 'Enter an amount, or leave it empty.');
        return null;
      }
      if (overMax(form.elements[name], n)) return null;
      return n;
    };
    const monthly = readMoney('monthlyBudget');
    if (monthly === null) return;
    const daily = readMoney('dailyBudget');
    if (daily === null) return;
    const thresholdInput = form.elements.alertThreshold;
    if (!thresholdInput.checkValidity()) {
      if (thresholdInput.closest('[hidden]')) {
        setData((d) => ({ ...d, prefs: { ...d.prefs, budgetMoreOpen: true } }));
        requestAnimationFrame(() => thresholdInput.reportValidity());
      } else {
        thresholdInput.reportValidity();
      }
      return;
    }
    const patch = {
      currency,
      monthlyBudget: monthly,
      dailyBudget: daily,
      skipWeekends: fd.get('budgetDays') === 'weekdays',
      alertThreshold: Math.min(100, Math.max(50, Number(fd.get('alertThreshold')) || 80)),
      monthStartDay: clampStartDay(fd.get('monthStartDay')),
      resetCarryMonthly: fd.get('carryMonths') === 'fresh'
    };
    const cur = data.settings;
    const saved = {
      currency: cur.currency || '$',
      monthlyBudget: Number(cur.monthlyBudget) || 0,
      dailyBudget: Number(cur.dailyBudget) || 0,
      skipWeekends: cur.skipWeekends === true,
      alertThreshold: Number(cur.alertThreshold) || 80,
      monthStartDay: clampStartDay(cur.monthStartDay),
      resetCarryMonthly: cur.resetCarryMonthly === true
    };
    if (Object.keys(patch).every((k) => patch[k] === saved[k])) return;
    commitSettings(patch);
    say('Saved.');
  };

  const onSettingsBlur = (e) => {
    if (e.target.matches('input[type="text"], input[type="number"]')) saveSettingsForm(e.currentTarget);
  };
  const onSettingsChange = (e) => {
    if (e.target.matches('select, input[type="radio"]')) saveSettingsForm(e.currentTarget);
  };

  const applySuggestedDaily = (form) => {
    if (form) {
      form.elements.dailyBudget.value = perDayLeft;
      form.elements.dailyBudget.setCustomValidity('');
      saveSettingsForm(form);
    } else {
      commitSettings({ dailyBudget: perDayLeft });
      say(`Daily budget set to ${fmt(perDayLeft)}.`);
    }
  };

  const download = (content, type, name) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  };

  const saveFile = async (content, type, name) => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse && typeof File === 'function' && navigator.canShare) {
      const file = new File([content], name, { type });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return true;
        } catch (err) {
          if (err?.name === 'AbortError') return false;
        }
      }
    }
    download(content, type, name);
    return true;
  };

  const exportCSV = () => {
    if (historyAll.length + data.transfers.length === 0) return say('Nothing to export yet.');
    setFileBusy('csv');
    saveFile(
      buildCsv(historyAll, { accounts, transfers: transfersByWhen, todayStr }),
      'text/csv;charset=utf-8;',
      `stdynt-expenses-${todayStr}.csv`
    ).finally(() => setFileBusy(null));
  };

  const exportJSON = () => {
    const json = JSON.stringify({ ...data, exportedAt: todayStr }, null, 2);
    setFileBusy('backup');
    saveFile(json, 'application/json', `stdynt-backup-${todayStr}.json`)
      .then((saved) => {
        if (saved) setData((d) => ({ ...d, prefs: { ...d.prefs, lastBackup: todayStr } }));
      })
      .finally(() => setFileBusy(null));
  };

  const [ask, setAsk] = useState(null);
  const askRef = useRef(null);
  const [loanKind, setLoanKind] = useState('i_owe');
  const [loanOrigin, setLoanOrigin] = useState('new');
  const [subOrigin, setSubOrigin] = useState('new');
  const [transfersAll, setTransfersAll] = useState(false);
  useEffect(() => {
    if (ask && askRef.current && !askRef.current.open) askRef.current.showModal();
  }, [ask]);
  const closeAsk = () => askRef.current?.close();

  const [introStep, setIntroStep] = useState(1);
  const [introCurrency, setIntroCurrency] = useState('$');
  const [introAmount, setIntroAmount] = useState('');
  const [introError, setIntroError] = useState('');
  const [introSaved, setIntroSaved] = useState(null);
  const introRef = useRef(null);
  const firstRun =
    !data.prefs.onboarded &&
    !storageCorrupted &&
    view === 'today' &&
    !(data.settings.monthlyBudget > 0) &&
    !(data.settings.dailyBudget > 0) &&
    data.expenses.length + data.income.length === 0;

  useEffect(() => {
    if (!firstRun || introRef.current?.open || sheetRef.current?.open || askRef.current?.open) return;
    setIntroStep(1);
    setIntroAmount('');
    setIntroError('');
    setIntroSaved(null);
    setIntroCurrency(data.settings.currency || '$');
    introRef.current?.showModal();
    requestAnimationFrame(() => introRef.current?.querySelector('.btn.ink')?.focus());
  }, [firstRun, data.settings.currency]);

  const skipIntro = () => {
    setData((d) => ({ ...d, prefs: { ...d.prefs, onboarded: true } }));
    introRef.current?.close();
  };

  const introZero = ZERO_DECIMAL_CURRENCIES.has(introCurrency);
  const introMonthly = parseAmount(introAmount, introZero);
  const introDaily = suggestDaily(introMonthly, daysLeftInPeriod, introZero);
  const introMoney = (n, currency = introCurrency) => `${currency}${formatNumber(n, currency)}`;

  const finishIntroSetup = (e) => {
    e.preventDefault();
    if (!(introMonthly > 0)) {
      setIntroError('Enter your monthly allowance.');
      return;
    }
    if (introMonthly > AMOUNT_MAX) {
      setIntroError(`That's too much to track. The most is ${AMOUNT_MAX.toLocaleString('en-US')}.`);
      return;
    }
    if (!(introDaily > 0)) {
      setIntroError('That allowance is too small to spread across the days left. Enter a bigger amount, or set it up in Settings.');
      return;
    }
    commitSettings({ currency: introCurrency, monthlyBudget: introMonthly, dailyBudget: introDaily });
    setData((d) => ({ ...d, prefs: { ...d.prefs, onboarded: true } }));
    setIntroSaved({ currency: introCurrency, daily: introDaily });
    setIntroError('');
    setIntroStep(3);
  };

  const leaveIntro = (logFirst) => {
    introRef.current?.close();
    if (logFirst) openSheet();
  };

  const BACKUP_MAX_BYTES = 5 * 1024 * 1024;

  const importJSON = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) {
      say("That file is too big to be a stdynt backup.", true);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => say("Couldn't read that file. Choose a stdynt .json backup.", true);
    reader.onload = (evt) => {
      let parsed;
      try {
        parsed = JSON.parse(evt.target.result);
      } catch {
        say("Couldn't read that file. Choose a stdynt .json backup.", true);
        return;
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        say("That file isn't a valid stdynt backup.", true);
        return;
      }
      const { clean } = readState(parsed, todayStr);
      const { dropped, ...lists } = clean;
      const incoming = lists.expenses.length + lists.income.length;
      const entries = `${incoming} ${incoming === 1 ? 'entry' : 'entries'}`;
      const leftOut = dropped > 0 ? ` ${dropped} couldn't be read and ${dropped === 1 ? 'was' : 'were'} left out.` : '';

      const before = data;
      const apply = () => {
        setData((d) => ({
          ...lists,
          categories: normalizeCategories(parsed.categories, lists.expenses),
          prefs: { ...d.prefs, onboarded: true }
        }));
        setSettingsFormKey((k) => k + 1);
        setStampKey((k) => k + 1);
        if (storageCorrupted) {
          setStorageCorrupted(false);
          setUndo(null);
          say(`Backup restored.${leftOut}`);
        } else {
          setUndo({
            message: `Backup restored, ${entries}.${leftOut}`,
            restore: () => {
              setData((d) => ({ ...before, prefs: d.prefs }));
              setSettingsFormKey((k) => k + 1);
              setStampKey((k) => k + 1);
              setUndo(null);
            }
          });
        }
      };

      const here = data.expenses.length + data.income.length;
      if (storageCorrupted || here + data.subscriptions.length + data.goals.length + data.debts.length + accounts.length === 0) {
        apply();
        return;
      }
      const when = isDateStr(parsed.exportedAt) ? ` from ${shortDay(parsed.exportedAt)}` : '';
      const ours = here > 0 ? `the ${here} on this phone` : "what's on this phone";
      setAsk({
        title: `Restore the backup${when}?`,
        body: `Its ${entries} ${incoming === 1 ? 'replaces' : 'replace'} ${ours}. You can undo this straight after.`,
        confirmLabel: 'Restore',
        cancelLabel: 'Cancel',
        danger: false,
        onConfirm: apply
      });
    };
    reader.readAsText(file);
  };

  const startFresh = (question, doneMessage) =>
    setAsk({
      ...question,
      danger: true,
      onConfirm: () => {
        try {
          localStorage.removeItem(STORAGE_KEY);
          localStorage.removeItem(UNREADABLE_KEY);
        } catch {
        }
        setData(makeDefaultState());
        setStorageCorrupted(false);
        setUndo(null);
        setSettingsFormKey((k) => k + 1);
        say(doneMessage);
      }
    });

  const noBudget = !hasDaily && monthlyBudget <= 0;
  const fallbackIncome = incomeMonthly - spentMonthlyExpenses + movedMonthly;
  const showWell = hasDaily || (noBudget && incomeMonthly > 0);
  const wellAvailable = hasDaily ? availableToday : fallbackIncome;
  const isNeg = wellAvailable < 0;
  const formattedTodayAbs = formatNumber(Math.abs(wellAvailable), sym);
  const wellPool = availableToday + spentToday;
  const summaryLabel = hasDaily
    ? [
        `${weekendOff ? 'Weekend' : 'Daily'} ${fmt(dailyToday)}`,
        `${rolloverCarryover < 0 ? 'minus' : 'plus'} carried ${fmt(Math.abs(rolloverCarryover))}`,
        ...(earnedToday > 0 ? [`plus income ${fmt(earnedToday)}`] : []),
        `minus spent ${fmt(spentToday)}`
      ].join(', ')
    : `Income ${fmt(incomeMonthly)}`;
  const monthlyLevel =
    monthlyBudget > 0
      ? monthAvailable > 0
        ? Math.min(1, Math.max(0, remainingMonthly / monthAvailable))
        : 0
      : null;
  const wellLevel = showWell
    ? monthlyLevel !== null
      ? monthlyLevel.toFixed(4)
      : hasDaily
        ? availableToday > 0 && wellPool > 0
          ? Math.min(1, availableToday / wellPool).toFixed(4)
          : 0
        : incomeMonthly > 0
          ? Math.min(1, Math.max(0, fallbackIncome / incomeMonthly)).toFixed(4)
          : 0
    : 0;
  const stampDigitsClass =
    formattedTodayAbs.length > 9 ? 'digits-xl' : formattedTodayAbs.length > 6 ? 'digits-lg' : '';

  const togglePick = (cat) => {
    setPickedCat((p) => (p === cat ? null : cat));
    if (!data.prefs.sliceTapped) setData((d) => ({ ...d, prefs: { ...d.prefs, sliceTapped: true } }));
  };

  const renderDonut = () => {
    const radius = 62;
    const circum = 2 * Math.PI * radius;
    const gap = pieEntries.length > 1 ? 2.5 : 0;
    const ringR = 84;
    const ringScale = ringR / radius;
    let ring = null;
    let offset = 0;
    const slices = pieEntries.map(([cat, amt]) => {
      const len = (amt / pieTotal) * circum;
      const dash = Math.max(0.5, len - gap);
      const focused = pieFocus === cat;
      if (focusCat === cat) {
        ring = (
          <circle
            key="focus-ring"
            className="slice-focus"
            cx="80"
            cy="80"
            r={ringR}
            fill="none"
            strokeDasharray={`${dash * ringScale} ${2 * Math.PI * ringR}`}
            strokeDashoffset={-offset * ringScale}
            transform="rotate(-90 80 80)"
            aria-hidden="true"
          />
        );
      }
      const el = (
        <circle
          key={cat}
          className={`slice ${focused ? 'on' : ''} ${pieFocus && !focused ? 'off' : ''}`}
          style={{ stroke: colorOf(cat) }}
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          strokeDasharray={`${dash} ${circum - dash}`}
          strokeDashoffset={-offset}
          transform="rotate(-90 80 80)"
          tabIndex={0}
          role="button"
          aria-pressed={pickedCat === cat}
          aria-label={`${cat}: ${fmt(amt)}, ${((amt / pieTotal) * 100).toFixed(0)}%`}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHoverCat(cat)}
          onPointerLeave={() => setHoverCat(null)}
          onClick={() => togglePick(cat)}
          onFocus={(e) => e.currentTarget.matches(':focus-visible') && setFocusCat(cat)}
          onBlur={() => setFocusCat(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              togglePick(cat);
            }
          }}
        />
      );
      const hit = (
        <circle
          key={`${cat}-hit`}
          className="slice-hit"
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke="transparent"
          strokeDasharray={`${dash} ${circum - dash}`}
          strokeDashoffset={-offset}
          transform="rotate(-90 80 80)"
          aria-hidden="true"
          focusable="false"
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHoverCat(cat)}
          onPointerLeave={() => setHoverCat(null)}
          onClick={() => togglePick(cat)}
        />
      );
      offset += len;
      return [el, hit];
    });
    return ring ? [...slices, ring] : slices;
  };

  const isSettings = view === 'settings';
  const earlierOpen = data.prefs.earlierOpen ?? false;
  const wide = isWideScreen();
  const budgetMoreOpen = data.prefs.budgetMoreOpen ?? wide;
  const historyToolsOpen = data.prefs.historyToolsOpen ?? false;
  const historyToolsOn = historyCat !== '' || historySort !== 'date';
  const setPref = (key, value) => setData((d) => ({ ...d, prefs: { ...d.prefs, [key]: value } }));
  const toggleMore = (key) => setLoanMore((m) => ({ ...m, [key]: !m[key] }));
  const whenLabel = (() => {
    const d = sheetDate || todayStr;
    const day =
      d === todayStr
        ? 'Today'
        : parseDate(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return sheetTime ? `${day}, ${sheetTime}` : day;
  })();
  const TRANSFERS_SHOWN = 5;
  const accountSplit =
    accounts.length > 2 && accounts.some((a) => a.type === 'ewallet') && accounts.some((a) => a.type !== 'ewallet');
  const fabTarget = ADD_FORMS[view];

  return (
    <div className={`app view-${view}`}>
      <header className={`topbar ${scrolled ? 'is-scrolled' : ''}`}>
        {isSettings ? (
          <a
            className="icon-btn back-btn"
            href={`#/${lastMoneyViewRef.current}`}
            onClick={onBackClick}
            aria-label={`Back to ${MONEY_VIEWS.find((v) => v.id === lastMoneyViewRef.current)?.label || 'Today'}`}
            aria-keyshortcuts="Escape"
            title="Back (Esc)"
          >
            <ArrowLeft size={22} strokeWidth={2} aria-hidden="true" />
          </a>
        ) : (
          <span className="brand">stdynt</span>
        )}
        <span className={view === 'today' && hasDaily ? 'sr-only' : 'topbar-date'}>
          {parseDate(todayStr).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
        {!isSettings && (
          <a
            className="icon-btn settings-btn"
            href="#/settings"
            aria-label="Settings"
            aria-keyshortcuts=","
            title="Settings (,)"
          >
            <Settings size={22} strokeWidth={2} aria-hidden="true" />
          </a>
        )}
      </header>

      <div className="rail">
        {fabTarget && fabTarget[0] === 'add-accounts' && (
          <>
            {fabOpen && (
              <div className="fab-actions">
                <button
                  type="button"
                  className="fab-action"
                  onClick={() => {
                    setFabOpen(false);
                    openAddSheet('account');
                  }}
                  aria-label="Add account"
                >
                  <Wallet size={20} strokeWidth={2} aria-hidden="true" />
                  <span>Add account</span>
                </button>
                <button
                  type="button"
                  className="fab-action"
                  onClick={() => {
                    setFabOpen(false);
                    openAddSheet('transfer');
                  }}
                  aria-label="Transfer money"
                >
                  <ArrowLeftRight size={20} strokeWidth={2} aria-hidden="true" />
                  <span>Transfer</span>
                </button>
                <button
                  type="button"
                  className="fab-action"
                  onClick={() => {
                    setFabOpen(false);
                    openAddSheet('goal');
                  }}
                  aria-label="New savings goal"
                >
                  <PiggyBank size={20} strokeWidth={2} aria-hidden="true" />
                  <span>Savings goals</span>
                </button>
              </div>
            )}
            <button
              className="fab compact"
              onClick={() => setFabOpen((o) => !o)}
              aria-label={fabOpen ? 'Close add menu' : fabTarget[1]}
              aria-expanded={fabOpen}
              aria-keyshortcuts="N"
            >
              {fabOpen ? (
                <X size={22} strokeWidth={2.5} aria-hidden="true" />
              ) : (
                <Plus size={22} strokeWidth={2.5} aria-hidden="true" />
              )}
              {!fabOpen && <kbd className="nav-kbd" aria-hidden="true">N</kbd>}
            </button>
          </>
        )}
        {fabTarget && fabTarget[0] !== 'add-accounts' && (
          <button
            className="fab compact"
            onClick={() => (view === 'today' ? openSheet() : openAddSheet())}
            aria-label={fabTarget[1]}
            aria-keyshortcuts="N"
          >
            <Plus size={22} strokeWidth={2.5} aria-hidden="true" />
            <kbd className="nav-kbd" aria-hidden="true">N</kbd>
          </button>
        )}
        <nav className="bottom-nav" aria-label="Money">
          {MONEY_VIEWS.map(({ id, label, Icon }, i) => (
            <a
              key={id}
              href={`#/${id}`}
              onClick={(e) => onNavClick(e, id)}
              aria-current={view === id ? 'page' : undefined}
              aria-keyshortcuts={String(i + 1)}
              aria-label={label}
            >
              {view === id && <span className="nav-ink" aria-hidden="true" />}
              <span className="nav-icon">
                <Icon size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="nav-label">{label}</span>
              <kbd className="nav-kbd" aria-hidden="true">{i + 1}</kbd>
            </a>
          ))}
        </nav>
      </div>

      <main className="main">
        {storageCorrupted && (
          <div className="slip over storage-slip" role="alert">
            <TriangleAlert size={18} strokeWidth={2.25} aria-hidden="true" />
            <div className="slip-body">
              <p>
                Saved data couldn't be read, so changes aren't being saved. Restore a backup or erase and start over.
              </p>
              <div className="slip-actions">
                <label className="btn outline">
                  <Upload size={16} strokeWidth={2} aria-hidden="true" /> Restore backup
                  <input type="file" accept=".json,application/json" onChange={importJSON} className="sr-only" />
                </label>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() =>
                    startFresh(
                      {
                        title: 'Erase and start over?',
                        body: 'The saved data that could not be read will be lost.',
                        confirmLabel: 'Erase and start over',
                        cancelLabel: 'Cancel'
                      },
                      'Erased. Saving again.'
                    )
                  }
                >
                  Erase and start over
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="live-slot" role="status">
          {!isSettings && view !== 'today' && isOverAlert && (
            <div className={`slip ${monthState}`}>
              <TriangleAlert size={18} strokeWidth={2.25} aria-hidden="true" />
              <span>
                {monthState === 'over'
                  ? `Over ${periodPossessive} budget by ${fmt(-remainingMonthly)}.`
                  : `${percentMonthlyUsed.toFixed(0)}% of ${periodPossessive} budget used, ${fmt(remainingMonthly)} left.`}
              </span>
            </div>
          )}
        </div>

        <div className={`view-pane pane-${view}`} key={view}>
          {view === 'today' && (
            <>
              <div className="today-col">
                <section className="card day-card" aria-labelledby="today-label">
                  <div className="today">
                    <div className={`well ${showWell && isNeg ? 'debt' : ''}`} style={{ '--level': wellLevel }}>
                    {showWell && wellReady && (
                      <React.Suspense fallback={null}>
                        <LiquidWell level={Number(wellLevel)} />
                      </React.Suspense>
                    )}
                    <h1 id="today-label" className="today-label">
                      {!showWell ? 'Set your daily budget' : isNeg ? 'Over today by' : 'You can spend today'}
                    </h1>

                    {!showWell ? (
                      <div className="budget-setup-box">
                        <p>
                          {!hasBudgetSet
                            ? 'Add your allowance to see what you can spend each day.'
                            : perDayLeft > 0
                              ? `${fmt(perDayLeft)} a day lasts until ${periodLastDay}.`
                              : 'Choose how much of your monthly budget to spend each day.'}
                        </p>
                        <div className="setup-actions">
                          {hasBudgetSet && perDayLeft > 0 && (
                            <button type="button" className="btn ink" onClick={() => applySuggestedDaily(null)}>
                              Use {fmt(perDayLeft)} a day
                            </button>
                          )}
                          <a className={`btn ${hasBudgetSet && perDayLeft > 0 ? 'outline' : 'ink'}`} href="#/settings">
                            {hasBudgetSet && perDayLeft > 0 ? 'Choose my own' : 'Set up budget'}
                          </a>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div
                          key={stampKey}
                          className={`stamp ${isNeg ? 'debt' : ''} ${stampDigitsClass} ${stampKey ? 'pressed' : ''}`}
                        >
                          <span className="sr-only">{fmt(Math.abs(wellAvailable))}</span>
                          <span className="stamp-sym" aria-hidden="true">{sym}</span>
                          <StampFigure value={wellAvailable} sym={sym} />
                        </div>
                        <span className="date-stamp" aria-hidden="true">{stampDate(todayStr)}</span>
                      </>
                    )}
                    </div>
                    {hasDaily ? (
                      <>
                        <p className="sr-only">{summaryLabel}.</p>
                        <dl className="math today-math" aria-hidden="true">
                          <div>
                            <dt>{weekendOff ? 'Weekend' : 'Daily'}</dt>
                            <dd><Money value={dailyToday} sym={sym} /></dd>
                          </div>
                          <div>
                            <dt>Carried</dt>
                            <dd className={rolloverCarryover < 0 ? 'neg' : 'pos'}>
                              <Money value={rolloverCarryover} sym={sym} />
                            </dd>
                          </div>
                          <div>
                            <dt>Income</dt>
                            <dd className={earnedToday > 0 ? 'pos' : ''}><Money value={earnedToday} sym={sym} /></dd>
                          </div>
                          <div>
                            <dt>Spent</dt>
                            <dd><Money value={spentToday} sym={sym} /></dd>
                          </div>
                        </dl>
                      </>
                    ) : showWell && (
                      <>
                        <p className="sr-only">{summaryLabel}.</p>
                        <dl className="math today-math single" aria-hidden="true">
                          <div>
                            <dt>Income</dt>
                            <dd><Money value={incomeMonthly} sym={sym} /></dd>
                          </div>
                        </dl>
                      </>
                    )}
                    </div>

                  <div className="ledger">
                    {todaysEntries.map((exp) => (
                      <div key={exp.id} className="ledger-row today-row" data-row={exp.id}>
                        <button
                          type="button"
                          className="row-open"
                          onClick={() => openSheet(exp)}
                          aria-label={`Edit ${entryLabel(exp)}, ${entryAmount(exp)}`}
                        >
                          <span className="d">{entryStamp(exp, todayStr)}</span>
                          <span className="what">{entryLabel(exp)}</span>
                          <span className={`n ${exp.kind === 'income' ? 'pos' : ''}`}>{entryAmount(exp)}</span>
                        </button>
                        <button
                          className="row-del"
                          onClick={() => deleteExpense(exp)}
                          aria-label={`Delete ${entryLabel(exp)}, ${entryAmount(exp)}`}
                        >
                          <X size={16} strokeWidth={2.25} />
                        </button>
                      </div>
                    ))}
                    {dayRows.length > 0 && (
                      <button
                        type="button"
                        className={`ledger-head ledger-fold ${todaysEntries.length > 0 ? 'ledger-sub' : ''} ${earlierOpen ? 'is-open' : ''}`}
                        aria-expanded={earlierOpen}
                        aria-controls="earlier-days"
                        aria-label="Earlier days"
                        onClick={() => setData((d) => ({ ...d, prefs: { ...d.prefs, earlierOpen: !earlierOpen } }))}
                      >
                        <span>Earlier</span>
                        <span className="fold-chev">
                          <ChevronDown size={16} strokeWidth={2.25} aria-hidden="true" />
                        </span>
                        {earlierOpen && (
                          <>
                            <span>Spent</span>
                            <span>Carried</span>
                          </>
                        )}
                      </button>
                    )}
                    <div id="earlier-days" hidden={!earlierOpen}>
                    {earlierOpen && [...dayRows.filter((r) => !r.base).slice(0, 7), ...dayRows.filter((r) => r.base)].map((row) => (
                      <div key={row.date} className={`ledger-row past ${row.base ? 'base-row' : ''}`}>
                        <span className="d">{row.base ? 'BEFORE' : stampDate(row.date)}</span>
                        <span className="what">{row.what}</span>
                        <span className="n">{row.base ? '' : fmt(row.spent)}</span>
                        <span className={`mini-stamp ${row.carried < 0 ? 'debt' : ''}`}>
                          <span className="sr-only">{row.carried < 0 ? 'Debt carried ' : 'Carried '}</span>
                          {signed(row.carried)}
                        </span>
                      </div>
                    ))}
                    </div>
                    {hasDaily && todaysEntries.length === 0 && dayRows.length === 0 && (
                      <p className="ledger-empty">
                        First day. Whatever you don't spend carries to tomorrow.
                      </p>
                    )}
                  </div>
                  <div className={`month ${monthState}`}>
                    <div className="month-line">
                      <span className="month-name">
                        {periodName}{monthlyBudget > 0 ? ' budget' : ' spending'}
                      </span>
                      <span className="month-pct">
                        {monthlyBudget > 0 ? (
                          <><b>{percentMonthlyUsed.toFixed(0)}%</b> used</>
                        ) : (
                          <><b>{fmt(totalMonthlyCommitted)}</b> spent</>
                        )}
                      </span>
                    </div>
                    {monthlyBudget > 0 && (
                      <div className="month-bar" aria-hidden="true">
                        <i style={{ '--pct': Math.min(100, Math.max(0, percentMonthlyUsed)) / 100 }} />
                        <b style={{ left: `${alertThresh}%` }} />
                      </div>
                    )}
                    {monthlyBudget > 0 && (
                      <p className="month-sub">
                        <span className="month-figure">
                          <span className="num">{fmt(totalMonthlyCommitted)}</span> of{' '}
                          <span className="num">{fmt(monthAvailable)}</span>
                        </span>
                        <span className="month-figure">
                          <span className="num">{fmt(Math.abs(remainingMonthly))}</span> {remainingMonthly < 0 ? 'over' : 'left'}
                        </span>
                        {remainingMonthly >= 0 && perDayLeft > 0 && daysLeftInPeriod > 1 && (
                          <span className="month-figure"><span className="num">{fmt(perDayLeft)}</span> a day</span>
                        )}
                      </p>
                    )}
                  </div>
                </section>
              </div>

              <section className="history" ref={historyNearRef}>
                <div className="section-head">
                  <h2>History</h2>
                </div>
                {!historyNear ? null : historyAll.length === 0 ? (
                  <p className="empty">Nothing logged yet.</p>
                ) : (
                  <>
                    <div className="history-tools" role="search">
                      <label className="hfield hsearch">
                        <span className="sr-only">Search</span>
                        <span className="hsearch-box">
                          <Search size={16} strokeWidth={2.25} aria-hidden="true" />
                          <input
                            type="search"
                            value={historyQuery}
                            onChange={(e) => setHistoryFilter(e.target.value, historyCat)}
                            placeholder="Note or amount"
                            enterKeyHint="search"
                            autoComplete="off"
                          />
                        </span>
                      </label>
                      <button
                        type="button"
                        className={`filters-btn ${historyToolsOpen ? 'is-open' : ''}`}
                        aria-expanded={historyToolsOpen}
                        aria-controls="history-filters"
                        aria-label={historyToolsOn ? 'Show and sort, changed' : 'Show and sort'}
                        title="Show and sort"
                        onClick={() => setPref('historyToolsOpen', !historyToolsOpen)}
                      >
                        <SlidersHorizontal size={20} strokeWidth={2} aria-hidden="true" />
                        {historyToolsOn && <i className="filters-dot" aria-hidden="true" />}
                      </button>
                    </div>
                    <div id="history-filters" className={`history-filters ${historyToolsOpen ? 'is-open' : ''}`}>
                      <label className="hfield">
                        <span>Show</span>
                        <select value={historyCat} onChange={(e) => setHistoryFilter(historyQuery, e.target.value)}>
                          <option value="">Everything</option>
                          <option value={INCOME_FILTER}>Income</option>
                          {filterCats.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                      <fieldset className="sort-seg">
                        <legend className="sr-only">Sort history</legend>
                        {[
                          ['date', 'By date'],
                          ['added', 'Recently added']
                        ].map(([value, label]) => (
                          <label key={value}>
                            <input
                              type="radio"
                              name="historySort"
                              value={value}
                              checked={historySort === value}
                              onChange={() => setHistorySort(value)}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </fieldset>
                    </div>
                    {historyFiltered && (
                      <p className="filter-count" role="status">
                        {historyEntries.length === 0
                          ? 'No matches.'
                          : `${historyEntries.length} ${historyEntries.length === 1 ? 'match' : 'matches'}.`}{' '}
                        <button type="button" className="text-btn" onClick={() => setHistoryFilter('', '')}>
                          Clear
                        </button>
                      </p>
                    )}
                    {historySort === 'date' ? (
                      <ul className="list" ref={dayWindow.setListEl}>
                        {dayWindow.padTop > 0 && (
                          <li className="vpad" aria-hidden="true" style={{ height: dayWindow.padTop }} />
                        )}
                        {historyDaysShown.slice(dayWindow.start, dayWindow.end).map((day, j) => {
                          const i = dayWindow.start + j;
                          const open = dayOpen(day.date);
                          const n = day.entries.length;
                          const panelId = `history-day-${i}`;
                          return (
                            <li key={`${day.date}:${i}`} className="history-day" data-vindex={i}>
                              <button
                                type="button"
                                className="day-head"
                                aria-expanded={open}
                                aria-controls={panelId}
                                onClick={() => toggleDay(day.date)}
                              >
                                <span className="day-name">{historyDayLabel(day.date, todayStr)}</span>
                                <span className="sr-only">
                                  , {n} {n === 1 ? 'entry' : 'entries'}
                                </span>
                                <MoneyFit
                                  sym={sym}
                                  className="num day-total"
                                  parts={[
                                    ...(day.spent > 0 ? [{ value: day.spent }] : []),
                                    ...(day.earned > 0 ? [{ value: day.earned, sign: '+', className: 'day-in' }] : [])
                                  ]}
                                />
                                <ChevronDown className="day-chev" size={18} strokeWidth={2.25} aria-hidden="true" />
                              </button>
                              {open && (
                                <ul className="day-rows" id={panelId}>
                                  {day.entries.map((exp) => renderHistoryRow(exp, true))}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                        {dayWindow.padBottom > 0 && (
                          <li className="vpad" aria-hidden="true" style={{ height: dayWindow.padBottom }} />
                        )}
                      </ul>
                    ) : (
                      <ul className="list" ref={rowWindow.setListEl}>
                        {rowWindow.padTop > 0 && (
                          <li className="vpad" aria-hidden="true" style={{ height: rowWindow.padTop }} />
                        )}
                        {historyRowsShown
                          .slice(rowWindow.start, rowWindow.end)
                          .map((exp, j) => renderHistoryRow(exp, false, rowWindow.start + j))}
                        {rowWindow.padBottom > 0 && (
                          <li className="vpad" aria-hidden="true" style={{ height: rowWindow.padBottom }} />
                        )}
                      </ul>
                    )}
                    {(() => {
                      const [total, step, one, many] =
                        historySort === 'date'
                          ? [historyDays.length, HISTORY_DAYS_STEP, 'day', 'days']
                          : [historyEntries.length, HISTORY_ROWS_STEP, 'entry', 'entries'];
                      const left = total - historyPages * step;
                      if (left <= 0) return null;
                      const next = Math.min(step, left);
                      return (
                        <button type="button" className="more-btn" onClick={() => setHistoryPages((p) => p + 1)}>
                          <span>
                            Show {next} more {next === 1 ? one : many}
                          </span>
                          {left > next && <small>{left} left</small>}
                        </button>
                      );
                    })()}
                  </>
                )}
              </section>
            </>
          )}

          {view === 'categories' && (
            <section className="card pad cat-card">
              <div className="card-title-row">
                <h1>Where it went</h1>
                <span className="num muted">{fmt(pieTotal)}</span>
              </div>
              <div className="period-nav">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!hasEarlierPeriod}
                  onClick={() => goToPeriod(periodOffset - 1)}
                  aria-label="Earlier month"
                >
                  <ChevronLeft size={22} strokeWidth={2.25} aria-hidden="true" />
                </button>
                <span className="period-label" role="status">
                  {viewPeriodName}
                </span>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={periodOffset >= 0}
                  onClick={() => goToPeriod(periodOffset + 1)}
                  aria-label="Later month"
                >
                  <ChevronRight size={22} strokeWidth={2.25} aria-hidden="true" />
                </button>
              </div>
              {periodOffset === 0 && subsPending > 0 && (
                <p className="card-note">
                  Plus <span className="num">{fmt(subsPending)}</span> in subscriptions, counted in the month total.
                </p>
              )}
              {pieTotal <= 0 ? (
                <p className="card-empty">
                  No expenses in {viewPeriodName}
                  {periodOffset === 0 ? ' yet' : ''}.
                </p>
              ) : (
                <div className="cat-layout">
                  <div className="donut-wrap">
                    <svg viewBox="0 0 160 160" className="donut" role="group" aria-label="Spending by category">
                      {renderDonut()}
                      <g className="donut-center" key={pieShown} aria-hidden="true">
                        <text x="80" y="68" textAnchor="middle" className="donut-k">
                          {pieShown.length > 14 ? `${pieShown.slice(0, 12)}…` : pieShown}
                        </text>
                        <text x="80" y="92" textAnchor="middle" className="donut-v">
                          {((pieShownAmt / pieTotal) * 100).toFixed(0)}%
                        </text>
                        <text x="80" y="108" textAnchor="middle" className="donut-a">
                          {fmt(pieShownAmt)}
                        </text>
                      </g>
                    </svg>
                    <p className="donut-hint">
                      {pickedCat && pieHas(pickedCat) ? 'Tap again to clear' : data.prefs.sliceTapped ? '' : 'Tap a slice for details'}
                    </p>
                  </div>
                  <div className="cat-side">
                    <ul className="legend">
                      {pieEntries.map(([cat, amt]) => (
                        <li key={cat} className={pieFocus && pieFocus !== cat ? 'dim' : ''}>
                          <button
                            type="button"
                            className="legend-btn"
                            aria-pressed={pickedCat === cat}
                            onClick={() => togglePick(cat)}
                            onPointerEnter={(e) => e.pointerType === 'mouse' && setHoverCat(cat)}
                            onPointerLeave={() => setHoverCat(null)}
                          >
                            <span className="cat-dot" style={{ background: colorOf(cat) }} />
                            <span className="legend-name">{cat}</span>
                            <span className="num">{fmt(amt)}</span>
                            <span className="num legend-pct">{((amt / pieTotal) * 100).toFixed(0)}%</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    {pickedExpenses.length > 0 && (
                      <div className="picked" key={pickedCat}>
                        <h2>
                          {pickedCat} <span className="num muted">· {pickedExpenses.length}</span>
                        </h2>
                        <ul className="card-list">
                          {pickedExpenses.slice(0, 8).map((exp) => (
                            <li key={exp.id}>
                              <button type="button" className="row-open" onClick={() => openSheet(exp)}>
                                <span className="grow">
                                  {exp.note || exp.category}
                                  <small className="muted">{entryStamp(exp, todayStr)}</small>
                                </span>
                                <span className="num">{fmt(exp.amount)}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                        {pickedExpenses.length > 8 && (
                          <p className="card-note">+{pickedExpenses.length - 8} more</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {data.expenses.length > 0 && (
                <div className="trend" ref={trendNearRef}>
                  <h2>Last {TREND_PERIODS} months</h2>
                  {trendNear && (
                  <ol className="trend-bars">
                    {trend.map((t, i) => {
                      const offset = i - (trend.length - 1);
                      const chosen = offset === periodOffset;
                      const share = trendMax > 0 ? (t.total / trendMax) * TREND_FILL_SHARE : 0;
                      return (
                        <li key={t.start}>
                          <button
                            type="button"
                            className={`trend-bar ${chosen ? 'on' : ''}`}
                            aria-pressed={chosen}
                            aria-label={`${periodLabel(t)}: ${fmt(t.total)}`}
                            onClick={() => goToPeriod(offset)}
                          >
                            <span className="trend-track">
                              <span className="trend-amt num" aria-hidden="true">
                                {t.total > 0 ? compactAmount(t.total) : ''}
                              </span>
                              <span className="trend-fill" style={{ '--i': i, height: `${t.total > 0 ? Math.max(share, 3) : 0}%` }} />
                              {monthlyBudget > 0 && (
                                <span
                                  className="trend-goal"
                                  style={{ bottom: `${(monthlyBudget / trendMax) * TREND_FILL_SHARE}%` }}
                                />
                              )}
                            </span>
                            <span className="trend-month">
                              {parseDate(t.start).toLocaleDateString('en-GB', { month: 'short' })}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  )}
                  {monthlyBudget > 0 && <p className="card-note">The dashed line is your monthly budget.</p>}
                </div>
              )}
            </section>
          )}

          {view === 'subs' && (
            <section className="card pad">
              <div className="card-title-row">
                <h1>Subscriptions</h1>
                {data.subscriptions.length === 0 ? (
                  <p className="card-empty">No subscriptions yet.</p>
                ) : (
                  <span className="num muted">{fmt(subsMonthly)} / month</span>
                )}
              </div>
              {data.subscriptions.length > 0 && (
                <ul className="card-list">
                  {data.subscriptions.map((sub) => {
                    const editingThis = rowEdit?.list === 'subscriptions' && rowEdit.id === sub.id;
                    const meta = [
                      sub.billingDay
                        ? `Bills on the ${ordinal(sub.billingDay)}${subLoggedThisPeriod(sub) ? ' · logged' : ''}`
                        : subLoggedThisPeriod(sub)
                          ? 'Logged this month'
                          : '',
                      accountLabel(sub.accountId)
                    ]
                      .filter(Boolean)
                      .join(' · ');
                    return (
                      <li key={sub.id} data-row={sub.id}>
                        {editingThis ? (
                          <form className="row-edit" onSubmit={(e) => saveSub(e, sub)}>
                            <label className="field grow">
                              <span>Service</span>
                              <input name="name" type="text" defaultValue={sub.name} maxLength={NAME_MAX} required onInput={textLock} />
                            </label>
                            <label className="field amount">
                              <span>Per month</span>
                              <input name="cost" type="text" inputMode="decimal" defaultValue={sub.cost} autoComplete="off" required onInput={numericLock} />
                            </label>
                            <label className="field day">
                              <span>Billing day</span>
                              <input name="billingDay" type="number" inputMode="numeric" min="1" max="31" defaultValue={sub.billingDay || ''} placeholder="None" onInput={clearValidity} />
                            </label>
                            {accountField(accountOf(sub.accountId)?.id, 'Paid from')}
                            <div className="row-edit-actions">
                              <button type="submit" className="btn ink">Save</button>
                              <button type="button" className="btn outline" onClick={() => setRowEdit(null)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="row-open"
                              onClick={() => setRowEdit({ list: 'subscriptions', id: sub.id })}
                              aria-label={`Edit ${sub.name}, ${fmt(sub.cost)} a month`}
                            >
                              <span className="grow">
                                {sub.name}
                                {meta && <small className="muted">{meta}</small>}
                              </span>
                              <span className="num">{fmt(sub.cost)}</span>
                            </button>
                            <button
                              className="row-del"
                              onClick={() => removeWithUndo('subscriptions', sub, `Removed ${sub.name}.`)}
                              aria-label={`Remove ${sub.name}`}
                            >
                              <X size={16} strokeWidth={2.25} />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {view === 'loans' && (
            <section className="card pad">
              <div className="card-title-row">
                <h1>Loans</h1>
                {data.debts.length === 0 && <p className="card-empty">No loans yet.</p>}
              </div>
              {data.debts.length > 0 && (
                <dl className="math loans-math">
                  <div>
                    <dt>You owe</dt>
                    <dd className={owedTotal > 0 ? 'neg' : ''}><Money value={owedTotal} sym={sym} /></dd>
                  </div>
                  <div>
                    <dt>Owed to you</dt>
                    <dd className="pos"><Money value={owedToMeTotal} sym={sym} /></dd>
                  </div>
                </dl>
              )}
              {data.debts.length > 1 && (
                <fieldset className="radio-seg loan-filter">
                  <legend className="sr-only">Show loans</legend>
                  {[
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['overdue', 'Overdue'],
                    ['paid', 'Paid']
                  ].map(([value, label]) => (
                    <label key={value}>
                      <input type="radio" name="loanFilter" value={value} checked={loanFilter === value} onChange={() => runRowTransition(() => setLoanFilter(value))} />
                      <span>
                        {label}
                        {value !== 'all' && loanCounts[value] > 0 && <small className="num">{loanCounts[value]}</small>}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {data.debts.length === 0 ? (
                null
              ) : shownLoans.length === 0 ? (
                <p className="card-empty">No {loanFilter} loans.</p>
              ) : (
                <ul className="card-list">
                  {shownLoans.map(({ debt, sum }) => {
                    const editingThis = rowEdit?.list === 'debts' && rowEdit.id === debt.id;
                    const left = sum.remaining;
                    const payments = Array.isArray(debt.payments) ? debt.payments : [];
                    const iOwe = debt.type === 'i_owe';
                    const plan = debt.installment || null;
                    const paidUp = sum.status === 'paid';
                    const panelId = `loan-${debt.id}`;
                    const dueLabel = (ds) => (ds.slice(0, 4) === todayStr.slice(0, 4) ? shortDay(ds) : `${shortDay(ds)} ${ds.slice(0, 4)}`);
                    const rowsPaid = sum.schedule.filter((r) => r.status === 'paid').length;
                    const schedAll = !!loanMore[`${debt.id}:sched`];
                    const payAll = !!loanMore[`${debt.id}:pay`];
                    const editOpen = !!loanMore[`${debt.id}:edit`];
                    const firstOpen = sum.schedule.findIndex((r) => r.status !== 'paid');
                    const schedStart = firstOpen === -1 ? Math.max(0, sum.schedule.length - 4) : Math.max(0, firstOpen - 1);
                    const schedRows =
                      schedAll || sum.schedule.length <= 4 ? sum.schedule : sum.schedule.slice(schedStart, schedStart + 4);
                    const payRows = payAll || payments.length <= 3 ? payments : payments.slice(-3);
                    const rowNote = (r) =>
                      r.status === 'paid'
                        ? 'Paid'
                        : [
                            r.status === 'partial' && `${fmt(r.paid)} paid`,
                            r.due && r.due < todayStr ? 'Overdue' : r.due === todayStr ? 'Due today' : r.status === 'unpaid' && 'Not paid'
                          ]
                            .filter(Boolean)
                            .join(' · ');
                    return (
                      <li key={debt.id} data-row={debt.id} className={`loan-row ${paidUp ? 'is-paid' : ''}`}>
                        <button
                          type="button"
                          className="row-open"
                          aria-expanded={editingThis}
                          aria-controls={panelId}
                          onClick={() => {
                            setPayEdit(null);
                            setRowEdit(editingThis ? null : { list: 'debts', id: debt.id });
                          }}
                        >
                          <span className="grow">
                            {debt.person}
                            <small className={iOwe ? 'neg' : 'pos'}>
                              {[iOwe ? 'You owe' : 'Owed to you', debt.date && dueLabel(debt.date), accountLabel(debt.accountId), debt.note]
                                .filter(Boolean)
                                .join(' · ')}
                            </small>
                          </span>
                          <span className="num loan-amt">
                            {fmt(left)}
                            <small className="muted">{paidUp ? 'left' : `of ${fmt(debt.amount)}`}</small>
                          </span>
                        </button>
                        {!paidUp &&
                          (plan ? (
                            <button
                              className="settle"
                              onClick={() => {
                                setPayEdit(null);
                                setRowEdit({ list: 'debts', id: debt.id, pay: true });
                              }}
                              aria-label={`Record a payment for ${debt.person}, ${fmt(sum.nextAmount)}`}
                            >
                              Pay
                            </button>
                          ) : (
                            <button
                              className="settle"
                              onClick={() => settleDebt(debt, left, `Settled with ${debt.person}, ${fmt(left)}.`)}
                              aria-label={`Settle with ${debt.person}, ${fmt(left)}`}
                            >
                              Settle
                            </button>
                          ))}
                        <div className="loan-meta">
                          <div
                            className="loan-bar"
                            role="progressbar"
                            aria-label={`Paid so far, ${debt.person}`}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(sum.progress * 100)}
                          >
                            <i style={{ '--pct': sum.progress }} />
                          </div>
                          <p className="loan-plan muted">
                            {sum.status === 'overdue' && <b className="loan-badge overdue">{sum.overdue} overdue</b>}
                            {paidUp && <b className="loan-badge">Paid</b>}
                            <span>
                              {[
                                `${fmt(sum.paid)} paid`,
                                plan && `${rowsPaid} of ${sum.schedule.length} installments`,
                                !paidUp && sum.nextDue && `next ${fmt(sum.nextAmount)} due ${dueLabel(sum.nextDue)}`
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </p>
                        </div>
                        {editingThis && (
                          <div className="loan-panel" id={panelId}>
                            {!paidUp && (
                              <form key={`${left}-${rowEdit.pay ? 'pay' : 'open'}`} className="row-edit pay-form" onSubmit={(e) => recordPayment(e, debt)}>
                                <label className="field grow">
                                  <span>{iOwe ? (plan ? 'You paid' : 'You paid back') : `${debt.person} paid back`}</span>
                                  <input name="paid" type="text" inputMode="decimal" defaultValue={plan ? sum.nextAmount : undefined} placeholder={zeroDecimal ? '0' : '0.00'} autoComplete="off" required autoFocus={!!rowEdit.pay} onInput={numericLock} />
                                </label>
                                <label className="field date">
                                  <span>On</span>
                                  <input name="date" type="date" defaultValue={todayStr} max={todayStr} />
                                </label>
                                <label className="field grow">
                                  <span>Note</span>
                                  <input name="note" type="text" placeholder="Optional" autoComplete="off" maxLength={NOTE_MAX} />
                                </label>
                                {accountField(accountOf(debt.accountId)?.id, iOwe ? 'Paid from' : 'Paid into')}
                                <div className="row-edit-actions">
                                  <button type="submit" className="btn ink">Record payment</button>
                                  {plan && (
                                    <button type="button" className="btn outline" onClick={() => settleDebt(debt, left, `Paid off ${debt.person}, ${fmt(left)}.`)}>
                                      Pay off {fmt(left)}
                                    </button>
                                  )}
                                </div>
                              </form>
                            )}
                            {sum.schedule.length > 0 && (
                              <>
                                <h2 className="loan-sub">Schedule</h2>
                                <ul className="pay-list" aria-label="Installment schedule">
                                  {schedRows.map((r) => (
                                    <li key={r.n} className={r.status === 'paid' ? 'is-done' : r.due && r.due < todayStr ? 'is-late' : ''}>
                                      <span>{r.due ? dueLabel(r.due) : `No. ${r.n}`}</span>
                                      <span className="pay-note">{rowNote(r)}</span>
                                      <span className="num">{fmt(r.amount)}</span>
                                    </li>
                                  ))}
                                </ul>
                                {sum.schedule.length > 4 && (
                                  <button type="button" className="text-btn more-link" onClick={() => toggleMore(`${debt.id}:sched`)}>
                                    {schedAll ? 'Show fewer' : `Show all ${sum.schedule.length}`}
                                  </button>
                                )}
                              </>
                            )}
                            {payments.length > 0 && (
                              <>
                                <h2 className="loan-sub">Payments</h2>
                                <ul className="pay-list" aria-label="Payments so far">
                                  {payRows.map((p) =>
                                    payEdit === p.id ? (
                                      <li key={p.id}>
                                        <form className="row-edit pay-form" onSubmit={(e) => savePayment(e, debt, p)}>
                                          <label className="field grow">
                                            <span>Paid</span>
                                            <input name="paid" type="text" inputMode="decimal" defaultValue={p.amount} autoComplete="off" required autoFocus onInput={numericLock} />
                                          </label>
                                          <label className="field date">
                                            <span>On</span>
                                            <input name="date" type="date" defaultValue={p.date || todayStr} max={todayStr} />
                                          </label>
                                          <label className="field grow">
                                            <span>Note</span>
                                            <input name="note" type="text" defaultValue={p.note || ''} placeholder="Optional" autoComplete="off" maxLength={NOTE_MAX} />
                                          </label>
                                          <div className="row-edit-actions">
                                            <button type="submit" className="btn outline">Save</button>
                                            <button type="button" className="btn danger" onClick={() => removePayment(debt, p)}>
                                              Remove
                                            </button>
                                            <button type="button" className="btn outline" onClick={() => setPayEdit(null)}>
                                              Cancel
                                            </button>
                                          </div>
                                        </form>
                                      </li>
                                    ) : (
                                      <li key={p.id}>
                                        <span>{p.date ? dueLabel(p.date) : 'Paid'}</span>
                                        <span className="pay-note">{[p.note, accountOf(p.accountId)?.name].filter(Boolean).join(' · ')}</span>
                                        <span className="num">{fmt(p.amount)}</span>
                                        <button type="button" className="pay-act" onClick={() => setPayEdit(p.id)} aria-label={`Edit the ${fmt(p.amount)} payment`}>
                                          Edit
                                        </button>
                                      </li>
                                    )
                                  )}
                                </ul>
                                {payments.length > 3 && (
                                  <button type="button" className="text-btn more-link" onClick={() => toggleMore(`${debt.id}:pay`)}>
                                    {payAll ? 'Show fewer' : `Show all ${payments.length}`}
                                  </button>
                                )}
                              </>
                            )}
                            <Fold
                              id={`loan-edit-${debt.id}`}
                              label="Edit loan details"
                              className="loan-fold"
                              open={editOpen}
                              onToggle={() => toggleMore(`${debt.id}:edit`)}
                            />
                            <div className="fold-body" id={`loan-edit-${debt.id}`} hidden={!editOpen}>
                            <form className="row-edit" onSubmit={(e) => saveDebt(e, debt)}>
                              <label className="field grow">
                                <span>{iOwe ? 'Who or what' : 'Who'}</span>
                                <input name="person" type="text" defaultValue={debt.person} maxLength={NAME_MAX} required onInput={textLock} />
                              </label>
                              <label className="field amount">
                                <span>Total</span>
                                <input name="amount" type="text" inputMode="decimal" defaultValue={debt.amount} autoComplete="off" required onInput={numericLock} />
                              </label>
                              <label className="field grow">
                                <span>What for</span>
                                <input name="note" type="text" defaultValue={debt.note || ''} placeholder="Optional" autoComplete="off" maxLength={NOTE_MAX} />
                              </label>
                              <label className="field date">
                                <span>Since</span>
                                <input name="date" type="date" defaultValue={debt.date || ''} max={todayStr} />
                              </label>
                              <PlanFields plan={plan} todayStr={todayStr} optional />
                              <div className="row-edit-actions">
                                <button type="submit" className="btn outline">Save</button>
                                <button type="button" className="btn danger" onClick={() => removeLoan(debt)}>
                                  Delete loan
                                </button>
                              </div>
                            </form>
                            </div>
                            <div className="row-edit-actions loan-close">
                              <button type="button" className="btn outline" onClick={() => setRowEdit(null)}>
                                Close
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {view === 'accounts' && (
            <section className="card pad">
              <div className="card-title-row">
                <h1>Accounts</h1>
                {!hasAccounts && <p className="card-empty">No accounts yet.</p>}
              </div>
              {accounts.length > 1 && (
<dl className="math accounts-math">
                <div>
                  <dt>Total balance</dt>
                  <dd className={sumBalances() < 0 ? 'neg' : 'pos'}><Money value={sumBalances()} sym={sym} /></dd>
                </div>
{accountSplit && (
<>
                <div>
                  <dt>Bank</dt>
                  <dd className={sumBalances('bank') < 0 ? 'neg' : ''}><Money value={sumBalances('bank')} sym={sym} /></dd>
                </div>
                <div>
                  <dt>E-wallet</dt>
                  <dd className={sumBalances('ewallet') < 0 ? 'neg' : ''}><Money value={sumBalances('ewallet')} sym={sym} /></dd>
                </div>
</>
)}
              </dl>
)}
              {hasAccounts && (
                <ul className="card-list">
                  {accounts.map((acc) => {
                    const editingThis = rowEdit?.list === 'accounts' && rowEdit.id === acc.id;
                    const live = balanceOf(acc);
                    const editPresets = ACCOUNT_PRESETS[editAccountType] || ACCOUNT_PRESETS.bank;
                    return (
                      <li key={acc.id} data-row={acc.id}>
                        {editingThis ? (
                          <form className="row-edit" onSubmit={(e) => saveAccount(e, acc)}>
                            <fieldset className="radio-seg grow-full">
                              <legend className="sr-only">Kind of account</legend>
                              {ACCOUNT_TYPES.map(([value, label]) => (
                                <label key={value}>
                                  <input
                                    type="radio"
                                    name="type"
                                    value={value}
                                    checked={editAccountType === value}
                                    onChange={() => {
                                      setEditAccountType(value);
                                      setEditAccountPreset(presetForAccount(value, acc.name));
                                    }}
                                  />
                                  <span>{label}</span>
                                </label>
                              ))}
                            </fieldset>
                            <label className="field grow">
                              <span>{accountTypeLabel(editAccountType)}</span>
                              <select
                                name="preset"
                                value={editAccountPreset}
                                onChange={(e) => {
                                  e.currentTarget.setCustomValidity('');
                                  setEditAccountPreset(e.currentTarget.value);
                                }}
                              >
                                {editPresets.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                                <option value={CUSTOM_PRESET}>Custom</option>
                              </select>
                            </label>
                            {editAccountPreset === CUSTOM_PRESET && (
                              <label className="field grow">
                                <span>Custom name</span>
                                <input
                                  name="name"
                                  type="text"
                                  defaultValue={presetForAccount(editAccountType, acc.name) === CUSTOM_PRESET ? acc.name : ''}
                                  placeholder={editAccountType === 'ewallet' ? 'e.g. GrabPay' : 'e.g. Security Bank'}
                                  maxLength={NAME_MAX}
                                  required
                                  autoFocus
                                  onInput={textLock}
                                />
                              </label>
                            )}
                            <label className="field balance">
                              <span>Balance now</span>
                              <input
                                name="balance"
                                type="text"
                                inputMode="decimal"
                                defaultValue={live}
                                autoComplete="off"
                                required
                                aria-describedby={`acc-hint-${acc.id}`}
                                onInput={numericLock}
                              />
                            </label>
                            <p id={`acc-hint-${acc.id}`} className="hint grow-full">
                              Started at {fmt(acc.balance)}. Correcting the balance moves that starting figure, and your
                              entries stay as they are.
                            </p>
                            <div className="row-edit-actions">
                              <button type="submit" className="btn ink">Save</button>
                              <button type="button" className="btn outline" onClick={() => setRowEdit(null)}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="row-open"
                              onClick={() => startEditAccount(acc)}
                              aria-label={`Edit ${acc.name}, ${accountTypeLabel(acc.type)}, balance ${fmt(live)}`}
                            >
                              <span className="grow">
                                {acc.name}
                                <small className="muted">{accountTypeLabel(acc.type)}</small>
                              </span>
                              <span className={`num ${live < 0 ? 'neg' : ''}`}>{fmt(live)}</span>
                            </button>
                            <button className="row-del" onClick={() => removeAccount(acc)} aria-label={`Remove ${acc.name}`}>
                              <X size={16} strokeWidth={2.25} aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="transfers">
                <div className="card-title-row">
                  <h2>Transfers</h2>
                  {(!hasAccounts || transfersByWhen.length === 0) && (
                    <p className="card-empty">{hasAccounts ? 'No transfers yet.' : 'No accounts yet.'}</p>
                  )}
                </div>
                {transfersByWhen.length > 0 && (
                  <ul className="card-list">
                        {(transfersAll ? transfersByWhen : transfersByWhen.slice(0, TRANSFERS_SHOWN)).map((t) => {
                          const from = transferSide(t.fromId);
                          const to = transferSide(t.toId);
                          const editingThis = rowEdit?.list === 'transfers' && rowEdit.id === t.id;
                          return (
                            <li key={t.id} data-row={t.id}>
                              {editingThis ? (
                                <form className="row-edit transfer-form" onSubmit={(e) => saveTransfer(e, t)} onChange={clearTransferValidity}>
                                  {transferFields(t)}
                                  <div className="row-edit-actions">
                                    <button type="submit" className="btn ink">Save</button>
                                    <button type="button" className="btn outline" onClick={() => setRowEdit(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="row-open"
                                    onClick={() => setRowEdit({ list: 'transfers', id: t.id })}
                                    aria-label={`Edit transfer of ${fmt(t.amount)} from ${from} to ${to}`}
                                  >
                                    <span className="grow">
                                      <span className="transfer-route">
                                        {t.fromId === null && <Banknote size={14} aria-hidden="true" />}
                                        {from}
                                        <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />
                                        <span className="sr-only"> to </span>
                                        {t.toId === null && <Banknote size={14} aria-hidden="true" />}
                                        {to}
                                      </span>
                                      <small className="muted">{[t.note, entryStamp(t, todayStr)].filter(Boolean).join(' · ')}</small>
                                    </span>
                                    <span className="num">{fmt(t.amount)}</span>
                                  </button>
                                  <button
                                    className="row-del"
                                    onClick={() =>
                                      removeWithUndo('transfers', t, `Deleted transfer, ${fmt(t.amount)} back in ${from}.`)
                                    }
                                    aria-label={`Delete transfer of ${fmt(t.amount)} from ${from} to ${to}`}
                                  >
                                    <X size={16} strokeWidth={2.25} aria-hidden="true" />
                                  </button>
                                </>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                )}
                {transfersByWhen.length > TRANSFERS_SHOWN && (
                      <button
                        type="button"
                        className="text-btn transfers-more"
                        aria-expanded={transfersAll}
                        onClick={() => setTransfersAll((v) => !v)}
                      >
                        {transfersAll ? 'Show fewer' : `Show all ${transfersByWhen.length} transfers`}
                      </button>
                    )}
              </div>
              <div className="goals">
                <div className="card-title-row">
                  <h2>Savings goals</h2>
                  {data.goals.length === 0 ? (
                    <p className="card-empty">No savings goals yet.</p>
                  ) : (
                    <span className="num muted">
                      {fmt(round2(data.goals.reduce((sum, g) => sum + goalProgress(g).saved, 0)))} set aside
                    </span>
                  )}
                </div>
                {data.goals.length > 0 && (
                  <ul className="card-list">
                    {data.goals.map((goal) => {
                      const progress = goalProgress(goal);
                      const open = openGoal === goal.id;
                      const editingGoal = goalEditId === goal.id;
                      const panelId = `goal-${goal.id}`;
                      const history = [...goal.contributions].sort((a, b) => b.date.localeCompare(a.date));
                      return (
                        <li key={goal.id} data-row={goal.id} className={`goal-row ${open ? 'is-open' : ''} ${progress.done ? 'is-done-g' : ''}`}>
                          <button
                            type="button"
                            className="row-open"
                            aria-expanded={open}
                            aria-controls={panelId}
                            onClick={() => {
                              setGoalEditId(null);
                              setContributionEditId(null);
                              setOpenGoal(open ? null : goal.id);
                            }}
                          >
                            <span className="grow">
                              {goal.name}
                              {progress.done ? (
                                <span className="goal-badge">Reached</span>
                              ) : (
                                <small className="muted">{fmt(progress.remaining)} to go</small>
                              )}
                            </span>
                            <span className="num loan-amt">
                              {fmt(progress.saved)}
                              <small className="muted">of {fmt(goal.target)}</small>
                            </span>
                          </button>
                          <div className="goal-meta">
                            <div
                              className="goal-bar"
                              role="progressbar"
                              aria-label={`Saved so far, ${goal.name}`}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={Math.round(progress.pct)}
                            >
                              <i style={{ '--pct': progress.pct / 100 }} />
                            </div>
                            <span className="goal-pct">{Math.round(progress.pct)}%</span>
                          </div>
                          {open && (
                            <div className="goal-panel" id={panelId}>
                              {editingGoal ? (
                                <form className="row-edit" onSubmit={(e) => saveGoal(e, goal)}>
                                  <label className="field grow">
                                    <span>Goal</span>
                                    <input name="name" type="text" defaultValue={goal.name} maxLength={NAME_MAX} required autoFocus onInput={textLock} />
                                  </label>
                                  <label className="field amount">
                                    <span>Target</span>
                                    <input name="target" type="text" inputMode="decimal" defaultValue={goal.target} autoComplete="off" required onInput={numericLock} />
                                  </label>
                                  <div className="row-edit-actions">
                                    <button type="submit" className="btn ink">Save</button>
                                    <button type="button" className="btn danger" onClick={() => deleteGoal(goal)}>
                                      Delete
                                    </button>
                                    <button type="button" className="btn outline" onClick={() => setGoalEditId(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <form className="row-edit pay-form" onSubmit={(e) => handleAddMoney(e, goal)}>
                                  {contributionFields(null)}
                                  <div className="row-edit-actions">
                                    <button type="submit" className="btn ink">Add money</button>
                                    <button type="button" className="btn outline" onClick={() => setGoalEditId(goal.id)}>
                                      Edit goal
                                    </button>
                                  </div>
                                </form>
                              )}
                              {history.length > 0 && (
                                <>
                                  <h2 className="loan-sub">Set aside</h2>
                                  <ul className="pay-list" aria-label={`Money set aside for ${goal.name}`}>
                                    {history.map((c) =>
                                      contributionEditId === c.id ? (
                                        <li key={c.id}>
                                          <form className="row-edit pay-form" onSubmit={(e) => saveContribution(e, goal, c)}>
                                            {contributionFields(c)}
                                            <div className="row-edit-actions">
                                              <button type="submit" className="btn outline">Save</button>
                                              <button type="button" className="btn danger" onClick={() => removeContribution(goal, c)}>
                                                Remove
                                              </button>
                                              <button type="button" className="btn outline" onClick={() => setContributionEditId(null)}>
                                                Cancel
                                              </button>
                                            </div>
                                          </form>
                                        </li>
                                      ) : (
                                        <li key={c.id}>
                                          <span>{shortDay(c.date)}</span>
                                          <span className="pay-note">{accountOf(c.accountId)?.name || ''}</span>
                                          <span className="num">{fmt(c.amount)}</span>
                                          <button type="button" className="pay-act" onClick={() => setContributionEditId(c.id)} aria-label={`Edit the ${fmt(c.amount)} set aside`}>
                                            Edit
                                          </button>
                                        </li>
                                      )
                                    )}
                                  </ul>
                                </>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {data.goals.length > 0 && (
                  <p className="hint">
                    Money set aside leaves the account you take it from, but it is not spending, so your daily number
                    and monthly total stay the same.
                  </p>
                )}
              </div>
            </section>
          )}

          {isSettings && (
            <>
              <section className="card pad" aria-labelledby="settings-heading">
                <h1 id="settings-heading">Settings</h1>
                <div className="settings-sub">
                  <h2>Budget</h2>
                </div>
                <form
                  key={settingsFormKey}
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveSettingsForm(e.currentTarget);
                  }}
                  onBlur={onSettingsBlur}
                  onChange={onSettingsChange}
                  className="settings-form"
                >
                  <label className="field">
                    <span>Currency symbol</span>
                    <select name="currency" defaultValue={data.settings.currency}>
                      {[...new Set([...CURRENCIES.map((c) => c.symbol), data.settings.currency])].map((s) => {
                        const c = CURRENCIES.find((x) => x.symbol === s);
                        return (
                          <option key={s} value={s}>
                            {c ? `${s}  ${c.label}` : s}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="field">
                    <span>Monthly budget</span>
                    <input
                      name="monthlyBudget"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      defaultValue={data.settings.monthlyBudget || ''}
                      placeholder="e.g. 600"
                      onInput={numericLock}
                    />
                  </label>
                  <div className="field">
                    <label htmlFor="set-daily">Daily budget</label>
                    <input
                      id="set-daily"
                      name="dailyBudget"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      defaultValue={data.settings.dailyBudget || ''}
                      placeholder="e.g. 20"
                      onInput={numericLock}
                      aria-describedby="set-daily-help"
                    />
                    <small id="set-daily-help">
                      Leftovers carry to tomorrow; overspending carries as debt.
                    </small>
                    {perDayLeft > 0 && perDayLeft !== baseDaily && (
                      <small className="suggest">
                        {fmt(perDayLeft)} a day lasts until {periodLastDay}.{' '}
                        <button
                          type="button"
                          className="inline-link"
                          onClick={(e) => applySuggestedDaily(e.currentTarget.form)}
                        >
                          Use it
                        </button>
                      </small>
                    )}
                  </div>
                  <Fold
                    id="budget-more"
                    label="More budget options"
                    open={budgetMoreOpen}
                    onToggle={() => setPref('budgetMoreOpen', !budgetMoreOpen)}
                    summary={[
                      skipWeekends ? 'Weekdays only' : 'Every day',
                      `month starts ${ordinal(monthStartDay)}`,
                      resetCarryMonthly ? 'start fresh' : 'keep the carry',
                      `warn at ${data.settings.alertThreshold}%`
                    ].join(' · ')}
                  />
                  <div className="fold-body" id="budget-more" hidden={!budgetMoreOpen}>
                  <div className="field">
                    <span id="budget-days-label">Daily budget on</span>
                    <fieldset className="radio-seg" aria-labelledby="budget-days-label">
                      <label>
                        <input type="radio" name="budgetDays" value="every" defaultChecked={!skipWeekends} />
                        <span>Every day</span>
                      </label>
                      <label>
                        <input type="radio" name="budgetDays" value="weekdays" defaultChecked={skipWeekends} />
                        <span>Weekdays only</span>
                      </label>
                    </fieldset>
                    <small>Weekends add nothing, but weekend spending still counts.</small>
                  </div>
                  <label className="field">
                    <span>Your month starts on the</span>
                    <select name="monthStartDay" defaultValue={monthStartDay}>
                      {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {ordinal(d)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="field">
                    <span id="carry-months-label">At the start of each month</span>
                    <fieldset className="radio-seg" aria-labelledby="carry-months-label">
                      <label>
                        <input type="radio" name="carryMonths" value="keep" defaultChecked={!resetCarryMonthly} />
                        <span>Keep the carry</span>
                      </label>
                      <label>
                        <input type="radio" name="carryMonths" value="fresh" defaultChecked={resetCarryMonthly} />
                        <span>Start fresh</span>
                      </label>
                    </fieldset>
                  </div>
                  <label className="field">
                    <span>Warn me at (% of monthly budget)</span>
                    <input name="alertThreshold" type="number" inputMode="numeric" defaultValue={data.settings.alertThreshold} min="50" max="100" />
                  </label>
                  </div>
                </form>
              </section>

              <section className="card pad" id="categories-settings" aria-labelledby="cats-heading">
                <h2 id="cats-heading">Expense categories</h2>
                <div className="cat-head" aria-hidden="true">
                  <span>Ink</span>
                  <span>Name</span>
                  <span>Used</span>
                </div>
                <ul className="card-list cat-list">
                  {categories.map((cat) => {
                    const used = usageOf(cat.name);
                    return (
                      <li key={cat.id} data-row={cat.id}>
                        <button
                          type="button"
                          className="swatch"
                          style={{ '--c': cat.color }}
                          onClick={() => cycleInk(cat)}
                          aria-label={`Change colour of ${cat.name}`}
                        />
                        <input
                          key={cat.name}
                          className="cat-name"
                          defaultValue={cat.name}
                          maxLength={CATEGORY_NAME_MAX}
                          aria-label={`Rename ${cat.name}`}
                          onInput={textLock}
                          onBlur={(e) => renameCategory(cat, e.target)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                            if (e.key === 'Escape') {
                              e.currentTarget.value = cat.name;
                              e.currentTarget.blur();
                            }
                          }}
                        />
                        <span className="num muted cat-count">
                          {used > 0 && (
                            <>
                              <span aria-hidden="true">{used}</span>
                              <span className="sr-only">
                                {used} expense{used === 1 ? '' : 's'}
                              </span>
                            </>
                          )}
                        </span>
                        <button
                          type="button"
                          className="row-del"
                          onClick={() => (catMove?.id === cat.id ? setCatMove(null) : deleteCategory(cat))}
                          disabled={categories.length <= 1}
                          aria-label={`Remove category ${cat.name}`}
                          aria-expanded={used > 0 ? catMove?.id === cat.id : undefined}
                        >
                          <X size={16} strokeWidth={2.25} />
                        </button>
                        {catMove?.id === cat.id && (
                          <div className="cat-move">
                            <label className="field">
                              <span>
                                Move its {used} expense{used === 1 ? '' : 's'} to
                              </span>
                              <select value={catMove.to} onChange={(e) => setCatMove({ ...catMove, to: e.target.value })}>
                                {categories
                                  .filter((c) => c.id !== cat.id)
                                  .map((c) => (
                                    <option key={c.id} value={c.name}>
                                      {c.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <div className="row-edit-actions">
                              <button type="button" className="btn ink" onClick={() => moveAndRemoveCategory(cat, catMove.to)}>
                                Move and remove
                              </button>
                              <button type="button" className="btn outline" onClick={() => setCatMove(null)}>
                                Keep {cat.name}
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <form onSubmit={handleAddCategory} className="add-form">
                  <label className="field grow">
                    <span>New category</span>
                    <input name="catName" type="text" placeholder={categoryExample} maxLength={CATEGORY_NAME_MAX} required onInput={textLock} />
                  </label>
                  <button type="submit" className="btn ink">Add</button>
                </form>
              </section>

              {(canInstall || (IOS_NOT_INSTALLED && !installHintOff)) && (
                <section className="card pad">
                  <h2>Install</h2>
                  {canInstall ? (
                    <>
                      <p className="card-note">Put stdynt on your home screen.</p>
                      <div className="btn-row">
                        <button type="button" onClick={install} className="btn outline">
                          <Smartphone size={16} strokeWidth={2} aria-hidden="true" />
                          Install stdynt
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="card-note">
                        Tap Share, then Add to Home Screen. stdynt then opens full screen and works offline.
                      </p>
                      <div className="btn-row">
                        <button type="button" onClick={hideInstallHint} className="btn outline">
                          Not now
                        </button>
                      </div>
                    </>
                  )}
                </section>
              )}

              <section className="card pad">
                <h2>App</h2>
                <p className="card-note">Get the newest version. Your data stays as it is.</p>
                <div className="btn-row">
                  <button type="button" onClick={checkForUpdate} disabled={updateState === 'checking'} className="btn outline">
                    <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
                    Check for updates
                  </button>
                </div>
                <p className="card-note" role="status" aria-live="polite">
                  {updateState === 'idle' ? '' : updateLabel}
                </p>
              </section>

              <ConsentCard />

              <section className="card pad">
                <h2>Your data</h2>
                <p className="card-note">Stored only on this device. Back up before switching phones.</p>
                <div className="btn-row">
                  <button
                    type="button"
                    onClick={exportJSON}
                    className="btn outline"
                    disabled={!!fileBusy}
                    aria-busy={fileBusy === 'backup'}
                  >
                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                    {fileBusy === 'backup' ? 'Saving…' : 'Back up'}
                  </button>
                  <label className="btn outline">
                    <Upload size={16} strokeWidth={2} aria-hidden="true" /> Restore backup
                    <input type="file" accept=".json,application/json" onChange={importJSON} className="sr-only" />
                  </label>
                  <button
                    type="button"
                    onClick={exportCSV}
                    className="btn outline"
                    disabled={!!fileBusy}
                    aria-busy={fileBusy === 'csv'}
                  >
                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                    {fileBusy === 'csv' ? 'Saving…' : 'Export CSV'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    startFresh(
                      {
                        title: 'Delete all data?',
                        body: 'Every entry, subscription, loan, account and setting on this device goes. This cannot be undone.',
                        confirmLabel: 'Delete all data',
                        cancelLabel: 'Keep my data'
                      },
                      'All data deleted.'
                    )
                  }
                  className="btn danger full"
                >
                  Delete all data
                </button>
              </section>
            </>
          )}
        </div>

      </main>

      <div className="live-slot" role="status">
        {undo ? (
          <div
            className="toast undo-toast"
            onMouseEnter={holdUndoTimer}
            onMouseLeave={armUndoTimer}
            onFocus={holdUndoTimer}
            onBlur={armUndoTimer}
          >
            <span>{undo.message}</span>
            <button type="button" className="toast-undo" onClick={undo.restore}>
              Undo
            </button>
          </div>
        ) : notice ? (
          <div className={`toast ${noticeIsError ? 'error' : ''}`}>{notice}</div>
        ) : (
          hasNewBuild && (
            <div className="toast update-toast">
              <span>New version available</span>
              <button type="button" className="toast-undo" onClick={() => window.location.reload()}>
                Refresh
              </button>
            </div>
          )
        )}
      </div>

      <dialog
        ref={sheetRef}
        className={`sheet ${sheetClosing ? 'closing' : ''}`}
        onCancel={(e) => {
          e.preventDefault();
          closeSheet();
        }}
        onClick={(e) => e.target === sheetRef.current && closeSheet()}
      >
        <form onSubmit={handleExpenseSubmit} className="sheet-body">
          <div
            className="sheet-head"
            onPointerDown={onSheetDragStart}
            onPointerMove={onSheetDragMove}
            onPointerUp={onSheetDragEnd}
            onPointerCancel={onSheetDragEnd}
          >
            <span className="sheet-grip" aria-hidden="true" />
            <h2>
              {editing
                ? editing.note?.trim()
                  ? `Edit · ${editing.note.trim()}`
                  : `Edit ${sheetKind === 'income' ? 'income' : 'expense'}`
                : sheetKind === 'income'
                  ? 'New income'
                  : 'New expense'}
            </h2>
            <button type="button" className="icon-btn" onClick={() => closeSheet()} aria-label="Close">
              <X size={22} strokeWidth={2} />
            </button>
          </div>
          {!editing && (
            <div className="radio-seg kind-seg" role="group" aria-label="Entry type">
              {[
                ['expense', 'Expense'],
                ['income', 'Income']
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={sheetKind === value}
                  onClick={() => {
                    setSheetKind(value);
                    amountInputRef.current?.focus();
                  }}
                >
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
          {!editing && sheetMemory.recent.length > 0 && (
            <div className="recent" role="group" aria-labelledby="recent-name">
              <span id="recent-name" className="recent-name">
                Recent
              </span>
              <div className="recent-row">
                {sheetMemory.recent.map((r) => (
                  <button key={r.id} type="button" className="recent-pick" onClick={() => fillFromRecent(r)}>
                    <span className="recent-what">{r.note || (sheetKind === 'income' ? 'Income' : r.category)}</span>
                    <span className="num recent-amt">{fmt(r.amount)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <label className="field big-amount">
            <span>Amount</span>
            <div className="amount-wrap">
              <span className="amount-sym">{sym}</span>
              <input
                ref={amountInputRef}
                name="amount"
                type="text"
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                placeholder={zeroDecimal ? '0' : '0.00'}
                onInput={numericLock}
                required
              />
            </div>
          </label>
          <fieldset className="chips" hidden={sheetKind === 'income'} aria-labelledby="chips-name">
            <legend>
              <span id="chips-name">Category</span>
              <button
                type="button"
                className="legend-link"
                onClick={() =>
                  closeSheet(() => {
                    go('settings');
                    setTimeout(
                      () => document.getElementById('categories-settings')?.scrollIntoView({ behavior: 'smooth' }),
                      420
                    );
                  })
                }
              >
                Edit categories
              </button>
            </legend>
            {sheetCategories.map((c, i) => (
              <label key={c.id} className="chip">
                <input type="radio" name="category" value={c.name} defaultChecked={i === 0} />
                <span>
                  <i style={{ background: c.color }} />
                  {c.name}
                </span>
              </label>
            ))}
          </fieldset>
          {hasAccounts && (
            <fieldset className="chips account-chips">
              <legend>{sheetKind === 'income' ? 'Paid into' : 'Paid from'}</legend>
              <label className="chip">
                <input type="radio" name="accountId" value="" defaultChecked />
                <span>Cash</span>
              </label>
              {accounts.map((a) => (
                <label key={a.id} className="chip">
                  <input type="radio" name="accountId" value={String(a.id)} />
                  <span>{a.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="field">
            <span>Note</span>
            <input
              name="note"
              type="text"
              list="note-suggest"
              maxLength={NOTE_MAX}
              placeholder={sheetKind === 'income' ? 'Tutoring' : 'Iced coffee'}
              enterKeyHint="done"
              autoComplete="off"
              aria-describedby={sheetSubMatch ? 'note-hint' : undefined}
              onInput={(e) => {
                const value = e.currentTarget.value;
                setSheetNote(value);
                if (sheetKind !== 'expense' || editing) return;
                const cat = sheetMemory.noteCategory.get(value.trim().toLowerCase());
                if (cat && categories.some((c) => c.name === cat)) e.currentTarget.form.elements.category.value = cat;
              }}
            />
            {sheetSubMatch && (
              <small id="note-hint" className="hint">
                Already a subscription:{' '}
                {sheetSubMatch.billingDay
                  ? "it's logged on its billing day."
                  : 'logging it here counts it twice.'}
              </small>
            )}
          </label>
          <datalist id="note-suggest">
            {sheetMemory.notes.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="sheet-when">
            <button
              type="button"
              className="when-sum"
              aria-expanded={sheetWhenOpen || !!sheetDateReason}
              aria-controls="sheet-when-fields"
              onClick={() => {
                const next = !sheetWhenOpen;
                setSheetWhenOpen(next);
                if (next) requestAnimationFrame(() => sheetRef.current?.querySelector('input[name="date"]')?.focus());
              }}
            >
              <span className="when-label">{whenLabel}</span>
              <span className="when-change">{sheetWhenOpen || sheetDateReason ? 'Done' : 'Change'}</span>
            </button>
            <div className="sheet-row when" id="sheet-when-fields" hidden={!(sheetWhenOpen || sheetDateReason)}>
              <label className="field">
                <span>Date</span>
                <input
                  name="date"
                  type="date"
                  required
                  max={todayStr}
                  aria-describedby={sheetDateReason ? 'date-hint' : undefined}
                  onChange={(e) => setSheetDate(e.currentTarget.value)}
                />
              </label>
              <label className="field">
                <span>Time</span>
                <input name="time" type="time" onChange={(e) => setSheetTime(e.currentTarget.value)} />
              </label>
              {sheetDateReason && (
                <small id="date-hint" className="hint when-hint">
                  {sheetDateReason === 'closed-month'
                    ? "That month started fresh, so this won't change today's number."
                    : "Before your daily budget started, so this won't change today's number."}
                </small>
              )}
            </div>
          </div>
          <div className="sheet-foot">
            <button type="submit" className="btn ink full big">
              {editing ? 'Save changes' : sheetKind === 'income' ? 'Log income' : 'Log expense'}
            </button>
          </div>
        </form>
      </dialog>

      <dialog
        ref={addSheetRef}
        className={`sheet ${addSheetClosing ? 'closing' : ''}`}
        onCancel={(e) => {
          e.preventDefault();
          closeAddSheet();
        }}
        onClick={(e) => e.target === addSheetRef.current && closeAddSheet()}
      >
        <div className="sheet-body">
          <div className="sheet-head" onPointerDown={onAddSheetDragStart} onPointerMove={onAddSheetDragMove} onPointerUp={onAddSheetDragEnd} onPointerCancel={onAddSheetDragEnd}>
            <span className="sheet-grip" aria-hidden="true" />
            <h2>{view === 'accounts' ? ADD_SHEET_LABELS[addSheetKind] : ADD_FORMS[view] ? ADD_FORMS[view][1] : 'Add'}</h2>
            <button type="button" className="icon-btn" onClick={() => closeAddSheet()} aria-label="Close">
              <X size={22} strokeWidth={2} />
            </button>
          </div>
          {view === 'subs' && (
            <form id="add-subs" onSubmit={handleAddSub} className="add-form">
            <fieldset className="radio-seg grow-full">
              <legend className="sr-only">New or existing</legend>
              <label>
                <input type="radio" name="origin" value="new" checked={subOrigin === 'new'} onChange={() => setSubOrigin('new')} />
                <span>New</span>
              </label>
              <label>
                <input type="radio" name="origin" value="existing" checked={subOrigin === 'existing'} onChange={() => setSubOrigin('existing')} />
                <span>Existing</span>
              </label>
            </fieldset>
            <label className="field grow">
              <span>Service</span>
              <input name="name" type="text" maxLength={NAME_MAX} required autoFocus onInput={textLock} />
            </label>
            <label className="field amount">
              <span>Per month</span>
              <input name="cost" type="text" inputMode="decimal" autoComplete="off" required onInput={numericLock} />
            </label>
            <label className="field day">
              <span>Billing day</span>
              <input name="billingDay" type="number" inputMode="numeric" min="1" max="31" onInput={clearValidity} />
            </label>
            {accountField(defaultAccountId, 'Paid from')}
            <button type="submit" className="btn ink">Add</button>
          </form>
        )}
        {view === 'loans' && (
          <form id="add-loans" onSubmit={handleAddDebt} className="add-form loans-form">
            <fieldset className="radio-seg grow-full">
              <legend className="sr-only">Direction</legend>
              <label>
                <input type="radio" name="type" value="i_owe" checked={loanKind === 'i_owe'} onChange={() => setLoanKind('i_owe')} />
                <span>You owe</span>
              </label>
              <label>
                <input type="radio" name="type" value="they_owe" checked={loanKind === 'they_owe'} onChange={() => setLoanKind('they_owe')} />
                <span>Owed to you</span>
              </label>
              <label>
                <input type="radio" name="type" value="installment" checked={loanKind === 'installment'} onChange={() => setLoanKind('installment')} />
                <span>Installment</span>
              </label>
            </fieldset>
            <fieldset className="radio-seg grow-full">
              <legend className="sr-only">New or existing</legend>
              <label>
                <input type="radio" name="origin" value="new" checked={loanOrigin === 'new'} onChange={() => setLoanOrigin('new')} />
                <span>New</span>
              </label>
              <label>
                <input type="radio" name="origin" value="existing" checked={loanOrigin === 'existing'} onChange={() => setLoanOrigin('existing')} />
                <span>Existing</span>
              </label>
            </fieldset>
            <label className="field grow">
              <span>{loanKind === 'installment' ? 'What' : 'Who'}</span>
              <input name="person" type="text" maxLength={NAME_MAX} required autoFocus onInput={textLock} />
            </label>
            <label className="field amount">
              <span>{loanKind === 'installment' ? 'Total' : 'Amount'}</span>
              <input name="amount" type="text" inputMode="decimal" autoComplete="off" required onInput={numericLock} />
            </label>
            <label className="field">
              <span>Since</span>
              <input name="date" type="date" defaultValue={todayStr} max={todayStr} required />
            </label>
            {loanKind !== 'installment' && (
              <label className="field grow-full">
                <span>What for</span>
                <input name="note" type="text" placeholder="Optional" autoComplete="off" maxLength={NOTE_MAX} />
              </label>
            )}
            <PlanFields key={loanKind} todayStr={todayStr} optional={loanKind !== 'installment'} />
            {accountField(defaultAccountId, loanKind === 'installment' ? 'Paid from' : undefined)}
            {loanOrigin === 'existing' && (
              <label className="field amount">
                <span>Already paid</span>
                <input name="paidBefore" type="text" inputMode="decimal" placeholder="Optional" autoComplete="off" onInput={numericLock} />
              </label>
            )}
            <button type="submit" className="btn ink">Add</button>
          </form>
        )}
        {view === 'accounts' && addSheetKind === 'account' && (
          <form id="add-accounts" onSubmit={handleAddAccount} className="add-form">
            <fieldset className="radio-seg grow-full">
              <legend className="sr-only">Kind of account</legend>
              {ACCOUNT_TYPES.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="type"
                    value={value}
                    checked={addAccountType === value}
                    onChange={() => resetAddAccountDraft(value)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <label className="field grow">
              <span>{accountTypeLabel(addAccountType)}</span>
              <select
                name="preset"
                value={addAccountPreset}
                autoFocus
                onChange={(e) => {
                  e.currentTarget.setCustomValidity('');
                  setAddAccountPreset(e.currentTarget.value);
                }}
              >
                {(ACCOUNT_PRESETS[addAccountType] || ACCOUNT_PRESETS.bank).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
                <option value={CUSTOM_PRESET}>Custom</option>
              </select>
            </label>
            {addAccountPreset === CUSTOM_PRESET && (
              <label className="field grow">
                <span>Custom name</span>
                <input
                  name="name"
                  type="text"
                  placeholder={addAccountType === 'ewallet' ? 'e.g. GrabPay' : 'e.g. Security Bank'}
                  maxLength={NAME_MAX}
                  required
                  autoFocus
                  onInput={textLock}
                />
              </label>
            )}
            <label className="field balance">
              <span>Starting balance</span>
              <input name="balance" type="text" inputMode="decimal" placeholder={zeroDecimal ? '0' : '0.00'} autoComplete="off" onInput={numericLock} />
            </label>
            <button type="submit" className="btn ink">Add</button>
          </form>
        )}
        {view === 'accounts' && addSheetKind === 'transfer' && (
          <form id="add-transfer" onSubmit={handleTransfer} onChange={clearTransferValidity} className="add-form">
            <div className="transfer-sides">
              <label className="field grow">
                <span>From</span>
                <select name="fromId" defaultValue={sideValue(transferDefaults.fromId)} autoFocus>
                  {sideOptions()}
                </select>
              </label>
              <button
                type="button"
                className="swap-btn"
                aria-label="Swap from and to"
                onClick={(e) => {
                  const form = e.currentTarget.form;
                  [form.elements.fromId.value, form.elements.toId.value] = [form.elements.toId.value, form.elements.fromId.value];
                  form.elements.toId.setCustomValidity('');
                }}
              >
                <ArrowLeftRight size={18} aria-hidden="true" />
              </button>
              <label className="field grow">
                <span>To</span>
                <select name="toId" defaultValue={sideValue(transferDefaults.toId)}>
                  {sideOptions()}
                </select>
              </label>
            </div>
            <label className="field big-amount">
              <span>Amount</span>
              <div className="amount-wrap">
                <span className="amount-sym">{sym}</span>
                <input name="amount" type="text" inputMode="decimal" placeholder={zeroDecimal ? '0' : '0.00'} autoComplete="off" required onInput={numericLock} />
              </div>
            </label>
            <div className="transfer-tail">
              <label className="field">
                <span>Date</span>
                <input name="date" type="date" defaultValue={todayStr} max={todayStr} required />
              </label>
              <label className="field grow">
                <span>Note</span>
                <input name="note" type="text" placeholder="Optional" autoComplete="off" maxLength={NOTE_MAX} />
              </label>
            </div>
            <div className="sheet-foot">
              <button type="submit" className="btn ink full big">Transfer</button>
            </div>
          </form>
        )}
        {view === 'accounts' && addSheetKind === 'goal' && (
          <form id="add-goal" onSubmit={handleAddGoal} className="add-form">
            <label className="field grow">
              <span>Goal</span>
              <input name="name" type="text" maxLength={NAME_MAX} required autoFocus onInput={textLock} />
            </label>
            <label className="field big-amount">
              <span>Target</span>
              <div className="amount-wrap">
                <span className="amount-sym">{sym}</span>
                <input name="target" type="text" inputMode="decimal" autoComplete="off" required onInput={numericLock} />
              </div>
            </label>
            <div className="sheet-foot">
              <button type="submit" className="btn ink full big">Set goal</button>
            </div>
          </form>
        )}
        </div>
      </dialog>

      <dialog
        ref={introRef}
        className="sheet intro"
        aria-labelledby="intro-title"
        onCancel={(e) => {
          e.preventDefault();
          skipIntro();
        }}
        onClick={(e) => e.target === introRef.current && skipIntro()}
      >
        <form className="sheet-body" onSubmit={finishIntroSetup}>
          <div className="sheet-head">
            <h2 id="intro-title">
              {introStep === 1 ? 'Welcome to stdynt!' : introStep === 2 ? 'Set your allowance' : "You're set up"}
            </h2>
            <button type="button" className="icon-btn" onClick={skipIntro} aria-label="Close setup">
              <X size={22} strokeWidth={2} />
            </button>
          </div>
          <p className="sr-only" role="status">
            {introStep === 3 && introSaved
              ? `You can spend ${introMoney(introSaved.daily, introSaved.currency)} today.`
              : ''}
          </p>

          {introStep === 1 && (
            <>
              <div className="sheet-foot">
                <button
                  type="button"
                  className="btn ink full big"
                  onClick={() => {
                    setIntroStep(2);
                    setIntroError('');
                  }}
                >
                  Set my allowance
                </button>
                {canInstall && (
                  <button type="button" className="btn outline full" onClick={install}>
                    <Smartphone size={16} strokeWidth={2} aria-hidden="true" />
                    Install as an app
                  </button>
                )}
                {!canInstall && IOS_NOT_INSTALLED && (
                  <p className="hint">Tap Share, then Add to Home Screen.</p>
                )}
                <button type="button" className="text-btn" onClick={skipIntro}>
                  Set up later
                </button>
              </div>
            </>
          )}

          {introStep === 2 && (
            <>
              <label className="field">
                <span>Currency</span>
                <select value={introCurrency} onChange={(e) => setIntroCurrency(e.target.value)}>
                  {[...new Set([...CURRENCIES.map((c) => c.symbol), introCurrency])].map((s) => {
                    const c = CURRENCIES.find((x) => x.symbol === s);
                    return (
                      <option key={s} value={s}>
                        {c ? `${s}  ${c.label}` : s}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="field">
                <span>Monthly allowance</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={introAmount}
                  onChange={(e) => {
                    setIntroAmount(cleanMoneyInput(e.target.value));
                    setIntroError('');
                  }}
                  placeholder="e.g. 600"
                  autoFocus
                  aria-describedby="intro-daily"
                />
              </label>
              <p id="intro-daily" className="hint">
                {introDaily > 0
                  ? `That's about ${introMoney(introDaily)} a day until ${periodLastDay}.`
                  : 'Enter your allowance to see your daily number.'}
              </p>
              {introError && (
                <p className="hint intro-error" role="alert">
                  {introError}
                </p>
              )}
              <div className="sheet-foot">
                <button type="submit" className="btn ink full big">
                  See my daily number
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    setIntroStep(1);
                    setIntroError('');
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}

          {introStep === 3 && introSaved && (
            <>
              <p className="intro-lead">
                Here's your daily number for the rest of this month. Spend less and the rest carries to tomorrow.
              </p>
              <div className="well intro-well" style={{ '--level': '1' }}>
                <span className="intro-label">You can spend today</span>
                <span className="stamp">
                  <span className="stamp-sym" aria-hidden="true">{introSaved.currency}</span>
                  {formatNumber(introSaved.daily, introSaved.currency)}
                </span>
                <span className="date-stamp" aria-hidden="true">{stampDate(todayStr)}</span>
              </div>
              <div className="sheet-foot">
                <button type="button" className="btn ink full big" autoFocus onClick={() => leaveIntro(true)}>
                  Log my first expense
                </button>
                <button type="button" className="text-btn" onClick={() => leaveIntro(false)}>
                  Go to Today
                </button>
              </div>
            </>
          )}
        </form>
      </dialog>

      <dialog
        ref={askRef}
        className="confirm"
        aria-labelledby="ask-title"
        aria-describedby="ask-body"
        onClose={() => setAsk(null)}
        onClick={(e) => e.target === askRef.current && closeAsk()}
      >
        {ask && (
          <div className="confirm-body">
            <h2 id="ask-title">{ask.title}</h2>
            <p id="ask-body">{ask.body}</p>
            <div className="confirm-actions">
              <button type="button" className="btn outline" autoFocus onClick={closeAsk}>
                {ask.cancelLabel}
              </button>
              <button
                type="button"
                className={`btn ${ask.danger ? 'danger' : 'ink'}`}
                onClick={() => {
                  const run = ask.onConfirm;
                  closeAsk();
                  run();
                }}
              >
                {ask.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
