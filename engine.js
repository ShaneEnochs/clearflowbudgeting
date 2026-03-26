// ============================================================
// ClearFlow — Data Engine
// Handles: data model, localStorage persistence, date logic,
//          week bucket assignment, projection calculations
// ============================================================

'use strict';

// ── Constants ────────────────────────────────────────────────
const STORAGE_KEY = 'clearflow_v1';

// 5 buckets of 6 days each. The last bucket is "25th – End of Month"
// which automatically covers any month length (28/29/30/31 days).
const WEEK_BUCKETS = [
  { id: 'w1', label: '1st – 6th',          start: 1,  end: 6  },
  { id: 'w2', label: '7th – 12th',          start: 7,  end: 12 },
  { id: 'w3', label: '13th – 18th',         start: 13, end: 18 },
  { id: 'w4', label: '19th – 24th',         start: 19, end: 24 },
  { id: 'w5', label: '25th – End of Month', start: 25, end: 31 },
];

const FREQUENCIES = ['weekly', 'biweekly', 'monthly'];
const PAY_DAYS    = ['Thursday', 'Friday'];

// ── Default Data Model ───────────────────────────────────────
function createDefaultAccount(id, name) {
  return {
    id,
    name,
    balance: 0,
    income: [],
    expenses: [],
    oneTimeExpenses: [],
    savings: [],
    transfers: [],
  };
}

function createDefaultState() {
  const acct = createDefaultAccount('acct_1', 'My Checking');
  return { accounts: [acct], activeAccountId: 'acct_1', clearedItems: {} };
}

function createIncomeItem(overrides = {}) {
  return {
    id: uid(), name: '',
    type: 'fixed',
    fixedAmount: 0, minAmount: 0, expectedAmount: 0,
    frequency: 'biweekly', payDay: 'Friday', nextPayDate: '',
    ...overrides,
  };
}

function createExpenseItem(overrides = {}) {
  return { id: uid(), name: '', amount: 0, day: 1, bucketId: 'w1', ...overrides };
}

function createOneTimeExpense(overrides = {}) {
  return { id: uid(), name: '', amount: 0, date: '', ...overrides };
}

function createSavingsItem(overrides = {}) {
  return { id: uid(), name: '', amount: 0, frequency: 'monthly', ...overrides };
}

function createTransferItem(overrides = {}) {
  return {
    id: uid(), name: '', amount: 0, toAccountId: '',
    type: 'regular', frequency: 'monthly', date: '',
    ...overrides,
  };
}

// ── Helpers ──────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10); }

function today() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), raw: d };
}

/** Returns max days in a given month/year */
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); }

/**
 * Given a day-of-month integer (1–31), return the bucket id.
 * The last bucket (w5, 25–31) handles all end-of-month days
 * for any month length — no clamping required.
 */
function bucketForDay(day) {
  for (const b of WEEK_BUCKETS) {
    if (day >= b.start && day <= b.end) return b.id;
  }
  return 'w5';
}

/** Given a YYYY-MM-DD string, return the bucket id for its day. */
function bucketForDate(dateStr) {
  if (!dateStr) return null;
  const d = parseInt(dateStr.split('-')[2], 10);
  return bucketForDay(d);
}

/** Bucket id for today. */
function currentBucketId() {
  return bucketForDay(today().day);
}

// ── Pay schedule helpers ─────────────────────────────────────

/**
 * Find all pay dates for an income item that fall within [windowStart, windowEnd].
 * Uses the nextPayDate as the anchor and steps by frequency interval.
 */
function payDatesInWindow(incomeItem, windowStart, windowEnd) {
  if (!incomeItem.nextPayDate) return [];
  const [y, m, d] = incomeItem.nextPayDate.split('-').map(Number);
  let cursor = new Date(y, m - 1, d);
  const start = new Date(windowStart);
  const end   = new Date(windowEnd);
  const stepMs = frequencyMs(incomeItem.frequency);

  if (cursor > end) {
    while (cursor > end) cursor = new Date(cursor.getTime() - stepMs);
  } else {
    while (cursor > start) cursor = new Date(cursor.getTime() - stepMs);
    if (cursor < start)   cursor = new Date(cursor.getTime() + stepMs);
  }

  const dates = [];
  let scan = new Date(cursor);
  while (scan <= end) {
    if (scan >= start) dates.push(new Date(scan));
    scan = new Date(scan.getTime() + stepMs);
  }
  return dates;
}

function frequencyMs(freq) {
  switch (freq) {
    case 'weekly':   return 7     * 86400000;
    case 'biweekly': return 14    * 86400000;
    case 'monthly':  return 30.4375 * 86400000;
    default:         return 14    * 86400000;
  }
}

function dateInRange(date, rangeStart, rangeEnd) {
  return date >= rangeStart && date <= rangeEnd;
}

// ── 12-week windows ──────────────────────────────────────────

/** Build 12 consecutive 7-day windows starting from Sunday of the reference week. */
function buildWeekWindows(referenceDate) {
  const ref = referenceDate || new Date();
  const weekStart = new Date(ref);
  weekStart.setDate(ref.getDate() - ref.getDay());
  weekStart.setHours(0, 0, 0, 0);

  const windows = [];
  for (let i = 0; i < 12; i++) {
    const ws = new Date(weekStart);
    ws.setDate(weekStart.getDate() + i * 7);
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    we.setHours(23, 59, 59, 999);
    windows.push({ start: ws, end: we, index: i });
  }
  return windows;
}

/**
 * For each calendar month that overlaps [start, end], return
 * { year, month, dayStart, dayEnd } describing the overlap.
 */
function getMonthsInWindow(start, end) {
  const result = [];
  let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const year       = cursor.getFullYear();
    const month      = cursor.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd   = new Date(year, month, 0);
    const ols = start > monthStart ? start : monthStart;
    const ole = end   < monthEnd   ? end   : monthEnd;
    if (ols <= ole) result.push({ year, month, dayStart: ols.getDate(), dayEnd: ole.getDate() });
    cursor = new Date(year, month, 1);
  }
  return result;
}

// ── Week computation ─────────────────────────────────────────

/**
 * Compute all financial flows for one 7-day window and one account.
 *
 * Scheduled expense matching:
 *   For each calendar-month segment overlapping the window, an
 *   expense with day D fires if:
 *     min(D, daysInMonth) is within [dayStart, dayEnd] of that segment.
 *
 *   Because bucket w5 covers 25–End-of-Month, any expense assigned
 *   to a day >= 25 naturally fires in the correct window for every
 *   month length — no special-casing needed.
 */
function computeWeek(window, account, allAccounts) {
  const { start, end } = window;

  // Income
  let incomeFixed = 0, incomeMin = 0, incomeExpected = 0, hasVariable = false;
  for (const inc of account.income) {
    const pays = payDatesInWindow(inc, start, end);
    if (!pays.length) continue;
    if (inc.type === 'fixed') {
      incomeFixed += inc.fixedAmount * pays.length;
    } else {
      hasVariable    = true;
      incomeMin      += inc.minAmount      * pays.length;
      incomeExpected += inc.expectedAmount * pays.length;
    }
  }

  // Scheduled expenses
  let scheduledExpenses = 0;
  const monthSegs = getMonthsInWindow(start, end);
  for (const { year, month, dayStart, dayEnd } of monthSegs) {
    const maxDay = daysInMonth(year, month);
    for (const exp of account.expenses) {
      const effDay = Math.min(exp.day, maxDay);
      if (effDay >= dayStart && effDay <= dayEnd) scheduledExpenses += exp.amount;
    }
  }

  // One-time expenses
  let oneTimeExpenses = 0;
  for (const ot of account.oneTimeExpenses) {
    if (!ot.date) continue;
    const [oy, om, od] = ot.date.split('-').map(Number);
    if (dateInRange(new Date(oy, om - 1, od), start, end)) oneTimeExpenses += ot.amount;
  }

  // Savings — monthly fires when window overlaps the 1st–6th of a month
  let savingsOut = 0;
  for (const sav of account.savings) {
    if (sav.frequency === 'monthly') {
      for (const { dayStart, dayEnd } of monthSegs) {
        if (dayStart <= 6 && dayEnd >= 1) savingsOut += sav.amount;
      }
    } else if (sav.frequency === 'weekly') {
      savingsOut += sav.amount;
    } else if (sav.frequency === 'biweekly' && window.index % 2 === 0) {
      savingsOut += sav.amount;
    }
  }

  // Transfers out
  let transfersOut = 0;
  for (const tr of account.transfers) {
    if (tr.type === 'onetime') {
      if (!tr.date) continue;
      const [ty, tm, td] = tr.date.split('-').map(Number);
      if (dateInRange(new Date(ty, tm - 1, td), start, end)) transfersOut += tr.amount;
    } else if (tr.frequency === 'weekly') {
      transfersOut += tr.amount;
    } else if (tr.frequency === 'biweekly' && window.index % 2 === 0) {
      transfersOut += tr.amount;
    } else if (tr.frequency === 'monthly') {
      for (const { dayStart, dayEnd } of monthSegs) {
        if (dayStart <= 6 && dayEnd >= 1) transfersOut += tr.amount;
      }
    }
  }

  // Transfers in from other accounts
  let transfersIn = 0;
  for (const acct of allAccounts) {
    if (acct.id === account.id) continue;
    for (const tr of acct.transfers) {
      if (tr.toAccountId !== account.id) continue;
      if (tr.type === 'onetime') {
        if (!tr.date) continue;
        const [ty, tm, td] = tr.date.split('-').map(Number);
        if (dateInRange(new Date(ty, tm - 1, td), start, end)) transfersIn += tr.amount;
      } else if (tr.frequency === 'weekly') {
        transfersIn += tr.amount;
      } else if (tr.frequency === 'biweekly' && window.index % 2 === 0) {
        transfersIn += tr.amount;
      } else if (tr.frequency === 'monthly') {
        for (const { dayStart, dayEnd } of monthSegs) {
          if (dayStart <= 6 && dayEnd >= 1) transfersIn += tr.amount;
        }
      }
    }
  }

  const totalIncome     = incomeFixed + incomeExpected;
  const totalIncomeMin  = incomeFixed + incomeMin;
  const totalIncomeBest = totalIncome;
  const totalExpenses   = scheduledExpenses + oneTimeExpenses;

  return {
    incomeFixed, incomeMin, incomeExpected, hasVariable,
    totalIncome, totalIncomeMin, totalIncomeBest,
    scheduledExpenses, oneTimeExpenses, totalExpenses,
    savingsOut, transfersOut, transfersIn,
    netExpected: totalIncome    + transfersIn - totalExpenses - savingsOut - transfersOut,
    netMin:      totalIncomeMin + transfersIn - totalExpenses - savingsOut - transfersOut,
    netBest:     totalIncomeBest + transfersIn - totalExpenses - savingsOut - transfersOut,
  };
}

/** Build the full 12-week rolling projection for one account. */
function buildProjection(account, allAccounts, referenceDate) {
  const windows = buildWeekWindows(referenceDate);
  let runningBalance = parseFloat(account.balance) || 0;

  // Pass 1: compute all weeks with running balances
  const weeks = windows.map(window => {
    const w = computeWeek(window, account, allAccounts);
    const endExp  = runningBalance + w.netExpected;
    const endMin  = runningBalance + w.netMin;
    const endBest = runningBalance + w.netBest;
    const result = {
      window, ...w,
      startBalance:       runningBalance,
      endBalanceExpected: endExp,
      endBalanceMin:      endMin,
      endBalanceBest:     endBest,
      weekChange:         w.netExpected,   // raw net change this week (for Change indicator)
      weekChangeMin:      w.netMin,
      weekChangeBest:     w.netBest,
    };
    runningBalance = endExp;
    return result;
  });

  // Pass 2: headroom for week i = the lowest ending balance across
  // weeks i..11 (inclusive). This answers: "how much extra can I
  // spend this week before any future week hits zero?"
  // If that minimum is negative the account is already projected to
  // go into deficit; headroom is reported as that negative number so
  // the user can see how deep the hole is.
  for (let i = 0; i < weeks.length; i++) {
    let minExp  = Infinity;
    let minMin  = Infinity;
    let minBest = Infinity;
    for (let j = i; j < weeks.length; j++) {
      if (weeks[j].endBalanceExpected < minExp)  minExp  = weeks[j].endBalanceExpected;
      if (weeks[j].endBalanceMin      < minMin)  minMin  = weeks[j].endBalanceMin;
      if (weeks[j].endBalanceBest     < minBest) minBest = weeks[j].endBalanceBest;
    }
    weeks[i].headroomExpected = minExp;
    weeks[i].headroomMin      = minMin;
    weeks[i].headroomBest     = minBest;
  }

  return weeks;
}

// ── Storage ──────────────────────────────────────────────────
const Storage = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : createDefaultState();
    } catch { return createDefaultState(); }
  },
  save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  },
};

// ── Formatters ───────────────────────────────────────────────
function fmt(n, showSign = false) {
  const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (showSign ? (n < 0 ? '−$' : '+$') : (n < 0 ? '−$' : '$')) + s;
}
function fmtDate(d)      { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateShort(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

// ════════════════════════════════════════════════════════════
// TEST SUITE — 30 checks
// ════════════════════════════════════════════════════════════
function runTests() {
  const results = [];
  let passed = 0, failed = 0;

  function check(label, actual, expected, tolerance = 0.01) {
    const ok = (typeof expected === 'string')
      ? actual === expected
      : Math.abs(actual - expected) <= tolerance;
    results.push({ label, actual, expected, ok });
    if (ok) passed++; else failed++;
  }

  const REF = new Date(2026, 2, 23); // Mon Mar 23 2026

  function makeAccount(o = {}) {
    return { ...createDefaultAccount('t', 'Test'), ...o };
  }

  // ── T01–T10: Bucket boundary checks ──────────────────────
  check('T01 day  1 → w1', bucketForDay(1),  'w1');
  check('T02 day  6 → w1', bucketForDay(6),  'w1');
  check('T03 day  7 → w2', bucketForDay(7),  'w2');
  check('T04 day 12 → w2', bucketForDay(12), 'w2');
  check('T05 day 13 → w3', bucketForDay(13), 'w3');
  check('T06 day 18 → w3', bucketForDay(18), 'w3');
  check('T07 day 19 → w4', bucketForDay(19), 'w4');
  check('T08 day 24 → w4', bucketForDay(24), 'w4');
  check('T09 day 25 → w5', bucketForDay(25), 'w5');
  check('T10 day 31 → w5', bucketForDay(31), 'w5');

  // ── T11–T12: daysInMonth ─────────────────────────────────
  check('T11 Feb 2025 = 28 days (non-leap)',  daysInMonth(2025, 2), 28);
  check('T12 Feb 2024 = 29 days (leap year)', daysInMonth(2024, 2), 29);

  // ── T13: Day-30 expense in Feb (non-leap) — clamped to 28 → fires in w5 window for Feb
  // Reference Feb 1 2025. Week 4 = Feb 23–Mar 1, which contains Feb 28.
  // Day 30 clamped to 28 fires that week. Confirm week 4 has the expense.
  {
    const acct = makeAccount({ expenses: [createExpenseItem({ day: 30, amount: 200, bucketId: 'w5' })] });
    const proj = buildProjection(acct, [acct], new Date(2025, 1, 1));
    // Week 4 covers Feb 23–Mar 1 — Feb 28 (clamped from 30) lands here
    check('T13 day-30 in Feb: week 4 fires (clamped to Feb 28)', proj[4].scheduledExpenses, 200);
  }

  // ── T14: Day-31 expense in Feb (non-leap) — clamped to 28 → fires in same Feb window
  {
    const acct = makeAccount({ expenses: [createExpenseItem({ day: 31, amount: 150, bucketId: 'w5' })] });
    const proj = buildProjection(acct, [acct], new Date(2025, 1, 1));
    check('T14 day-31 in Feb: week 4 fires (clamped to Feb 28)', proj[4].scheduledExpenses, 150);
  }

  // ── T15: Day-25 in a 31-day month — fires in w5, NOT double-counted
  // Week containing Mar 25 from a Mar 1 reference: week 3 = Mar 23–29
  {
    const acct = makeAccount({ expenses: [createExpenseItem({ day: 25, amount: 300, bucketId: 'w5' })] });
    const proj = buildProjection(acct, [acct], new Date(2026, 2, 1)); // Mar 1 2026 (Sun)
    // Week 0 = Mar 1–7, Week 3 = Mar 22–28 which contains Mar 25
    check('T15 day-25 in March: fires exactly once in the week containing the 25th', proj[3].scheduledExpenses, 300);
  }

  // ── T16: Weekly pay — exactly 1 pay per week across 12 weeks
  {
    const inc = createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 500 });
    const wins = buildWeekWindows(REF);
    const count = wins.reduce((s, w) => s + payDatesInWindow(inc, w.start, w.end).length, 0);
    check('T16 weekly pay: 1 per week × 12 = 12', count, 12);
  }

  // ── T17: Biweekly pay — exactly 6 pays in 12 weeks
  {
    const inc = createIncomeItem({ nextPayDate: '2026-03-27', frequency: 'biweekly', type: 'fixed', fixedAmount: 2000 });
    const wins = buildWeekWindows(REF);
    const count = wins.reduce((s, w) => s + payDatesInWindow(inc, w.start, w.end).length, 0);
    check('T17 biweekly pay: 6 pays in 12 weeks', count, 6);
  }

  // ── T18: Future pay date does not appear in current window
  {
    const inc = createIncomeItem({ nextPayDate: '2026-04-12', frequency: 'biweekly', type: 'fixed', fixedAmount: 1500 });
    const win0 = buildWeekWindows(REF)[0]; // Mar 22–28
    check('T18 Apr-12 biweekly: 0 pays in Mar 22–28', payDatesInWindow(inc, win0.start, win0.end).length, 0);
  }

  // ── T19: Fixed income minus expense = correct net
  {
    const acct = makeAccount({
      balance: 1000,
      income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 600 })],
      expenses: [createExpenseItem({ day: 24, amount: 200, bucketId: 'w4' })],
    });
    const proj = buildProjection(acct, [acct], REF);
    check('T19 fixed net: 600 − 200 = 400', proj[0].netExpected, 400);
  }

  // ── T20: Variable income expected vs min
  {
    const acct = makeAccount({
      income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'variable', minAmount: 150, expectedAmount: 450 })],
    });
    const proj = buildProjection(acct, [acct], REF);
    check('T20 variable expected = 450', proj[0].netExpected, 450);
    check('T20b variable min = 150',     proj[0].netMin,      150);
  }

  // ── T21: hasVariable true
  {
    const acct = makeAccount({
      income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'variable', minAmount: 0, expectedAmount: 300 })],
    });
    check('T21 hasVariable = true', buildProjection(acct, [acct], REF)[0].hasVariable ? 1 : 0, 1);
  }

  // ── T22: hasVariable false for fixed income
  {
    const acct = makeAccount({
      income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 800 })],
    });
    check('T22 hasVariable = false', buildProjection(acct, [acct], REF)[0].hasVariable ? 1 : 0, 0);
  }

  // ── T23: Mixed fixed + variable totals
  {
    const acct = makeAccount({
      income: [
        createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed',    fixedAmount: 1000 }),
        createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'variable', minAmount: 200, expectedAmount: 700 }),
      ],
    });
    const w0 = buildProjection(acct, [acct], REF)[0];
    check('T23 mixed totalIncome expected = 1700', w0.totalIncome,    1700);
    check('T23b mixed totalIncome min    = 1200',  w0.totalIncomeMin, 1200);
  }

  // ── T24: One-time expense — current week
  {
    const acct = makeAccount({
      balance: 2000,
      oneTimeExpenses: [createOneTimeExpense({ date: '2026-03-25', amount: 350 })],
    });
    const proj = buildProjection(acct, [acct], REF);
    check('T24 one-time in current week = 350', proj[0].oneTimeExpenses, 350);
    check('T24b not in next week',              proj[1].oneTimeExpenses, 0);
  }

  // ── T25: One-time expense — future week
  {
    const acct = makeAccount({
      balance: 3000,
      oneTimeExpenses: [createOneTimeExpense({ date: '2026-04-05', amount: 500 })],
    });
    const proj = buildProjection(acct, [acct], REF);
    check('T25 future one-time: week0 = 0',    proj[0].oneTimeExpenses, 0);
    check('T25b future one-time: week2 = 500', proj[2].oneTimeExpenses, 500);
  }

  // ── T26: Balance chains across all 12 weeks
  {
    const acct = makeAccount({
      balance: 1000,
      income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 200 })],
    });
    const proj = buildProjection(acct, [acct], REF);
    const chainOk = proj.slice(1).every((w, i) => Math.abs(w.startBalance - proj[i].endBalanceExpected) < 0.01);
    check('T26 balance chains correctly across 12 weeks', chainOk ? 1 : 0, 1);
  }

  // ── T27: Weekly savings deducted every week
  {
    const acct = makeAccount({
      income: [createIncomeItem({ nextPayDate: '2026-03-23', frequency: 'weekly', type: 'fixed', fixedAmount: 500 })],
      savings: [createSavingsItem({ amount: 100, frequency: 'weekly' })],
    });
    const proj = buildProjection(acct, [acct], REF);
    check('T27 weekly savings: net = 500 − 100 = 400', proj[0].netExpected, 400);
  }

  // ── T28: Monthly savings fires only when window overlaps 1st–6th
  {
    const acct = makeAccount({ savings: [createSavingsItem({ amount: 250, frequency: 'monthly' })] });
    // REF = Mar 23. Week 0 = Mar 22–28 (no 1st–6th). Week 1 = Mar 29–Apr 4 (contains Apr 1–4 → fires).
    const proj = buildProjection(acct, [acct], REF);
    check('T28 monthly savings fires in week containing 1st–6th', proj[1].savingsOut, 250);
    check('T28b monthly savings does NOT fire in week without 1st–6th', proj[0].savingsOut, 0);
  }

  // ── T29: Transfer out reduces source; transfer in credits destination
  {
    const src = makeAccount({ id: 'src', balance: 3000,
      transfers: [createTransferItem({ amount: 400, toAccountId: 'dst', type: 'regular', frequency: 'weekly' })] });
    const dst = makeAccount({ id: 'dst', balance: 500 });
    check('T29 transfer out from source',      buildProjection(src, [src, dst], REF)[0].transfersOut, 400);
    check('T29b transfer in to destination',   buildProjection(dst, [src, dst], REF)[0].transfersIn,  400);
  }

  // ── T30: Negative headroom
  {
    const acct = makeAccount({
      balance: 50,
      expenses: [createExpenseItem({ day: 23, amount: 600, bucketId: 'w4' })],
    });
    check('T30 negative headroom when expenses exceed balance',
      buildProjection(acct, [acct], REF)[0].endBalanceExpected < 0 ? 1 : 0, 1);
  }

  // ── Summary ──────────────────────────────────────────────
  console.log(`\n=== ClearFlow Test Results: ${passed}/${passed + failed} passed ===\n`);
  results.forEach(r => {
    const a = typeof r.actual   === 'number' ? r.actual.toFixed(4)   : r.actual;
    const e = typeof r.expected === 'number' ? r.expected.toFixed(4) : r.expected;
    console.log(`${r.ok ? '✅' : '❌'} ${r.label}: got ${a}, expected ${e}`);
  });

  return { passed, failed, total: passed + failed, results };
}

// ── Exports ──────────────────────────────────────────────────
window.Engine = {
  createDefaultState, createDefaultAccount, createIncomeItem,
  createExpenseItem, createOneTimeExpense, createSavingsItem, createTransferItem,
  buildProjection, buildWeekWindows, computeWeek,
  bucketForDay, bucketForDate, currentBucketId, daysInMonth,
  payDatesInWindow, getMonthsInWindow,
  Storage,
  uid, today, fmt, fmtDate, fmtDateShort,
  WEEK_BUCKETS, FREQUENCIES, PAY_DAYS,
  runTests,
};
